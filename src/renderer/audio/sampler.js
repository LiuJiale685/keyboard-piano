// samplers.js — 真钢琴采样发声引擎（FR-02 / §5.1 共享规则）
// 职责：AudioContext 单例、全量预加载、复音管理、统一 play/release 入口
// 数据：Salamander Grand Piano V3，30 keycenter × 3 力度层 FLAC，键间变速变调

'use strict';

class PianoSampler {
  constructor() {
    this.ctx = null;
    this.master = null;           // 主 GainNode（全局音量出口）
    this.manifest = null;         // samples/manifest.json
    this.buffers = new Map();     // key: `${sample}@${vel}` → AudioBuffer
    this.keyToBuffer = new Map(); // midi → { bufKey, playbackRate }
    this.voices = new Map();      // voiceId → { source, gain, released }
    this._voiceSeq = 0;
    this.state = 'idle';          // idle | loading | ready | error
    this.progress = { done: 0, total: 0 };
    this.onProgress = null;       // (done, total) => void（UI 进度）
    this.onReady = null;
    this.onError = null;
    this.maxPolyphony = 64;       // FR-02 复音上限
    this.outputVolume = 1.0;
  }

  init(manifestPath = './samples/manifest.json', baseDir = './samples/') {
    return this._loadManifest(manifestPath).then((manifest) => {
      this.manifest = manifest;
      this.baseDir = baseDir;
      // 预构建 midi → 缓冲键 映射
      for (const k of manifest.keyboard) {
        this.keyToBuffer.set(k.midi, { sample: k.sample, playbackRate: k.playbackRate, midi: k.midi });
      }
      return this.createContext();
    });
  }

  _loadManifest(path) {
    // sandbox 下渲染层无 node fs；file:// 页面用 XHR 加载本地文件（fetch 不适用 file 协议）
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', path, true);
      xhr.responseType = 'json';
      xhr.onload = () => (xhr.status === 200 ? resolve(xhr.response) : reject(new Error('manifest 加载失败 ' + xhr.status)));
      xhr.onerror = () => reject(new Error('manifest 加载失败'));
      xhr.send();
    });
  }

  createContext() {
    // AudioContext 由用户手势解锁（autoplay 策略），此处创建但先 suspend
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.gain.value = this.outputVolume;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  // 全量预加载采样（FR-02：启动全量加载，首键零延迟）
  async loadAll() {
    if (this.state === 'loading' || this.state === 'ready') return;
    this.state = 'loading';
    const { keyboard, velocityLevels } = this.manifest;
    const seen = new Set(); // 去重：同一 (sample, vel) 只解一次
    const tasks = [];
    for (const k of keyboard) {
      for (const vel of velocityLevels) {
        const key = `${k.sample}@${vel}`;
        if (seen.has(key)) continue;
        seen.add(key);
        tasks.push([key, k.sample, vel]);
      }
    }
    this.progress.total = tasks.length;
    this.progress.done = 0;

    // 分批解码，避免瞬时并发过高（decodeAudioData 并发上限 ~6-20）
    const BATCH = 6;
    for (let i = 0; i < tasks.length; i += BATCH) {
      const batch = tasks.slice(i, i + BATCH);
      await Promise.all(batch.map(([key, sample, vel]) => this._decode(key, sample, vel)));
      if (this.onProgress) this.onProgress(this.progress.done, this.progress.total);
    }

    // 解锁 AudioContext（关键：暂停中不发声，由首次用户操作 resume）
    this.state = 'ready';
    if (this.onReady) this.onReady();
  }

  _decode(key, sample, vel) {
    return new Promise((resolve) => {
      try {
        const url = `${this.baseDir}${sample}v${vel}.flac`.replace('#', '%23');
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';
        xhr.onload = async () => {
          try {
            if (xhr.status !== 200) throw new Error(`HTTP ${xhr.status} ${url}`);
            const audioBuf = await this.ctx.decodeAudioData(xhr.response);
            this.buffers.set(key, audioBuf);
          } catch (e) {
            console.warn('[sampler] 解码失败', key, e);
          } finally {
            this.progress.done++;
            resolve();
          }
        };
        xhr.onerror = () => { console.warn('[sampler] 加载失败', url); this.progress.done++; resolve(); };
        xhr.send();
      } catch (e) {
        this.progress.done++;
        resolve();
      }
    });
  }

  // ---- 统一发声入口（§5.1：演奏/回放/儿歌共用）----
  // note: 0~127 MIDI；velocity 0~127；建议必定传处于音域内
  play(note, velocity = 100) {
    if (this.state !== 'ready') return null;
    if (!this.ctx || this.ctx.state === 'suspended') this.ctx?.resume();
    const map = this.keyToBuffer.get(note);
    if (!map) return null;
    const vel = this._velocityLevel(velocity);
    const buf = this.buffers.get(`${map.sample}@${vel}`);
    if (!buf) return null;

    // 复音偷占（voice stealing）：超限杀掉最旧音
    while (this.voices.size >= this.maxPolyphony) {
      const oldestId = this.voices.keys().next().value; // Map 保持插入序，最旧在前
      const old = this.voices.get(oldestId);
      if (old) this._kill(old.source, old.gain);
      this.voices.delete(oldestId);
    }

    const now = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = buf;
    source.playbackRate.value = map.playbackRate;

    const gain = this.ctx.createGain();
    // 力度映射：v 层已固有力度差异，音量按 velocity 比例微调（0.3~1.0）
    const velGain = 0.3 + (velocity / 127) * 0.7;
    gain.gain.value = 0;
    // 极短起音（1ms）避免 click
    gain.gain.setValueAtTime(0, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(velGain, now + 0.008);

    source.connect(gain).connect(this.master);
    source.start(now);

    const voice = {
      id: this._voiceSeq++,
      note,
      velocity,
      source,
      gain,
      released: false,
    };
    this.voices.set(voice.id, voice);

    // 松键/自然结束后清理
    source.onended = () => {
      this.voices.delete(voice.id);
    };
    return voice.id;
  }

  release(note) {
    // 将该音高所有活动 voice 释放（短指数衰减 5~50ms 防爆音）
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const [id, v] of this.voices) {
      if (v.note === note && !v.released) this._releaseVoice(v, now);
    }
  }

  _releaseVoice(v, now = this.ctx?.currentTime ?? 0) {
    if (!v || v.released) return;
    v.released = true;
    const dur = 0.03; // 30ms 指数衰减
    try {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setValueAtTime(v.gain.gain.value, now);
      v.gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      v.source.stop(now + dur + 0.02);
    } catch (_) { /* 已释放 */ }
  }

  _kill(source, gain) {
    // 强杀（voice stealing）：极短衰减
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    try {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.01);
      source.stop(now + 0.03);
    } catch (_) { /* already stopped */ }
  }

  // 当前 velocity 属哪个力度层（0~42 弱 / 43~85 中 / 86~127 强 → v1/v8/v16）
  _velocityLevel(velocity) {
    if (velocity <= 42) return 1;
    if (velocity <= 85) return 8;
    return 16;
  }

  setVolume(v) {
    this.outputVolume = v;
    if (this.master) this.master.gain.value = v;
  }

  get ready() {
    return this.state === 'ready';
  }

  // 全部音停止（回放/儿歌打断时调用）
  allNotesOff() {
    const now = this.ctx?.currentTime ?? 0;
    for (const [id, v] of [...this.voices]) {
      this._releaseVoice(v, now);
      if (!v.released) this.voices.delete(id);
    }
  }
}

// 单例导出（browser 环境，全局唯一发声引擎）
window.PianoSampler = PianoSampler;
