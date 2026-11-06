// mode-play.js — 弹奏模式（P2-2）
// 展示中央大气泡天空，弹奏时音符化作彩色泡泡从键盘被动升空（纯视觉）。
'use strict';

window.ModePlay = class ModePlay {
  constructor(container) {
    this.container = container;
  }

  enter() {
    this.container.innerHTML = '';
    this.container.classList.add('play');
    const guide = document.createElement('div');
    guide.className = 'play-guide';
    guide.innerHTML = `按键盘 <span class="kbd">A</span>～<span class="kbd">L</span>、<span class="kbd">W</span> 等键弹奏 · 顶栏按钮可录音·回放·儿歌 · 音区 −/+ 切换八度`;
    this.container.appendChild(guide);
    const sky = document.createElement('div');
    sky.className = 'sky';
    this.container.appendChild(sky);
    this._sky = sky;
  }

  // 演奏时冒泡（app.js 事件总线）
  onNoteDown(midi) {
    if (!this._sky) return;
    const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const b = document.createElement('div');
    b.className = 'sky-bubble';
    b.textContent = NAMES[midi % 12] + Math.floor(midi / 12 - 1);
    const x = 20 + Math.random() * 60;
    b.style.left = x + '%';
    const hue = (midi * 31) % 360;
    b.style.background = `hsl(${hue} 80% 60%)`;
    this._sky.appendChild(b);
    b.addEventListener('animationend', () => b.remove());
  }

  exit() {
    this.container.classList.remove('play');
    this.container.innerHTML = '';
    this._sky = null;
  }
};
