// virtual-keyboard.js — 虚拟钢琴键盘（P2-2 / P3，全模式共享）
// 渲染真实钢琴 88 键（A0~C8，MIDI 21~108，随 keymap.range）。
// 物理键(via keymap)以画布音高 = base midi + octaveShift（音区偏移）落位；纯订阅者。
'use strict';

window.VirtualKeyboard = class VirtualKeyboard {
  constructor(options = {}) {
    this.container = options.container;
    this.keymap = options.keymap || { keys: {} };
    this._keyEls = new Map();   // midi → { el, codes[], label }
    this._bubbleSeq = 0;
    this._bubbleSeq2 = 0;
  }

  // range 以 render 时 keymap 的最新值为准（keymap.load 是异步的，构造时可能未就绪）
  get rangeLo() { return this.keymap.range?.lo ?? 21; }
  get rangeHi() { return this.keymap.range?.hi ?? 108; }

  // 键位代码 → 展示字母（不含音区）
  _codeLabel(code) {
    return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'NP').replace(/^Semicolon$/, ';')
      .replace(/^Comma$/, ',').replace(/^Period$/, '.').replace(/^Slash$/, '/').replace(/^BracketLeft$/, '[')
      .replace(/^BracketRight$/, ']').replace(/^Backslash$/, '\\').replace(/^Minus$/, '-').replace(/^Equal$/, '=')
      .replace(/^Backquote$/, '`');
  }

  // base midi → display midi（加音区偏移）
  _apply(midi) { return (this.keymap.applyOffset ? this.keymap.applyOffset(midi) : midi); }

  render() {
    const WHITE_SET = [0, 2, 4, 5, 7, 9, 11];
    const whites = [];
    for (let m = this.rangeLo; m <= this.rangeHi; m++) {
      if (WHITE_SET.includes(m % 12)) whites.push(m);
    }
    const whiteW = 100 / whites.length;
    const blackW = whiteW * 0.62;

    this.container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'vkb';
    this.container.appendChild(wrap);

    // 预建立 base midi → 显示 midi 的键位标签（随 octaveShift）
    this._labelMap = this._buildLabelMap();

    // 白键
    whites.forEach((midi, i) => {
      const el = document.createElement('div');
      el.className = 'vkb-key vkb-white';
      el.style.left = (i * whiteW) + '%';
      el.style.width = whiteW + '%';
      const lab = this._labelMap.get(midi) || '';
      el.dataset.midi = midi;
      el.innerHTML = `<span class="vkb-label"></span><span class="vkb-notename">${this._noteName(midi)}</span>`;
      wrap.appendChild(el);
      const codes = this._codesFor(midi);
      this._keyEls.set(midi, { el, codes, label: lab, labelEl: el.querySelector('.vkb-label') });

      // 中央 C（绝对 midi 60）徽标
      if (midi === 60) {
        const badge = document.createElement('div');
        badge.className = 'vkb-c4badge';
        badge.textContent = '中央C';
        el.appendChild(badge);
      }
    });

    // 黑键：居中于其左右白键边界
    const blackMidi = [];
    for (let m = this.rangeLo; m <= this.rangeHi; m++) {
      if ([1, 3, 6, 8, 10].includes(m % 12)) blackMidi.push(m);
    }
    blackMidi.forEach((midi) => {
      let leftWhite = null;
      for (let m = midi - 1; m >= this.rangeLo; m--) {
        if (WHITE_SET.includes(m % 12)) { leftWhite = m; break; }
      }
      if (leftWhite == null) return;
      const idx = whites.indexOf(leftWhite);
      if (idx < 0) return;
      const rightBoundary = (idx + 1) * whiteW;
      const left = rightBoundary - blackW / 2;
      const el = document.createElement('div');
      el.className = 'vkb-key vkb-black';
      el.style.left = left + '%';
      el.style.width = blackW + '%';
      el.dataset.midi = midi;
      const lab = this._labelMap.get(midi) || '';
      el.innerHTML = `<span class="vkb-label"></span>`;
      wrap.appendChild(el);
      this._keyEls.set(midi, { el, codes: this._codesFor(midi), label: lab, labelEl: el.querySelector('.vkb-label') });
    });

    this.refreshOctave();
  }

  // base midi → 展示 label（按当前 octaveShift 反查；多代码同时映射时取首个）
  _buildLabelMap() {
    const map = new Map();
    for (const [code, entry] of Object.entries(this.keymap.keys || {})) {
      if (entry.type !== 'note') continue;
      const disp = this._apply(entry.midi);
      if (!map.has(disp)) map.set(disp, this._codeLabel(code));
    }
    return map;
  }

  /** 音区窗口高亮 + 键位字母跟随偏移 + 中央 C 徽标定位（P3） */
  refreshOctave() {
    if (!this._keyEls.size) return;
    // 物理可达窗口（base 窗口经偏移后的绝对 midi 集）
    const reachable = new Set();
    for (const v of Object.values(this.keymap.keys || {})) {
      if (v.type === 'note' && Number.isFinite(v.midi)) reachable.add(this._apply(v.midi));
    }
    this._labelMap = this._buildLabelMap();
    for (const [midi, rec] of this._keyEls) {
      const inReg = reachable.has(midi);
      rec.el.classList.toggle('out-of-region', !inReg);
      const lab = this._labelMap.get(midi) || '';
      rec.label = lab;
      rec.codes = this._codesFor(midi);
      if (rec.labelEl) rec.labelEl.textContent = lab;
    }
  }

  _codesFor(midi) {
    const out = [];
    for (const [code, entry] of Object.entries(this.keymap.keys || {})) {
      if (entry.type === 'note' && this._apply(entry.midi) === midi) out.push(code);
    }
    return out;
  }

  // ---- 事件驱动（纯订阅者）----
  onNoteDown(midi) {
    const rec = this._keyEls.get(midi);
    if (!rec) return;
    rec.el.classList.add('on');
    this._bubble(midi, rec);
  }

  onNoteUp(midi) {
    const rec = this._keyEls.get(midi);
    if (rec) rec.el.classList.remove('on');
  }

  // 触发键上方飘出音名，高频时节流合并
  _bubble(midi, rec) {
    if (!rec.label) return;
    const el = rec.el;
    const bubble = document.createElement('div');
    bubble.className = 'vkb-bubble';
    bubble.textContent = rec.label;
    el.appendChild(bubble);
    const my = ++this._bubbleSeq2;
    window.setTimeout(() => {
      if (my === this._bubbleSeq2) {
        el.querySelectorAll('.vkb-bubble').forEach((b) => b.remove());
      }
    }, 620); // 620ms 内只保留最新气泡（节流合并）
    window.setTimeout(() => bubble.remove(), 900);
  }

  /** 全部灭灯 */
  clearAll() {
    this.container.querySelectorAll('.vkb-key.on').forEach((el) => el.classList.remove('on'));
    this.container.querySelectorAll('.vkb-bubble').forEach((b) => b.remove());
  }

  /** 点亮/熄灭某个键（欣赏模式瀑布、挑战出题） */
  light(midi, on = true) {
    const rec = this._keyEls.get(midi);
    if (rec) rec.el.classList.toggle('on', on);
  }

  keyLeft(midi) {
    const rec = this._keyEls.get(midi);
    return rec ? rec.el.offsetLeft : 0;
  }
  keyWidth(midi) {
    const rec = this._keyEls.get(midi);
    return rec ? rec.el.offsetWidth : 0;
  }

  _noteName(midi) {
    const names = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
    return names[midi % 12] + (Math.floor(midi / 12) - 1);
  }
};
