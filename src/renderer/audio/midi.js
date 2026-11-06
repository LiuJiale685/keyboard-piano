// midi.js — 导出标准 MIDI（SMF 格式 1），P1-1 录制导出
'use strict';

// NoteEvent 序列 → Uint8Array 标准 MIDI 文件（bpm 可选，默认 120）
function noteEventsToMidi(events, bpm = 120) {
  const TICK = 480;
  const secPerTick = 60 / bpm / TICK;

  // 1) 生成 note-on/note-off 绝对 tick
  const trackEvents = [];
  const active = new Map();
  for (const e of events) {
    const tick = Math.max(0, Math.round(e.t / secPerTick));
    if (e.a === 'down' && !active.has(e.n)) {
      active.set(e.n, tick);
      trackEvents.push({ tt: tick, msg: [0x90, e.n, e.v || 96] });
    } else if (e.a === 'up' && active.has(e.n)) {
      const on = active.get(e.n);
      trackEvents.push({ tt: Math.max(tick, on + 1), msg: [0x80, e.n, 0] });
      active.delete(e.n);
    }
  }
  const last = trackEvents.length ? trackEvents[trackEvents.length - 1].tt : 0;
  for (const [n, on] of active) {
    trackEvents.push({ tt: Math.max(on + 1, last), msg: [0x80, n, 0] });
  }
  trackEvents.sort((a, b) => a.tt - b.tt);

  // 2) 变长编码
  function vlv(n) {
    const o = [n & 0x7f];
    n >>>= 7;
    while (n > 0) { o.unshift((n & 0x7f) | 0x80); n >>>= 7; }
    return o;
  }

  // 3) 组 track 数据（delta + 事件）
  const payload = [];
  let prev = 0;
  for (const { tt, msg } of trackEvents) {
    payload.push(...vlv(tt - prev), ...msg);
    prev = tt;
  }
  payload.push(0, 0xff, 0x2f, 0x00); // end of track

  // 4) 包装 track 块
  const trackChunk = [
    0x4d, 0x54, 0x72, 0x6b,
    (payload.length >> 24) & 0xff, (payload.length >> 16) & 0xff,
    (payload.length >> 8) & 0xff, payload.length & 0xff,
    ...payload,
  ];

  // 5) tempo meta（60000000/bpm microseconds/quarter）
  const us = Math.round(60000000 / bpm);
  const tempoMeta = [0, 0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff];
  // 头部已含 8 字节 header，tempo 直接插在 track 数据最前
  trackChunk.splice(8, 0, ...tempoMeta);

  // 6) 头块 + track
  const header = [
    0x4d, 0x54, 0x68, 0x64,
    0x00, 0x00, 0x00, 0x06,
    0x00, 0x01,          // format 1
    0x00, 0x01,          // 1 track
    0x01, 0xe0,          // division 480
  ];
  return new Uint8Array([...header, ...trackChunk]);
}

function midiToBase64(midiBytes) {
  let bin = '';
  for (const b of midiBytes) bin += String.fromCharCode(b);
  return 'data:audio/midi;base64,' + btoa(bin);
}

window.NoteEventsToMidi = noteEventsToMidi;
window.MidiToBase64 = midiToBase64;
