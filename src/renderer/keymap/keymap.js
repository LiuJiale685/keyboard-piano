// keymap.js — 键位映射加载与查询（FR-03，event.code → 音高/功能）
// 第三期：88 键音域(21~108) + 音区偏移。note 的 midi 为基础音高（音区偏移 0），
// 物理键实际发声 = applyOffset(midi)，偏移被钳制在 range 内。
'use strict';

class KeymapRegistry {
  constructor() {
    this.layout = null;
    this.range = { lo: 0, hi: 127 };
    this._loadPromise = null;
    this.octaveShift = 0; // 音区偏移（半音，±12 八度步进；-6~+6 步进不限于八度时由调用方控制）
  }

  load(path = './keymap/default.json') {
    if (this._loadPromise) return this._loadPromise;
    this._loadPromise = new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', path, true);
      xhr.responseType = 'json';
      xhr.onload = () => {
        if (xhr.status !== 200) return reject(new Error('keymap 加载失败 ' + xhr.status));
        this.layout = xhr.response;
        this.range = this.layout.range || { lo: 0, hi: 127 };
        // 顶层透传 keys，视觉层（虚拟键盘/瀑布/练谱/挑战）统一按 this.keymap.keys 遍历
        this.keys = this.layout.keys || {};
        resolve(this.layout);
      };
      xhr.onerror = () => reject(new Error('keymap 加载失败'));
      xhr.send();
    });
    return this._loadPromise;
  }

  // 查表：event.code → {type: note|func|none, midi?, func?}
  lookup(code) {
    return this.layout?.keys?.[code] || { type: 'none' };
  }

  // 音区偏移：基础 midi + octaveShift，钳制在 21~108 内
  applyOffset(midi) {
    return Math.max(this.range.lo, Math.min(this.range.hi, midi + this.octaveShift));
  }

  // 当前方案 note 型键的基础音高窗口（用于音区边界守卫）
  noteSpan() {
    let lo = Infinity, hi = -Infinity;
    for (const v of Object.values(this.keys || {})) {
      if (v && v.type === 'note' && Number.isFinite(v.midi)) {
        if (v.midi < lo) lo = v.midi;
        if (v.midi > hi) hi = v.midi;
      }
    }
    return Number.isFinite(lo) ? { lo, hi } : null;
  }

  // 顶栏音区 ± 按钮：步进为半音（±12 = 一个八度）。
  // 守卫：整个物理键盘窗口仍落在 range 内（21 ≤ base+offset ≤ 108），越界拒绝并返回 false。
  shift(step) {
    const span = this.noteSpan();
    if (span) {
      const next = this.octaveShift + step;
      if (span.lo + next < this.range.lo || span.hi + next > this.range.hi) return false;
    }
    this.octaveShift += step;
    return true;
  }
}

window.KeymapRegistry = KeymapRegistry;
