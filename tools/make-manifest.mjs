// 生成采样 manifest.json：Salamander 30 keycenter × 3 力度层 → 覆盖 MIDI 21~108
// keycenter 采样间隔为小三度，中间键播放时变速变调（详见 sfz region 表）
import { writeFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = join(__dir, '..', 'src', 'renderer', 'samples');

// sfz region 表（pitch_keycenter, lokey, hikey）——唯一真实采样所在 MIDI 键
const CENTERS = [
  { key: 'A0',   midi: 21,  lo: 21,  hi: 22 },
  { key: 'C1',   midi: 24,  lo: 23,  hi: 25 },
  { key: 'D#1',  midi: 27,  lo: 26,  hi: 28 },
  { key: 'F#1',  midi: 30,  lo: 29,  hi: 31 },
  { key: 'A1',   midi: 33,  lo: 32,  hi: 34 },
  { key: 'C2',   midi: 36,  lo: 35,  hi: 37 },
  { key: 'D#2',  midi: 39,  lo: 38,  hi: 40 },
  { key: 'F#2',  midi: 42,  lo: 41,  hi: 43 },
  { key: 'A2',   midi: 45,  lo: 44,  hi: 46 },
  { key: 'C3',   midi: 48,  lo: 47,  hi: 49 },
  { key: 'D#3',  midi: 51,  lo: 50,  hi: 52 },
  { key: 'F#3',  midi: 54,  lo: 53,  hi: 55 },
  { key: 'A3',   midi: 57,  lo: 56,  hi: 58 },
  { key: 'C4',   midi: 60,  lo: 59,  hi: 61 },
  { key: 'D#4',  midi: 63,  lo: 62,  hi: 64 },
  { key: 'F#4',  midi: 66,  lo: 65,  hi: 67 },
  { key: 'A4',   midi: 69,  lo: 68,  hi: 70 },
  { key: 'C5',   midi: 72,  lo: 71,  hi: 73 },
  { key: 'D#5',  midi: 75,  lo: 74,  hi: 76 },
  { key: 'F#5',  midi: 78,  lo: 77,  hi: 79 },
  { key: 'A5',   midi: 81,  lo: 80,  hi: 82 },
  { key: 'C6',   midi: 84,  lo: 83,  hi: 85 },
  { key: 'D#6',  midi: 87,  lo: 86,  hi: 88 },
  { key: 'F#6',  midi: 90,  lo: 89,  hi: 91 },
  { key: 'A6',   midi: 93,  lo: 92,  hi: 94 },
  { key: 'C7',   midi: 96,  lo: 95,  hi: 97 },
  { key: 'D#7',  midi: 99,  lo: 98,  hi: 100 },
  { key: 'F#7',  midi: 102, lo: 101, hi: 103 },
  { key: 'A7',   midi: 105, lo: 104, hi: 106 },
  { key: 'C8',   midi: 108, lo: 107, hi: 108 },
];

const VELOCITY_LEVELS = [
  { id: 1,  maxVel: 42 },   // v1  弱 (lowest piano)
  { id: 8,  maxVel: 85 },   // v8  中 (mezzo)
  { id: 16, maxVel: 127 },  // v16 强 (forte)
];

// 每个 MIDI 键 → 应使用哪个 keycenter（含变速比例 playbackRate）
const keyboard = [];
for (let midi = 21; midi <= 108; midi++) {
  const center = CENTERS.find((c) => midi >= c.lo && midi <= c.hi);
  // playbackRate = 2^((midi - center.midi)/12)，让采样变调至目标音高
  const rate = 2 ** ((midi - center.midi) / 12);
  keyboard.push({ midi, keyName: midiToName(midi), from: `note${center.midi}`, sample: `${center.key}`, playbackRate: +rate.toFixed(5) });
}

function midiToName(midi) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midi / 12) - 1;
  return names[midi % 12] + octave;
}

const manifest = {
  source: 'Salamander Grand Piano V3',
  author: 'Alexander Holm (sfz remap: kinwie)',
  license: 'CC BY 3.0',
  url: 'https://github.com/sfzinstruments/SalamanderGrandPiano',
  format: 'flac',
  sampleRate: 48000,
  velocityLevels: VELOCITY_LEVELS.map((v) => v.id),
  keyboard,
};

await writeFile(join(__dir, '..', 'src', 'renderer', 'samples', 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
console.log('manifest 生成完成:', manifest.keyboard.length, '键,', CENTERS.length, 'keys ×', VELOCITY_LEVELS.length, '力度层');
