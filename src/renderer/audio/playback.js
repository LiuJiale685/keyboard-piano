// playback.js — 回放调度（FR-04 / §5.1 统一发声引擎 / P2-8 rAF 统一时钟）
// 事件序列 [{a:'down',n,v,t}|{a:'up',n,t}]，t 为相对秒；调度从 setTimeout → requestAnimationFrame，
// 为瀑布/判定/字幕/卷帘提供统一时间基准。视觉层通过 onEvent 订阅每个被调度的事件（纯订阅者）。
'use strict';

class Playback {
  constructor(sampler) {
    this.sampler = sampler;
    this.state = 'idle';             // idle | playing
    this.onStateChange = null;       // (state, info) => void
    this.onBar = null;               // (nowMs, totalMs) => 进度
    this.onEvent = null;             // (event) => void 每个到期事件（视觉层消费）
    this._raf = 0;
    this._events = [];
    this._idx = 0;
    this._speed = 1;
    this._startPerf = 0;
    this._durMs = 0;
  }

  // events: NoteEvent 数组；speed 倍速（默认 1）
  play(events, speed = 1) {
    this.stop();
    if (!events || !events.length) return false;
    this.state = 'playing';
    this._events = [...events].sort((a, b) => a.t - b.t);
    this._idx = 0;
    this._speed = speed;
    this._durMs = (this._events[this._events.length - 1].t / speed) * 1000;
    this._startPerf = performance.now();
    if (this.onStateChange) this.onStateChange('playing', { duration: this._durMs });
    this._loop();
    return true;
  }

  _loop() {
    if (this.state !== 'playing') return;
    const nowMs = performance.now() - this._startPerf;

    // 调度到点的事件（一次性全部发出，保证时序；CHORD 同时发音）
    while (this._idx < this._events.length) {
      const atMs = (this._events[this._idx].t / this._speed) * 1000;
      if (atMs > nowMs) break;
      const e = this._events[this._idx++];
      if (e.a === 'down') this.sampler.play(e.n, e.v || 90);
      else this.sampler.release(e.n);
      if (this.onEvent) this.onEvent(e);
    }

    if (this.onBar) this.onBar(Math.min(nowMs, this._durMs), this._durMs);
    if (nowMs >= this._durMs) { this.finish(); return; }
    this._raf = requestAnimationFrame(this._loop.bind(this));
  }

  // 手动停止/打断（回放中敲琴键时调用）
  stop() {
    if (this.state === 'idle') return;
    this.state = 'idle';
    cancelAnimationFrame(this._raf);
    this._events = [];
    this._idx = 0;
    this.sampler.allNotesOff();
    if (this.onStateChange) this.onStateChange('idle', { finished: false });
  }

  finish() {
    if (this.state !== 'playing') return;
    this.state = 'idle';
    cancelAnimationFrame(this._raf);
    this.sampler.allNotesOff();
    this._events = [];
    this._idx = 0;
    if (this.onStateChange) this.onStateChange('idle', { finished: true });
  }
}

window.Playback = Playback;
