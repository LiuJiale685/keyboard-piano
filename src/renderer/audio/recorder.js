// recorder.js — 录制：NoteEvent(down/up) 时间序列（FR-04），本地持久化
'use strict';

// 语音控制器：负责录音状态机（空闲/录音中 + 回放的互斥在控制器层处理）
class Recorder {
  constructor() {
    this.state = 'idle'; // idle | recording
    this.events = null;
    this.startTime = 0;
    this.onStateChange = null; // (state, info) => void
  }

  // t0：录音零点（performance.now）
  start() {
    if (this.state === 'recording') return false;
    this.events = [];
    this.startTime = performance.now();
    this.state = 'recording';
    if (this.onStateChange) this.onStateChange('recording', {});
    return true;
  }

  stop() {
    if (this.state !== 'recording') return null;
    const events = this.events;
    const dur = (performance.now() - this.startTime) / 1000;
    this.events = null;
    this.state = 'idle';
    const rec = {
      id: 'r' + Date.now().toString(36),
      title: '录音 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      createdAt: Date.now(),
      duration: +dur.toFixed(2),
      noteCount: events.reduce((n, e) => (e.a === 'down' ? n + 1 : n), 0),
      events,
    };
    if (this.onStateChange) this.onStateChange('idle', { finished: rec });
    return rec;
  }

  // 录制中注入事件（由控制器从键盘/回放等转发）
  noteOn(midi, velocity = 100) {
    if (this.state !== 'recording') return;
    this.events.push({ a: 'down', n: midi, v: velocity, t: +(performance.now() - this.startTime).toFixed(3) });
  }

  noteOff(midi) {
    if (this.state !== 'recording') return;
    this.events.push({ a: 'up', n: midi, t: +(performance.now() - this.startTime).toFixed(3) });
  }

  get isRecording() { return this.state === 'recording'; }
}

window.Recorder = Recorder;
