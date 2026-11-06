// mode-manager.js — 模式管理器（P2-1 / FR-09）
// 状态：MODES = [play, enjoy, practice, challenge]，F1 循环前进。
// 职责仅"切换"：enter/exit 各模式模块；顶栏 chips 高亮 + 状态条提示由 app.js 订阅回调实现。
'use strict';

window.ModeManager = class ModeManager {
  constructor({ container, chipsContainer, onModeChange, onModeSelect }) {
    this.container = container;            // 可视化区容器（随模式清空重绘）
    this.chips = chipsContainer;           // 顶栏模式 chips 容器
    this.onModeChange = onModeChange;      // (mode) => void
    this.onModeSelect = onModeSelect || null; // (mode) => void（chip 点击；app.js 注入统一副作用）
    this.modes = ['play', 'enjoy', 'practice', 'challenge'];
    this.registries = new Map();           // mode -> module 实例
    this.current = 'play';
    this._chipEls = new Map();             // mode -> chip el
  }

  // 注册模式模块（enter()/exit() 契约；enter 时接收 {vkb, events} 总线句柄）
  register(mode, module) {
    this.registries.set(mode, module);
  }

  _buildChips() {
    this.chips.innerHTML = '';
    this.modes.forEach((m) => {
      const chip = document.createElement('span');
      chip.className = 'mode-chip' + (m === this.current ? ' active' : '');
      chip.dataset.mode = m;
      chip.textContent = m === 'play' ? '弹奏'
        : m === 'enjoy' ? '欣赏'
        : m === 'practice' ? '练谱' : '挑战';
      chip.title = '点击切换模式';
      chip.addEventListener('click', () => {
        if (m === this.current) return;
        if (this.onModeSelect) this.onModeSelect(m);
      });
      this._chipEls.set(m, chip);
      this.chips.appendChild(chip);
    });
  }

  enter(mode) {
    const mod = this.registries.get(mode);
    if (mod?.enter) mod.enter();
    this.current = mode;
    this._chipEls.forEach((el, m) => el.classList.toggle('active', m === mode));
    if (this.onModeChange) this.onModeChange(mode);
  }

  exit() { // 离开当前模式（切走前清理其全部视觉/时钟）
    const mod = this.registries.get(this.current);
    mod?.exit?.();
  }

  switchTo(mode) {
    if (!this.modes.includes(mode) || mode === this.current) return;
    this.exit();
    this.enter(mode);
  }

  cycle() {
    const i = this.modes.indexOf(this.current);
    this.switchTo(this.modes[(i + 1) % this.modes.length]);
  }

  init() {
    this._buildChips();
    this.enter(this.current); // 弹奏模式为默认
  }
};
