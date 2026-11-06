// T1 音源下载脚本（一次性）：从 SalamanderGrandPiano 仓库下载 30 键 × 3 力度层 FLAC
// 来源：https://github.com/sfzinstruments/SalamanderGrandPiano (CC-BY 3.0, Alexander Holm; sfz 重制 kinwie)
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, '..', 'src', 'renderer', 'samples');
const BASE = 'https://raw.githubusercontent.com/sfzinstruments/SalamanderGrandPiano/master/Samples/';

// 30 个 keycenter（对应 sfz region 的 pitch_keycenter），每个取 3 力度层（v1 弱 / v8 中 / v16 强）
const KEYCENTERS = ['A0','C1','D#1','F#1','A1','C2','D#2','F#2','A2','C3','D#3','F#3','A3','C4','D#4','F#4','A4','C5','D#5','F#5','A5','C6','D#6','F#6','A6','C7','D#7','F#7','A7','C8'];
const VELOCITIES = [1, 8, 16];

const files = [];
for (const kc of KEYCENTERS) {
  for (const v of VELOCITIES) files.push(`${kc}v${v}.flac`);
}

const CONCURRENCY = 8;
let done = 0;
const errors = [];

async function downloadOne(file) {
  const url = BASE + file.replace('#', '%23'); // # 在 URL 中需编码为 %23
  const dest = join(OUT, file);
  try {
    const st = await stat(dest).catch(() => null);
    if (st && st.size > 0) { done++; return; } // 已存在跳过
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${file}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(dest, buf);
    done++;
    if (done % 10 === 0 || done === files.length) process.stdout.write(`[${done}/${files.length}]\n`);
  } catch (e) {
    errors.push(e.message);
  }
}

await mkdir(OUT, { recursive: true });
console.log(`下载 ${files.length} 个 FLAC 到 ${OUT} …`);

let idx = 0;
async function worker() {
  while (idx < files.length) {
    const f = files[idx++];
    await downloadOne(f);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log(`完成: ${done}/${files.length}`);
if (errors.length) { console.error('失败:'); errors.forEach((e) => console.error(' -', e)); process.exitCode = 1; }
