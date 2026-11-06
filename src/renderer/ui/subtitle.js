// subtitle.js — 简谱字幕带（P2-5）
// 顶栏下方一条卡拉OK式字幕：儿歌 / 回放时当前音符放大高亮，自由弹奏时按物理输入即时高亮。
// 事件驱动：对 play(events) 用事件时间轴循环 rAF 推进；onPlayKey(midi) 供自由演奏即时点亮。
'use strict';

window.Subtitle = class Subtitle {
  constructor(container) {
    this.container = container; // #subtitleBar
    this._tones = [];           // [{el, midi, t0(sec), scale}]
    this._raf = 0;
    this._eventIdx = 0;
    this._events = [];
    this._startPerf = 0;
    this._speed = 1;
    this._active = -1;
    this._mode = 'idle';        // idle | events | free
  }

  static NAMES = { 0: '1', 2: '2', 4: '3', 5: '4', 7: '5', 9: '6', 11: '7' };
  static deg = (m) => Math.floor(m / 12 - 1); // 八度，仅展示用

  // 播放一段事件序列（儿歌/录音回放）→ 卡拉OK字幕
  play(events) {
    this.stop();
    this._events = [...events].filter((e) => e.a === 'down');
    if (!this._events.length) return;
    this._tones = this._events.map((e, i) => ({
      midi: e.n,
      t0: e.t,
      scale: Subtitle.NAMES[e.n % 12] ?? '—',
      el: null,
    }));
    this._render();
    this._mode = 'events';
    this._startPerf = performance.now();
    this._speed = 1;
    this._eventIdx = 0;
    this._active = -1;
    this.container.classList.add('show');
    this._loop();
  }

  // 进入自由演奏：无曲谱时也能用音名数字回流；midi 由 app.js 事件总线传入
  setFree(name) {
    this._mode = 'free';
    this.container.classList.add('show');
    if (name) this.container.innerHTML = ''; // 清空（自由弹不预置）
    this._active = -1;
    this._apply();
  }

  onPlayKey(midi) {
    if (this._mode !== 'free') return;
    // 自由演奏：即时高亮对应简谱音名（若存在预置则按音名，否则临时放大标记）
    this.container.querySelectorAll('.sub-tone').forEach((el, i) => {
      const tone = this._tones[i];
      el.classList.toggle('active', tone && tone.midi === midi);
    });
  }

  stop() {
    if (this._mode === 'idle') return;
    this._mode = 'idle';
    cancelAnimationFrame(this._raf);
    this.container.classList.remove('show');
    this.container.innerHTML = '';
    this._active = -1;
  }

  _render() {
    this.container.innerHTML = '';
    this._tones.forEach((n) => {
      const span = document.createElement('span');
      span.className = 'sub-tone';
      span.textContent = n.scale;
      span.title = n.scale;
      this.container.appendChild(span);
      n.el = span;
    });
  }

  _loop() {
    if (this._mode !== 'events') { this._loopIdleCheck(); return; }
    const elapsed = (performance.now() - this._startPerf) / 1000 * this._speed;
    let idx = this._eventIdx;
    while (idx < this._events.length && this._events[idx].t <= elapsed) {
      this._active = Math.min(idx, this._tones.length - 1);
      idx++;
    }
    this._eventIdx = idx;
    this._apply();
    // 自然结束
    if (elapsed > this._events[this._events.length - 1].t + 0.5) {
      // 保持高亮最后一个，等待 stop 由 playback finish 触发
      return;
    }
    this._raf = requestAnimationFrame(this._loop.bind(this));
  }

  _loopIdleCheck() { /* free/idle 无需循环 */ }

  _apply() {
    const els = this.container.querySelectorAll('.sub-tone');
    for (let i = 0; i < els.length; i++) els[i].classList.toggle('active', i === this._active);
  }
};
