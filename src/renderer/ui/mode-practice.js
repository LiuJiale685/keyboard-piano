// mode-practice.js — 练谱模式（P2-4）
// 音符方块从顶部落向键盘线，方块标注该键键位字母（来自 keymap 反查）；
// 到线 ± 命中窗口内按对同名字键 = 命中（+10 / 连击 +1）；错键或超时 = miss（连击清零，温和反馈）。
// 三档速度 0.5x / 0.75x / 1x（F2/F3/F4 或 chips 点击切换）；曲末结算星级（按命中率）+ 得分 + 最佳连击。
'use strict';

window.ModePractice = class ModePractice {
  constructor(container, vkb, keymap) {
    this.container = container;
    this.vkb = vkb;
    this.keymap = keymap;
    this._raf = 0;
    this.state = 'idle';     // idle | choosing | playing | done
    this.speed = 1;          // 0.5 / 0.75 / 1
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.hits = 0;
    this.misses = 0;
    this._notes = null;      // 预展开的判定音符（含命中状态）
    this._actIdx = 0;
    this._startPerf = 0;
    this._durMs = 0;
    this._onFinished = null; // app.js 注入：曲末回调（可播放完毕等）
  }

  // 绝对谱音 → 当前音区下的键位字母（base = 绝对midi - 音区偏移；匹配物理键）
  _label(midi) {
    const base = midi - (this.keymap.octaveShift || 0);
    for (const [code, entry] of Object.entries(this.keymap.keys || {})) {
      if (entry.type === 'note' && entry.midi === base) return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'NP').replace(/^Semicolon$/, ';').slice(0, 3);
    }
    return '♪'; // 当前音区不可达（边界外）→ 无物理键
  }

  // 进入模式（空态引导，等 F7 / 选曲开始）
  enter() {
    if (this.state === 'playing') return; // 已在演奏中，保持
    this.container.innerHTML = '';
    this.container.classList.add('practice');
    const guide = document.createElement('div');
    guide.className = 'practice-guidance';
    guide.innerHTML = `跟着音符方块弹，落到键盘线时按下对应键！<br>
      <span class="hotkey">顶栏「🎵 儿歌」选曲 · 「▶ 播放」开始 · 1x / 0.75x / 0.5x 调速</span>`;
    this.container.appendChild(guide);
    this._guide = guide;
  }

  // 选曲进入：给定 song；构建音符时间轴
  start(song) {
    if (this._guide) this._guide.remove();
    this.restart(song);
  }

  restart(song) {
    if (!song) return this.state = 'idle';
    const beatSec = 60 / (song.bpm || 100);
    let t = 0;
    this._notes = song.notes.filter(([m]) => m > 0).map(([midi, dur]) => {
      const item = { midi, t0: t * beatSec, dur: dur * beatSec, label: this._label(midi), hit: false, done: false };
      t += dur;
      return item;
    });
    this._durMs = t * beatSec * 1000;
    this._actIdx = 0;
    this.state = 'playing';
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.hits = 0;
    this.misses = 0;
    this._startPerf = performance.now();
    this._build();
  }

  _build() {
    this.container.innerHTML = '';
    this.container.classList.add('practice');
    // HUD
    const hud = document.createElement('div');
    hud.className = 'practice-hud';
    hud.innerHTML = `<span class="s">得分 <b class="hud-score">0</b></span><span>连击 <b class="hud-combo">0</b><i class="c-bonus"></i></span><span>节奏 <b class="hud-hits">0</b>/<b class="hud-total">${this._notes.length}</b></span>`;
    this._hud = {
      score: hud.querySelector('.hud-score'),
      combo: hud.querySelector('.hud-combo'),
      bonus: hud.querySelector('.c-bonus'),
      hits: hud.querySelector('.hud-hits'),
      total: hud.querySelector('.hud-total'),
    };
    this.container.appendChild(hud);
    // 速度切换
    const sw = document.createElement('div');
    sw.className = 'speed-switch';
    [[0.5, '0.5x'], [0.75, '0.75x'], [1, '1x']].forEach(([s, label]) => {
      const span = document.createElement('span');
      span.textContent = label;
      span.dataset.speed = s;
      span.addEventListener('click', () => this.setSpeed(s));
      sw.appendChild(span);
    });
    this.container.appendChild(sw);
    this._setChips();
    // 键盘线
    const line = document.createElement('div');
    line.className = 'practice-target-line';
    this.container.appendChild(line);
    // 音符容器
    const field = document.createElement('div');
    field.className = 'practice-field';
    this.container.appendChild(field);
    this._field = field;
    // 预建方块
    this._kid = [];
    this._notes.forEach((n) => {
      const el = document.createElement('div');
      el.className = 'practice-note ' + (this._isBlack(n.midi) ? 'n-black' : 'n-down');
      el.textContent = n.label;
      n.el = el;
      this._field.appendChild(el);
      this._kid.push(el);
    });
    this._loop();
  }

  _isBlack(midi) { return [1, 3, 6, 8, 10].includes(midi % 12); }

  _setChips() {
    if (!this.container.querySelector('.speed-switch')) return;
    this.container.querySelectorAll('.speed-switch span').forEach((s) => {
      s.classList.toggle('on', parseFloat(s.dataset.speed) === this.speed);
    });
  }

  setSpeed(s) {
    if (this.state !== 'playing') return;
    // 保持已过时间不变，仅改变后续下落速度
    const nowMs = (performance.now() - this._startPerf);
    this.speed = s;
    this._startPerf = performance.now() - nowMs / (s / 1); // 重新以新速度折算起点（相对不变）
    this._setChips();
  }

  _elapsed() { return (performance.now() - this._startPerf) / 1000 * this.speed; }

  _targetLineY() {
    return (this._field?.clientHeight || 400) * 0.72;
  }

  _loop() {
    if (this.state !== 'playing') return;
    const el = this._elapsed();
    const lineY = this._targetLineY();
    // 每个未完成音符：计算 y（从 -52 落到 lineY）
    for (let i = this._actIdx; i < this._notes.length; i++) {
      const n = this._notes[i];
      if (n.done) continue;
      const travelSec = 1.3; // 顶 → 线秒数（视觉速度与判定窗口匹配）
      const y = -52 + (el - n.t0) / (1.0 / this.speed) * ((lineY + 52) / travelSec);
      if (y < -80) continue;
      n.el.style.top = y + 'px';
      n.el.style.opacity = y < -52 ? '0.15' : '1';
      // 超时
      if (el > n.t0 + 0.9 / this.speed) { // 命中窗口 0.9s 后超时
        this._miss(n, 'timeout');
      }
    }
    // 清扫离屏节点（state 保护防双触发）
    if (this.state !== 'playing') return;
    if (el > this._durMs + 3 / this.speed && this._actIdx >= this._notes.length) {
      this._finish();
    } else if (el > this._notes[this._notes.length - 1]?.t0 + 4 / this.speed && this._actIdx >= this._notes.length) {
      this._finish();
    }
    this._raf = requestAnimationFrame(this._loop.bind(this));
  }

  // 外部（app.js 事件总线）传入物理按下；谱面跟弹判定
  onNoteDown(midi) {
    if (this.state !== 'playing') return;
    const elT = this._elapsed();
    // 找当前未处理、与 midi 匹配且时间在窗口内的第一个
    let target = null;
    for (let i = this._actIdx; i < this._notes.length; i++) {
      const n = this._notes[i];
      if (n.done) continue;
      const dt = Math.abs(elT - n.t0);
      if (!target && n.midi === midi && dt <= 0.75 / this.speed) { target = n; break; }
    }
    if (target) {
      this._hit(target);
    } else {
      // 错键（温和：不算分但提示；若在窗口内按错 → miss 温和）
      this.combo = 0;
      this.misses++;
      this._hud.combo.textContent = '0';
      this._hud.bonus.textContent = '';
      this._flash(false);
    }
  }

  _hit(n) {
    n.hit = true; n.done = true;
    this._actIdx = Math.max(this._actIdx, this._notes.indexOf(n) + 1);
    this.score += 10;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.hits++;
    n.el.classList.add('hit');
    this._hud.score.textContent = String(this.score);
    this._hud.combo.textContent = String(this.combo);
    this._hud.bonus.textContent = this.combo >= 5 ? ` +${this.combo}` : '';
    this._hud.hits.textContent = String(this.hits);
    this._flash(true);
  }

  _miss(n, why) {
    if (n.done) return;
    n.done = true;
    this._actIdx = Math.max(this._actIdx, this._notes.indexOf(n) + 1);
    this.misses++;
    this.combo = 0;
    n.el.classList.add('miss');
    this._hud.combo.textContent = '0';
    this._hud.bonus.textContent = '';
    this._flash(false);
  }

  _flash(ok) {
    if (!this._field) return;
    this._field.classList.remove('flash-ok', 'flash-miss');
    void this._field.offsetWidth;
    this._field.classList.add(ok ? 'flash-ok' : 'flash-miss');
  }

  _finish() {
    this.state = 'done';
    cancelAnimationFrame(this._raf);
    // 星评：命中率
    const rate = this._notes.length ? this.hits / this._notes.length : 0;
    const stars = rate >= 0.95 ? 3 : rate >= 0.8 ? 2 : rate >= 0.6 ? 1 : 0;
    if (this._onFinished) this._onFinished({ stars, rate, score: this.score, bestCombo: this.bestCombo, hits: this.hits, total: this._notes.length });
    // 结算屏
    const screen = document.createElement('div');
    screen.className = 'practice-screen';
    screen.innerHTML = `
      <div class="stars">${'⭐'.repeat(Math.max(1, stars))}${'☆'.repeat(3 - stars)}</div>
      <div class="info">得分 <b>${this.score}</b> · 命中 <b>${this.hits}/${this._notes.length}</b> · 最佳连击 <b>${this.bestCombo}</b></div>
      <div class="info" style="font-size:13px;color:#8a95a3">顶栏「▶ 播放」再来一次 · 「🎵 儿歌」换曲 · chips 换模式</div>`;
    this.container.appendChild(screen);
    this.vkb.clearAll();
  }

  exit() {
    this.state = 'idle';
    cancelAnimationFrame(this._raf);
    this.container.classList.remove('practice');
    this.container.innerHTML = '';
    this._notes = null;
    this.vkb.clearAll();
  }
};
