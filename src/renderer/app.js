// app.js — 主控制器
// 职责：初始化 → 加载 → 键盘路由接线 → 录音/回放/儿歌/音量/退出
// 架构：发声引擎（sampler）与事件管线（keyboard → controller → sampler/recorder/playback 共用）
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);

  // ---- 模块实例 ----
  const sampler = new window.PianoSampler();
  const keymap = new window.KeymapRegistry();
  const keyboard = new window.KeyboardRouter(keymap);
  const recorder = new window.Recorder();
  const playback = new window.Playback(sampler);

  const state = {
    currentSong: 0,     // 当前选曲 index
    volume: 0.9,
    recPanelOpen: false,
    songPanelOpen: false,
    latestRecording: null, // 最近录音片段（内存镜像，供回放）
  };

  // ---- 第二批：视觉层（纯订阅者，不改发声/录音/儿歌逻辑） ----
  // 三段布局：顶栏(chips/状态) / 可视化区(#modeStage 随模式切换) / 底部虚拟键盘(#vkbWrap)
  const modeStage = $('modeStage');
  const vkbWrap = $('vkbWrap');
  const vkb = new window.VirtualKeyboard({ container: vkbWrap, keymap });

  const ModeManagerCls = window.ModeManager;
  const modeManager = new ModeManagerCls({
    container: modeStage,
    chipsContainer: $('modeChips'),
    onModeChange: (mode) => {},
    onModeSelect: (mode) => { // 顶栏 chip 点击：与 F1 循环相同副作用，再定向切换
      switchMode(mode);
    },
  });
  // 各模式模块（enter/exit; onNoteDown/onEvent 由事件总线注入）
  const modePlay = new window.ModePlay(modeStage);
  const modeEnjoy = new window.ModeEnjoy(modeStage, vkb, keymap);
  const modePractice = new window.ModePractice(modeStage, vkb, keymap);
  const modeChallenge = new window.ModeChallenge(modeStage, vkb, keymap);
  modeManager.register('play', modePlay);
  modeManager.register('enjoy', modeEnjoy);
  modeManager.register('practice', modePractice);
  modeManager.register('challenge', modeChallenge);

  // 字幕带（简谱卡拉OK）
  const subtitle = new window.Subtitle($('subtitleBar'));
  // 录音室卷帘视图（欣赏模式播放录音时切换）
  const rollView = new window.ModeRoll(vkb);
  // 停止按钮 → 播放器（瀑布/卷帘共用 app 级停止）
  modeEnjoy.setOnStop(() => {
    playback.stop();
    setStatus('回放已停止');
  });
  rollView.setOnStop(() => {
    playback.stop();
    setStatus('回放已停止');
    exitRollView();
  });

  // ---- 加载流程 ----
  async function boot() {
    try {
      await keymap.load();
      // 采样目录：优先 IPC（打包 extraResources），回退开发相对路径
      let samplesBase = './samples/';
      let manifestPath = './samples/manifest.json';
      try {
        const dir = await window.pianoAPI?.getSamplesDir();
        if (dir?.url) {
          samplesBase = dir.url;
          manifestPath = dir.url + 'manifest.json';
        }
      } catch (_) { /* 开发环境直接走相对路径 */ }
      // 加载 manifest 但先不建 AudioContext —— 交给用户手势解锁
      await sampler.init(manifestPath, samplesBase);
      // 音频上下文创建后先挂起，等首次用户交互 resume
      sampler.ctx.suspend();

      sampler.onProgress = (done, total) => {
        const pct = Math.round((done / total) * 100);
        $('bar').style.width = pct + '%';
        $('pct').textContent = pct + '%';
      };
      sampler.onError = (e) => showLoadError('音源加载失败: ' + e.message);
      await sampler.loadAll();

      enterReady();
    } catch (e) {
      showLoadError('初始化失败: ' + e.message);
    }
  }

  function showLoadError(msg) {
    const el = $('loadErr');
    el.style.display = 'block';
    el.textContent = msg;
    $('pct').textContent = '加载失败';
  }

  function enterReady() {
    console.log('[app] ready, samples=%d/%d', sampler.progress.done, sampler.progress.total);
    $('loading').style.display = 'none';
    $('stage').classList.add('show');
    // 虚拟键盘渲染 + 模式默认进入（弹奏）
    vkb.render();
    modeManager.init();
    // 自动 resume 一次（用户手势不在时可失败静默；首次按键会再次 resume）
    if (sampler.ctx && sampler.ctx.state === 'suspended') sampler.ctx.resume();
    renderSongList();
    refreshRecordings();
  }

  // ---- 顶栏按钮（P3：原 F1~F12 功能全部按钮化） ----
  function wireToolbar() {
    const btn = (id) => document.getElementById(id);
    const has = (id) => !!btn(id);
    if (has('btnRec')) btn('btnRec').addEventListener('click', () => handleFunc('record'));
    if (has('btnStopRec')) btn('btnStopRec').addEventListener('click', () => handleFunc('stopRecord'));
    if (has('btnPlayRec')) btn('btnPlayRec').addEventListener('click', () => handleFunc('playLatest'));
    if (has('btnStopPlay')) btn('btnStopPlay').addEventListener('click', () => handleFunc('stopPlayback'));
    if (has('btnSongs')) btn('btnSongs').addEventListener('click', () => handleFunc('toggleSongs'));
    if (has('btnPlaySong')) btn('btnPlaySong').addEventListener('click', () => handleFunc('songPlay'));
    if (has('btnStopSong')) btn('btnStopSong').addEventListener('click', () => handleFunc('stopSong'));
    if (has('btnOctUp')) btn('btnOctUp').addEventListener('click', () => handleFunc('octaveUp'));
    if (has('btnOctDown')) btn('btnOctDown').addEventListener('click', () => handleFunc('octaveDown'));
    // 音量按钮（title 语义）
    document.querySelectorAll('.toolbar .tbtn[title*="音量"]').forEach((el) => {
      el.addEventListener('click', () => handleFunc(el.title.includes('增大') ? 'volumeUp' : 'volumeDown'));
    });
  }

  // ---- 键盘路由（事件总线语义：演奏/回放/儿歌 三来源 → 视觉层分发） ----
  keyboard.attach();
  keyboard.onNoteDown = (midi) => {
    const note = keymap.applyOffset(midi); // 第三期：基础 midi + 音区偏移（钳制 21~108）
    if (!sampler.ready) return;
    // 回放中敲琴键立即发声并打断回放（§3.3 回放优先）
    if (playback.state === 'playing') {
      playback.stop();
      syncToolbar();
    }
    // 视觉层：虚拟键盘按下动画 + 当前模式消耗（练谱判定/挑战判定/弹奏气泡）
    vkb.onNoteDown(note);
    modePlay.onNoteDown?.(note);
    modePractice.onNoteDown?.(note);
    modeChallenge.onNoteDown?.(note);
    // 发声/录音（第一批逻辑不变）
    if (recorder.isRecording) recorder.noteOn(note);
    sampler.play(note, 100);
    // 字幕带：演奏模式下若在跟踪儿歌节奏则推进
    if (subtitle.onPlayKey) subtitle.onPlayKey(note);
  };
  keyboard.onNoteUp = (midi) => {
    const note = keymap.applyOffset(midi); // 第三期：同一偏移（keyup 必须与 keydown 配对）
    vkb.onNoteUp(note);
    if (recorder.isRecording) recorder.noteOff(note);
    sampler.release(note);
  };
  keyboard.onFunc = (func) => handleFunc(func);

  // 功能表（FR-03 功能键位表唯一出处）
  function handleFunc(func) {
    switch (func) {
      case 'cycleMode': {
        // F1：弹奏 → 欣赏 → 练谱 → 挑战 循环（P2-1 / FR-09）
        switchMode(modeManager.modes[(modeManager.modes.indexOf(modeManager.current) + 1) % modeManager.modes.length], true);
        break;
      }
      case 'record':
        if (recorder.isRecording) { setStatus('正在录音中…'); return; }
        if (playback.state === 'playing') playback.stop(); // 回放中开录 → 打段回放
        recorder.onStateChange = onRecStateChange;
        if (recorder.start()) { setStatus('● 录音中…'); syncToolbar(); }
        break;
      case 'stopRecord': {
        const rec = recorder.stop();
        if (rec) {
          state.latestRecording = rec;
          persistRecording(rec);
          setStatus('✓ 已保存录音: ' + rec.title);
          refreshRecordings();
        }
        syncToolbar();
        break;
      }
      case 'playLatest':
        playRecording(state.latestRecording);
        break;
      case 'stopPlayback':
        playback.stop();
        subtitle.stop();
        modeEnjoy.exitVisuals();
        if (rollActive) exitRollView();
        setStatus('回放已停止');
        syncToolbar();
        break;
      case 'stopSong':
        playback.stop();
        subtitle.stop();
        modeEnjoy.clear();
        setStatus('播放已停止');
        syncToolbar();
        break;
      case 'octaveUp':
        if (keymap.shift(12)) {
          setStatus('音区: ' + formatOctave(keymap.octaveShift));
          vkb.refreshOctave(); // 音区高亮 + 键位标签跟随（W3/W4）
        } else {
          setStatus('音区已到最高（不可再上移）');
        }
        break;
      case 'octaveDown':
        if (keymap.shift(-12)) {
          setStatus('音区: ' + formatOctave(keymap.octaveShift));
          vkb.refreshOctave();
        } else {
          setStatus('音区已到最低（不可再下移）');
        }
        break;
      case 'toggleSongs':
        togglePanel('song');
        break;
      case 'songNext':
        if (!state.songPanelOpen) togglePanel('song');
        state.currentSong = (state.currentSong + 1) % window.SONGS.length;
        renderSongList();
        break;
      case 'songPrev':
        if (!state.songPanelOpen) togglePanel('song');
        state.currentSong = (state.currentSong - 1 + window.SONGS.length) % window.SONGS.length;
        renderSongList();
        break;
      case 'songPlay': {
        // 练谱/挑战模式下 F7 复用为「开始 / 再来一次」（Enter/→ 同理）
        if (modeManager.current === 'practice') {
          const song = window.SONGS[state.currentSong];
          if (!song) { setStatus('请先选择歌曲'); break; }
          if (modePractice.state === 'playing') modePractice.restart(song);
          else modePractice.start(song);
          setStatus('🎯 练谱: ' + song.title);
          break;
        }
        if (modeManager.current === 'challenge') {
          modeChallenge.start();
          setStatus('⚡ 挑战开始!');
          break;
        }
        const song = window.SONGS[state.currentSong];
        if (song) playSong(song);
        break;
      }
      case 'volumeUp':
        state.volume = Math.min(1.0, state.volume + 0.1);
        sampler.setVolume(state.volume);
        setStatus('音量: ' + Math.round(state.volume * 100) + '%');
        break;
      case 'volumeDown':
        state.volume = Math.max(0.1, state.volume - 0.1);
        sampler.setVolume(state.volume);
        setStatus('音量: ' + Math.round(state.volume * 100) + '%');
        break;
      case 'escape':
        closeAllPanels();
        break;
      default:
        break;
    }
  }

  function formatOctave(shift) {
    const oct = shift / 12;
    return (oct > 0 ? '+' : '') + oct;
  }

  function onRecStateChange(newState, info) {
    if (newState === 'idle' && info.finished) {
      // 录制结束由 stopRecord 分支处理
    }
  }

  // 统一模式切换（F1 循环 / 顶栏 chip 点击 共用副作用）
  function switchMode(mode, useCycle) {
    if (useCycle) {
      playback.stop();           // 切模式即停止回放/儿歌
      if (recorder.isRecording) { // 录音中切模式 → 保存当前片段
        const rec = recorder.stop();
        if (rec) { state.latestRecording = rec; persistRecording(rec); refreshRecordings(); }
      }
      subtitle.stop();
      if (rollActive) exitRollView(); // 切模式即退卷帘
      modeManager.cycle();
    } else {
      playback.stop();
      if (recorder.isRecording) {
        const rec = recorder.stop();
        if (rec) { state.latestRecording = rec; persistRecording(rec); refreshRecordings(); }
      }
      subtitle.stop();
      if (rollActive) exitRollView();
      modeManager.switchTo(mode);
    }
    syncToolbar();
    const names = { play: '弹奏', enjoy: '欣赏', practice: '练谱', challenge: '挑战' };
    setStatus('模式: ' + names[modeManager.current]);
  }

  // ---- 录音持久化 ----
  async function persistRecording(rec) {
    try {
      await window.pianoAPI?.recordingSave(rec);
    } catch (e) {
      console.warn('录音保存失败', e);
    }
  }

  async function refreshRecordings() {
    try {
      const list = await window.pianoAPI?.recordingsList() || [];
      const ul = $('recList');
      ul.innerHTML = '';
      if (!list.length) {
        ul.innerHTML = '<li style="color:#5b6470">暂无录音，按 F2 开始录制</li>';
        return;
      }
      list.forEach((r) => {
        const li = document.createElement('li');
        const dur = (r.duration || 0).toFixed(1);
        const time = new Date(r.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        li.innerHTML = `<span>${r.title || '未命名'}</span>
          <span class="meta">${dur}s · ${time} · ${r.noteCount || 0}音</span>
          <button data-play="${r.id}">▶</button>
          <button data-midi="${r.id}">MIDI</button>
          <button data-del="${r.id}">×</button>`;
        li.querySelector('[data-play]').addEventListener('click', async () => {
          const rec = await window.pianoAPI?.recordingLoad(r.id);
          if (rec) state.latestRecording = rec;
          playRecording(rec);
        });
        li.querySelector('[data-midi]').addEventListener('click', async () => {
          const rec = await window.pianoAPI?.recordingLoad(r.id);
          if (!rec || !rec.events?.length) { setStatus('该录音无音符，无法导出'); return; }
          try {
            const bytes = window.NoteEventsToMidi(rec.events, 120);
            const base64 = window.MidiToBase64(bytes);
            const res = await window.pianoAPI?.exportMidi({ base64, defaultName: `${rec.title.replace(/[\\/:*?"<>|]/g, '_')}.mid` });
            if (res?.ok) setStatus('MIDI 已导出: ' + res.filePath);
            else if (!res?.canceled) setStatus('MIDI 导出失败');
          } catch (e) { console.warn('MIDI 导出失败', e); setStatus('MIDI 导出失败'); }
        });
        li.querySelector('[data-del]').addEventListener('click', async () => {
          await window.pianoAPI?.recordingDelete(r.id);
          refreshRecordings();
        });
        ul.appendChild(li);
      });
    } catch (e) { console.warn('录音列表失败', e); }
  }

  // ---- 回放（F4 / 录音列表 ▶） ----
  let rollActive = false; // 卷帘视图是否挂在可视化区

  // 欣赏模式 + 录音 → 卷帘视图（V6）
  function enterRollView(rec) {
    if (modeManager.current !== 'enjoy') return;
    rollActive = true;
    modeEnjoy.clear(); // 清掉瀑布（卷帘覆盖展示）
    rollView.attach(rec.events || [], rec.duration ? Math.floor(rec.duration * 1000) : 5000);
    const roll = rollView.node();
    if (roll && !roll.parentNode) modeStage.appendChild(roll);
  }

  function exitRollView() {
    rollActive = false;
    if (rollView.node()?.parentNode) rollView.node().remove();
  }

  function playRecording(rec) {
    if (!rec || !rec.events || !rec.events.length) {
      setStatus('暂无录音（按 F2 录制一段）');
      return;
    }
    if (recorder.isRecording) { setStatus('录音中不可回放'); return; }
    setupPlaybackVisuals();
    playback.onStateChange = (st, info) => {
      if (st === 'playing') {
        setStatus('▶ 回放中…');
        syncToolbar();
      }
      else if (info?.finished) {
        setStatus('回放完毕');
        subtitle.stop();
        modeEnjoy.exitVisuals();
        if (rollActive) exitRollView();
        syncToolbar();
      }
    };
    // 视觉切换：欣赏模式 + 录音 → 录音室卷帘；其余 → 瀑布
    if (modeManager.current === 'enjoy') {
      subtitle.play(rec.events);   // 卡拉OK字幕（录音也可，无简谱则显示音名数字）
      if (rec.fromSong) {
        modeEnjoy.attach('儿歌·' + (rec.title || '录音'), 'song', rec.events, rec.events[rec.events.length - 1].t * 1000 + 500);
        modeEnjoy.enter();
      } else {
        enterRollView(rec);
      }
    } else {
      subtitle.stop();
      modeEnjoy.clear();
    }
    setStatus('▶ 回放中…');
    playback.play(rec.events, 1);
    syncToolbar();
  }

  // 回放/儿歌共用：音频事件 → 视觉层时钟联动（瀑布/卷帘/字幕/键盘点亮）
  // attach 类的非进入式衔接：享受模式展示，其余模式纯订阅
  function setupPlaybackVisuals() {
    playback.onEvent = (e) => {
      modeEnjoy.onEvent?.(e);
      vkb.light(e.n, e.a === 'down');
    };
    playback.onBar = (nowMs, totalMs) => {
      rollView.onBar?.(nowMs, totalMs);
    };
  }

  // ---- 儿歌 ----
  function playSong(song) {
    if (recorder.isRecording) recorder.stop();
    if (playback.state === 'playing') playback.stop();
    const events = window.SongToEvents(song);
    setupPlaybackVisuals();
    // 欣赏模式：进入瀑布并加载曲目（切歌曲后自动开始视觉）
    if (modeManager.current === 'enjoy') {
      subtitle.play(events);       // 卡拉OK字幕（事件驱动）
      modeEnjoy.attach(song.title, 'song', events, events[events.length - 1].t * 1000 + 500);
      modeEnjoy.enter();
    }
    playback.onStateChange = (st, info) => {
      if (st === 'playing') {
        setStatus('🎵 ' + song.title + ' 播放中… (琴键可打断)');
        syncToolbar();
      }
      else if (info?.finished) {
        setStatus('儿歌播放完毕');
        subtitle.stop();
        modeEnjoy.clear();
        syncToolbar();
      }
    };
    setStatus('🎵 ' + song.title + ' 播放中…');
    playback.play(events, 1);
    syncToolbar();
  }

  function renderSongList() {
    const ul = $('songList');
    ul.innerHTML = '';
    window.SONGS.forEach((s, i) => {
      const li = document.createElement('li');
      li.className = i === state.currentSong ? 'active' : '';
      li.textContent = `${i + 1}. ${s.title}`;
      li.addEventListener('click', () => {
        state.currentSong = i;
        renderSongList();
      });
      li.addEventListener('dblclick', () => playSong(s));
      ul.appendChild(li);
    });
  }

  // ---- 面板 ----
  function togglePanel(which) {
    if (which === 'song') {
      state.songPanelOpen = !state.songPanelOpen;
      $('songPanel').classList.toggle('show', state.songPanelOpen);
      $('recPanel').classList.remove('show');
      state.recPanelOpen = false;
    } else {
      state.recPanelOpen = !state.recPanelOpen;
      $('recPanel').classList.toggle('show', state.recPanelOpen);
      $('songPanel').classList.remove('show');
      state.songPanelOpen = false;
    }
  }

  function closeAllPanels() {
    state.songPanelOpen = false;
    state.recPanelOpen = false;
    $('songPanel').classList.remove('show');
    $('recPanel').classList.remove('show');
  }

  // ---- 状态条 ----
  let statusTimer = null;
  function setStatus(text) {
    $('statusText').textContent = text;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      $('statusText').textContent = '就绪，开始弹奏吧！';
    }, 5000);
  }

  // ---- 退出面板（FR-06/FR-08）----
  let hideTimer = null;
  function openExitPanel() {
    $('exitMask').classList.add('show');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(closeExitPanel, 10000);
  }
  function closeExitPanel() {
    $('exitMask').classList.remove('show');
    clearTimeout(hideTimer);
  }
  $('btnYes').addEventListener('click', () => window.pianoAPI?.confirmExit());
  $('btnNo').addEventListener('click', closeExitPanel);
  $('exitMask').addEventListener('click', (e) => { if (e.target === $('exitMask')) closeExitPanel(); });
  window.pianoAPI?.onRequestExitPanel(openExitPanel);
  window.pianoAPI?.onNotice((d) => console.warn('[notice]', d));

  // 全局兜底：应用内点击关闭面板
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') closeAllPanels();
  });

  // ---- 顶栏按钮状态同步（§3.3 互斥：录音/回放状态） ----
  function syncToolbar() {
    const btn = (id) => document.getElementById(id);
    const dis = (id, v) => { const el = btn(id); if (el) el.disabled = v; };
    dis('btnStopRec', !recorder.isRecording);
    dis('btnPlayRec', !state.latestRecording || recorder.isRecording || playback.state === 'playing');
    dis('btnStopPlay', playback.state !== 'playing');
    dis('btnPlaySong', playback.state === 'playing');
    dis('btnStopSong', playback.state !== 'playing');
    if (btn('btnRec')) btn('btnRec').classList.toggle('rec-on', recorder.isRecording);
  }

  // ---- 启动 ----
  wireToolbar();
  syncToolbar();
  boot();
})();
