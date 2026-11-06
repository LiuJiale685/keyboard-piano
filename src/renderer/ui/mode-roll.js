// mode-roll.js — 录音室：钢琴卷帘视图（P2-7）
// 欣赏模式播放录音片段时切换为横向音符块时间轴 + 播放头。
// 纯视觉订阅者：时间来自 playback.onBar/onStateChange，发声不变。
'use strict';

window.ModeRoll = class ModeRoll {
  constructor(vkb) {
    this.vkb = vkb;
    this._raf = 0;
    this._events = [];
    this._durMs = 0;
    this._startPerf = 0;
    this._onStop = null;
    this._el = null;
    this._lanesRect = null;
  }

  // app.js 注入：关闭按钮回调
  setOnStop(fn) { this._onStop = fn; }

  attach(events, durMs) {
    this._events = events || [];
    this._durMs = durMs || 5000;
    this._startPerf = performance.now();
    this._build();
  }

  _build() {
    const wrap = document.createElement('div');
    wrap.className = 'roll-wrap';
    wrap.innerHTML = `
      <div class="roll-head">
        <span class="rp-title">🎼 琴谱回放</span>
        <span class="rp-count"></span>
        <span class="roll-status"></span>
        <span class="roll-close">■ 关闭</span>
      </div>
      <div class="roll-main">
        <div class="roll-content"></div>
        <div class="roll-scroll">
          <div class="roll-lanes"></div>
        </div>
        <div class="roll-playhead"></div>
      </div>`;
    wrap.querySelector('.roll-close').addEventListener('click', () => this._onStop?.());
    this._el = wrap;
    this._ph = wrap.querySelector('.roll-playhead');
    this._status = wrap.querySelector('.roll-status');
    this._count = wrap.querySelector('.rp-count');
    this._lanes = wrap.querySelector('.roll-lanes');
    this._renderLanes();
  }

  _renderLanes() {
    const lo = this.vkb ? this.vkb.rangeLo : 21;
    const hi = this.vkb ? this.vkb.rangeHi : 108;
    const WHITE = [0, 2, 4, 5, 7, 9, 11];
    const laneH = 13;
    let y = 0;
    const whiteHeights = [];
    const byMidi = {};
    for (let m = lo; m <= hi; m++) {
      if (WHITE.includes(m % 12)) { whiteHeights.push({ m, y }); y += laneH; }
    }
    this._laneY = { whiteHeights, laneH, even: {} };
    const totalH = whiteHeights.length * laneH;
    this._lanes.style.height = totalH + 'px';
    // 车道底纹
    whiteHeights.forEach((w, i) => {
      const lane = document.createElement('div');
      lane.className = 'roll-lane' + (i % 2 ? ' black' : '');
      lane.style.top = w.y + 'px';
      lane.style.height = laneH + 'px';
      this._lanes.appendChild(lane);
    });
    // 音符块
    const pxPerSec = 80;
    const W = 2000;
    const H = totalH;
    const content = document.createElement('div');
    content.className = 'roll-scroll';
    content.style.width = '0px';
    const notesWrap = document.createElement('div');
    notesWrap.style.position = 'relative';
    notesWrap.style.width = W + 'px';
    notesWrap.style.height = H + 'px';
    const active = new Map();
    this._events.forEach((e) => {
      const tSec = e.t;
      if (e.a === 'down') {
        active.set(e.n, tSec);
      } else if (e.a === 'up' && active.has(e.n)) {
        const w0 = whiteHeights.find((w) => w.m === e.n);
        if (w0) {
          const x = tSec * pxPerSec;
          const dur = Math.max(0.15, e.t - active.get(e.n));
          const block = document.createElement('div');
          block.className = 'roll-note';
          block.style.left = (active.get(e.n) * pxPerSec) + 'px';
          block.style.width = Math.max(10, dur * pxPerSec) + 'px';
          block.style.top = w0.y + 'px';
          notesWrap.appendChild(block);
        }
        active.delete(e.n);
      }
    });
    this._laneEl = notesWrap;
    this._el.querySelector('.roll-scroll').appendChild(notesWrap);
    this._count.textContent = `${this._events.filter((e) => e.a === 'down').length} 音 · ${this._durMs.toFixed(0)}ms`;
  }

  enter() { } // 视图由 app.js 挂载到 modeStage

  onBar(nowMs, totalMs) {
    if (!this._ph) return;
    const pct = Math.min(1, nowMs / Math.max(1, totalMs));
    this._ph.style.left = (pct * 100) + '%';
    this._status.textContent = `${Math.floor(nowMs / 1000)}:${String(Math.floor(nowMs % 1000 / 100))}`;
  }

  exit() {
    cancelAnimationFrame(this._raf);
    this._el = null;
    this._ph = null;
  }

  node() { return this._el; }
};
