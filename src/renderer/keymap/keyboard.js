// keyboard.js — 全局键盘监听：查表路由（FR-03 / §5.3 键盘事件规范）
// 输出事件：onNoteDown(midi), onNoteUp(midi), onFunc(funcName)
'use strict';

class KeyboardRouter {
  /** @param {KeymapRegistry} keymap */
  constructor(keymap) {
    this.keymap = keymap;
    this.onNoteDown = null;
    this.onNoteUp = null;
    this.onFunc = null;
    this._pressed = new Set(); // 记录已按下 code，防止 keyup 无配对
  }

  attach() {
    window.addEventListener('keydown', (e) => this._onKeyDown(e));
    window.addEventListener('keyup', (e) => this._onKeyUp(e));
  }

  _onKeyDown(e) {
    const entry = this.keymap.lookup(e.code);
    if (!entry || entry.type === 'none') return;
    e.preventDefault();

    if (entry.type === 'func') {
      // 功能键只触发一次（忽略长按重复），并避免被按住不松
      if (!e.repeat && this.onFunc) this.onFunc(entry.func);
      return;
    }
    // note：keydown 忽略 e.repeat（§5.3 长按不连发）
    if (e.repeat) return;
    if (this._pressed.has(e.code)) return; // 双保险（某些 OS 重复 keydown）
    this._pressed.add(e.code);
    if (this.onNoteDown) this.onNoteDown(entry.midi);
  }

  _onKeyUp(e) {
    const entry = this.keymap.lookup(e.code);
    if (!entry || entry.type !== 'note') return;
    if (!this._pressed.has(e.code)) return;
    this._pressed.delete(e.code);
    if (this.onNoteUp) this.onNoteUp(entry.midi);
  }
}

window.KeyboardRouter = KeyboardRouter;
