// mode-challenge.js — 挑战模式（P2-6）
// 打地鼠：随机亮键 + 倒计时圆环（每问 3 秒），按对进入下一题并累计连击；
// 连击 5/10 触发加速；10 连击后双键同亮。关卡 = 每轮 12 题；结算星级（按错误超时）。

'use strict';

window.ModeChallenge = class ModeChallenge {
  constructor(container, vkb, keymap, cfg = { round: 12, baseTime: 3.0 }) {
    this.container = container;
    this.vkb = vkb;
    this.keymap = keymap;
    this.cfg = cfg;
    this.state = 'idle';   // idle | playing | done
    this._raf = 0;
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.errors = 0;
    this._round = 0;
    this._asked = 0;
    this._targets = [];      // 当前亮键 midi 数组
    this._startPerf = 0;
    this._timeLeft = 0;
    this._notes = null;
    this._restart = null;    // app.js 注入：重开回调
  }

  // 进入模式（空态引导，等 F7 开始）
  enter() {
    if (this.state === 'playing') return; // 已在进行中，保持
    this.container.innerHTML = '';
    this.container.classList.add('challenge');
    const guide = document.createElement('div');
    guide.className = 'ch-guidance';
    guide.innerHTML = `看准亮起的键，抢在倒计时结束前按下！<br>
      <span class="hotkey">顶栏「▶ 播放」开始挑战 · chips 换模式</span>`;
    this.container.appendChild(guide);
    this._guide = guide;
  }

  start() {
    if (this._guide) this._guide.remove();
    this.state = 'playing';
    this.score = 0; this.combo = 0; this.bestCombo = 0; this.errors = 0;
    this._round = 0; this._asked = 0;
    this._notes = Object.values(this.keymap.keys || {}).filter((e) => e.type === 'note').map((e) => this.keymap.applyOffset ? this.keymap.applyOffset(e.midi) : e.midi);
    this._build();
    this._nextQuestion();
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._loop.bind(this));
  }

  _build() {
    this.container.innerHTML = '';
    this.container.classList.add('challenge');
    // HUD
    const hud = document.createElement('div');
    hud.className = 'ch-hud';
    hud.innerHTML = `<span>连击 <b class="ch-combo">0</b></span><span>得分 <b class="ch-score">0</b></span><span>题目 <b class="ch-asked">0</b>/<b>${this.cfg.round}</b></span>`;
    this._hud = { combo: hud.querySelector('.ch-combo'), score: hud.querySelector('.ch-score'), asked: hud.querySelector('.ch-asked') };
    this.container.appendChild(hud);
    // 倒计时圆环
    const ring = document.createElement('div');
    ring.className = 'ch-ring';
    ring.innerHTML = `<svg viewBox="0 0 120 120"><circle class="bg" cx="60" cy="60" r="52" fill="none" stroke-width="9"/><circle class="fg" cx="60" cy="60" r="52" fill="none" stroke-width="9" stroke-dasharray="326.7" stroke-dashoffset="0"/></svg><div class="num">3</div>`;
    this._ring = { el: ring, fg: ring.querySelector('.fg'), num: ring.querySelector('.num') };
    this.container.appendChild(ring);
    // 按键区（可点击触发练习，不参与弹奏判定）
    const keysZone = document.createElement('div');
    keysZone.className = 'ch-keys';
    this.container.appendChild(keysZone);
    this._keysEl = keysZone;
    // 大目标显示
    const target = document.createElement('div');
    target.className = 'ch-target';
    this.container.appendChild(target);
    this._targetEl = target;
    this._renderMiniKeys();
  }

  _renderMiniKeys() {
    // 当前音区可达键（跟随 octaveShift）
    const used = new Set();
    for (const [code, entry] of Object.entries(this.keymap.keys || {})) {
      if (entry.type !== 'note') continue;
      const disp = this.keymap.applyOffset ? this.keymap.applyOffset(entry.midi) : entry.midi;
      if (used.has(disp)) continue;
      used.add(disp);
      const el = document.createElement('div');
      const isBlack = [1, 3, 6, 8, 10].includes(disp % 12);
      el.className = 'ch-key' + (isBlack ? ' black' : '');
      el.textContent = code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'NP');
      el.dataset.midi = disp;
      // 覆盖 C3~B5 布局（48..83），四行近似按白键位置
      const row = Math.floor((disp - 48) / 21);
      const col = (disp - 48) % 21;
      el.style.width = '9%';
      el.style.height = '18%';
      el.style.left = (col * (100 / 21)) + '%';
      el.style.top = (row * 26 + 3) + '%';
      this._keysEl.appendChild(el);
      this._miniKey = this._miniKey || {};
      this._miniKey[disp] = el;
    }
  }

  _noteIndex(midi) {
    const lo = 48;
    const WHITE = [0, 2, 4, 5, 7, 9, 11];
    let idx = 0;
    for (let m = lo; m < midi; m++) { if (WHITE.includes(m % 12)) idx++; }
    return idx;
  }

  _nextQuestion() {
    this._round++;
    this._asked++;
    // 难度：连击加速 → 时间压缩；双键在连击 ≥ 10
    const multi = (this.combo >= 10) ? 2 : 1;
    const timeOut = Math.max(1.2, this.cfg.baseTime - Math.min(1.2, this.combo * 0.12));
    const pool = this._notes || [];
    const pick = new Set();
    if (pool.length) {
      // 排除刚用过的，避免重复
      let candidates = pool.filter((m) => !this._used?.includes(m));
      if (candidates.length < multi) candidates = pool;
      for (let i = 0; i < multi; i++) {
        const idx = Math.floor(Math.random() * candidates.length);
        pick.add(candidates.splice(idx, 1)[0]);
      }
    }
    this._used = [...pick];
    this._targets = [...pick];
    this._timeLeft = timeOut;
    // UI
    this._targetEl.textContent = this._targets.map((m) => Subtitle.NAMES[m % 12] ?? '♪').join(' + ');
    this._targetEl.style.animation = 'none';
    void this._targetEl.offsetWidth;
    this._targetEl.style.animation = '';
    if (this._miniKey) this._targets.forEach((m) => { this._miniKey[m]?.classList.add('blink'); });
  }

  _loop() {
    if (this.state !== 'playing') return;
    const dt = (performance.now() - this._last) / 1000;
    this._last = performance.now();
    this._timeLeft -= dt;
    const pct = Math.max(0, this._timeLeft / this.cfg.baseTime);
    this._ring.fg.style.strokeDashoffset = String((1 - pct) * 326.7);
    this._ring.num.textContent = String(Math.max(0, Math.ceil(this._timeLeft)));
    if (this._timeLeft <= 0) {
      this._timeout();
      return;
    }
    this._raf = requestAnimationFrame(this._loop.bind(this));
  }

  // 物理键按下（app.js 事件总线）
  onNoteDown(midi) {
    if (this.state !== 'playing') return;
    if (this._targets.includes(midi)) {
      this._hit();
    } else if (this._targets.length === 1) { // 单键时按错 = 一次失误（双键宽松）
      this.combo = 0;
      this.errors++;
      this._hud.combo.textContent = '0';
      this._flash(false);
    }
  }

  _hit() {
    const base = 10 + Math.floor(this.combo / 2); // 连击加成
    this.score += base;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this._hud.combo.textContent = String(this.combo);
    this._hud.score.textContent = String(this.score);
    this._hud.asked.textContent = String(this._asked);
    this._flash(true);
    this._targets.forEach((m) => this._miniKey?.[m]?.classList.remove('blink'));
    if (this._asked >= this.cfg.round) {
      this._finish(true);
    } else {
      this._nextQuestion();
      this._last = performance.now();
    }
  }

  _timeout() {
    this.combo = 0;
    this.errors++;
    this._hud.combo.textContent = '0';
    this._targets.forEach((m) => this._miniKey?.[m]?.classList.remove('blink'));
    if (this._asked >= this.cfg.round) { this._finish(true); return; }
    this._nextQuestion();
    this._last = performance.now();
  }

  _flash(ok) {
    this.container.classList.remove('ch-flash-ok', 'ch-flash-miss');
    void this.container.offsetWidth;
    this.container.classList.add(ok ? 'ch-flash-ok' : 'ch-flash-miss');
  }

  _finish(complete) {
    this.state = 'done';
    cancelAnimationFrame(this._raf);
    // 星级：完成度 + 失误量
    const acc = this._asked ? Math.max(0, 1 - this.errors / this._asked) : 0;
    const stars = complete ? (acc >= 0.9 ? 3 : acc >= 0.7 ? 2 : acc >= 0.5 ? 1 : 0) : 0;
    const screen = document.createElement('div');
    screen.className = 'ch-screen';
    screen.innerHTML = `
      <div class="big">${complete ? '关卡完成' : '挑战结束'}</div>
      <div class="stars">${'⭐'.repeat(Math.max(1, stars))}${'☆'.repeat(3 - stars)}</div>
      <div class="info">得分 <b>${this.score}</b> · 最佳连击 <b>${this.bestCombo}</b> · 失误 <b>${this.errors}</b></div>
      <div class="info" style="font-size:13px;color:#8a95a3">顶栏「▶ 播放」再来一局 · chips 换模式</div>`;
    this.container.appendChild(screen);
    this.vkb.clearAll();
  }

  exit() {
    this.state = 'idle';
    cancelAnimationFrame(this._raf);
    this.container.classList.remove('challenge');
    this.container.innerHTML = '';
    this._targets = [];
    this.vkb.clearAll();
  }
};
