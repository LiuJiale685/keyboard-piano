// mode-enjoy.js — 欣赏模式（P2-3）
// 儿歌 / 录音回放自动演奏可视化：音符瀑布 + 播放条（曲名/进度/停止），落到键盘线点亮虚拟键。
// 纯订阅者：发声/录音/儿歌逻辑零改动；事件来自 app.js 转发的 playback.onEvent。
'use strict';

window.ModeEnjoy = class ModeEnjoy {
  constructor(container, vkb, keymap) {
    this.container = container;
    this.vkb = vkb;
    this.keymap = keymap;
    this._raf = 0;
    this._notes = [];        // {el, startSec(相对t), durSec, midi, paused}
    this._events = [];       // 当前片段全量事件
    this._speed = 1;
    this._startPerf = 0;     // 播放起点（performance.now）
    this._pausedAt = 0;
    this._playbackStart = 0;
    this._durMs = 0;
    this._title = '';
    this._type = null;       // 'song' | 'recording'
    this._dropPxPerSec = 0;
    this._onStop = null;     // app.js 注入：停止播放（调 playback.stop）
  }

  // app.js 在每次开始播放前调用：带标题/来源/事件序列/时长
  attach(title, type, events, durMs) {
    this._title = title;
    this._type = type;
    this._events = [...events].filter((e) => e.a === 'down');
    this._durMs = durMs || 5000;
    this._playbackStart = performance.now();
    this._pausedAt = 0;
    this._build();
  }

  // app.js 注入：停止按钮回调
  setOnStop(fn) { this._onStop = fn; }

  // 进入欣赏模式：播放条 + 瀑布层；若已 attach 片段则重建方块
  enter() {
    this.container.innerHTML = '';
    this.container.classList.add('enjoy');
    // 播放条
    const bar = document.createElement('div');
    bar.className = 'enjoy-playbar';
    bar.innerHTML = `<span class="t-title"></span><span class="track"><i></i></span><span class="t-time"></span><span class="t-close">■ 停止</span>`;
    bar.querySelector('.t-close').addEventListener('click', () => this._onStop && this._onStop());
    this._bar = bar;
    this._td = { title: bar.querySelector('.t-title'), track: bar.querySelector('i'), time: bar.querySelector('.t-time') };
    this.container.appendChild(bar);
    // 瀑布层
    const wf = document.createElement('div');
    wf.className = 'enjoy-waterfall';
    this.container.appendChild(wf);
    this._wf = wf;
    if (this._events.length) this._build();
    this._computeDrop();
    if (this._type === 'recording') this.container.classList.add('recording');
    this._loop();
  }

  // 播放结束时清理单个瀑布（不清空播放条，保持空态）
  clear() {
    this._notes = [];
    this._events = [];
    if (this._wf) this._wf.innerHTML = '';
  }

  // 非欣赏模式播放结局清理（纯订阅者不需要重进入）
  exitVisuals() {
    this.clear();
  }

  _noteLabel(midi) {
    const base = midi - (this.keymap.octaveShift || 0);
    for (const [code, entry] of Object.entries(this.keymap.keys || {})) {
      if (entry.type === 'note' && entry.midi === base) return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'NP').slice(0, 3);
    }
    return '♪';
  }

  _computeDrop() {
    if (!this._wf) return;
    const h = this._wf.clientHeight || 400;
    const travelSec = 0.9; // 音符从顶落到键盘线用时（视觉节奏）
    this._keyLineY = (this._wf.clientHeight || 400) * 0.68;
    this._dropPxPerSec = this._keyLineY / travelSec;
  }

  _build() {
    if (!this._wf) return;
    this._notes = [];
    this._wf.innerHTML = '';
    // 预建全部方块（长片段用 DOM，量级数百可控）
    const labelOf = new Map();
    this._events.forEach((e) => {
      if (!labelOf.has(e.n)) labelOf.set(e.n, this._noteLabel(e.n));
      const el = document.createElement('div');
      el.className = 'wf-note ' + (this._isBlack(e.n) ? 'n-black' : 'n-white');
      const midi = e.n;
      el.style.left = (this.vkb.keyLeft(midi) + this.vkb.keyWidth(midi) / 2 - 24) + 'px';
      el.textContent = labelOf.get(midi);
      el.style.width = Math.max(34, this.vkb.keyWidth(midi) - 8) + 'px';
      this._wf.appendChild(el);
      this._notes.push({ el, midi, t: e.t });
    });
  }

  _isBlack(midi) { return [1, 3, 6, 8, 10].includes(midi % 12); }

  _loop() {
    const nowMs = performance.now() - this._playbackStart;
    const elapsed = nowMs / this._speed;
    // 下落方块
    for (const n of this._notes) {
      const y = (elapsed - n.t * 1000) / 1000 * this._dropPxPerSec;
      if (y >= -70 && y <= this._keyLineY + 40) {
        n.el.style.top = y + 'px';
        n.el.style.opacity = '1';
      } else if (y > this._keyLineY + 40) {
        n.el.style.top = '-70px';
        n.el.style.opacity = '0';
      }
    }
    // 播放条进度
    if (this._td) {
      const pct = Math.min(100, (nowMs / this._durMs) * 100);
      this._td.track.style.width = pct + '%';
      this._td.time.textContent = this._fmt(nowMs / 1000) + ' / ' + this._fmt(this._durMs / 1000);
      this._td.title.textContent = this._title;
    }
    this._raf = requestAnimationFrame(this._loop.bind(this));
  }

  _fmt(s) {
    if (!(s >= 0)) s = 0;
    return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  }

  // playback.onEvent 消费：点亮虚拟键
  onEvent(e) {
    if (e.a === 'down') this.vkb.light(e.n, true);
    else this.vkb.light(e.n, false);
  }

  exit() {
    cancelAnimationFrame(this._raf);
    this.container.classList.remove('enjoy', 'recording');
    this.container.innerHTML = '';
    this._notes = [];
    this._wf = null;
    this._bar = null;
    this.vkb.clearAll();
  }
};
