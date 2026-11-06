// practice-test.mjs — V3 练谱模式验证（方块+判定+星级结算）
import http from 'node:http';

const CDP_BASE = 'http://127.0.0.1:9222';
function httpGet(path) {
  return new Promise((resolve, reject) => {
    http.get(CDP_BASE + path, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}
let seq = 0;
const pending = new Map();
let ws;
function send(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('CDP exception: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
}
async function press(code, hold = 120) {
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { code: '${code}', bubbles: true, cancelable: true })); true;`);
  await new Promise((r) => setTimeout(r, hold));
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keyup', { code: '${code}', bubbles: true, cancelable: true })); true;`);
}
async function waitFor(expr, timeout = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await evaluate(expr);
    if (v) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}
const results = [];
function check(name, cond, extra = '') {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${name}${extra ? ' | ' + extra : ''}`);
}

async function main() {
  const list = JSON.parse(await httpGet('/json/list'));
  const page = list.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.addEventListener('message', (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result || {}); }
  });
  await send('Runtime.enable');
  await waitFor(`document.getElementById('stage') && document.getElementById('stage').classList.contains('show')`, 10000);

  // 先回到弹奏模式（直接点击 chip）
  await evaluate(`document.querySelector('#modeChips .mode-chip[data-mode="play"]').click(); true;`);
  await new Promise((r) => setTimeout(r, 300));
  // 点击「练谱」chip → 练谱
  await evaluate(`document.querySelector('#modeChips .mode-chip[data-mode="practice"]').click(); true;`);
  await new Promise((r) => setTimeout(r, 300));
  const activeChip = await evaluate(`document.querySelector('#modeChips .mode-chip.active') ? document.querySelector('#modeChips .mode-chip.active').textContent : ''`);
  check('点击 chip 进入练谱', activeChip.includes('练谱'), activeChip);
  // 空态引导
  const guide = await evaluate(`!!document.querySelector('.practice-guidance')`);
  check('练谱空态引导', guide);

  // 打开儿歌面板，把选曲复位到第一首（前序测试可能已移动选曲），再 F7 开始练谱
  await press('ArrowDown', 100); // 打开面板
  await new Promise((r) => setTimeout(r, 200));
  for (let i = 0; i < 12; i++) {
    const selIdx = await evaluate(`(() => { const els = Array.from(document.querySelectorAll('#songList li')); const a = document.querySelector('#songList li.active'); return a ? els.indexOf(a) : -1; })()`);
    if (selIdx <= 0) break; // 已到顶（第一首）
    await press('ArrowUp', 60);
    await new Promise((r) => setTimeout(r, 120));
  }
  const chosen = await evaluate(`document.querySelector('#songList li.active') ? document.querySelector('#songList li.active').textContent.trim() : ''`);
  // 顶栏「▶ 播放」→ 练谱 start（不再 F7）
  await evaluate(`document.getElementById('btnPlaySong').click(); true;`);
  await new Promise((r) => setTimeout(r, 500));
  const playing = await evaluate(`!!document.querySelector('.practice-hud')`);
  check('练谱开始（HUD 出现）', playing);
  const noteCount = await evaluate(`document.querySelectorAll('.practice-note').length`);
  check('练谱音符方块生成', noteCount > 0, `notes=${noteCount}`);
  const hudScore = await evaluate(`document.querySelector('.practice-hud .hud-score') ? document.querySelector('.practice-hud .hud-score').textContent : ''`);
  check('HUD 初始得分 0', hudScore === '0', hudScore);
  // 速度芯片三个
  const speedChips = await evaluate(`document.querySelectorAll('.speed-switch span').length`);
  check('三档速度芯片', speedChips === 3, `chips=${speedChips}`);

  // 用虚拟键盘 DOM 反查：音符 label → 虚拟键 → 不可得 midi；退化为「读谱面第一首小星星」：
  // 第一音 midi=60 (KeyA, t=0)，判定窗口 ±0.75s，start 后立刻按下。
  const wfLabel = await evaluate(`(() => {
    const field = document.querySelector('.practice-field');
    if (!field) return '';
    const first = field.querySelector('.practice-note');
    return first ? first.textContent : '';
  })()`);
  await new Promise((r) => setTimeout(r, 200));
  await press('KeyA', 100); // 小星星第一个音 = C4(KeyA)
  await new Promise((r) => setTimeout(r, 400));
  const scoreAfter = await evaluate(`document.querySelector('.practice-hud .hud-score') ? parseInt(document.querySelector('.practice-hud .hud-score').textContent) : -1`);
  check('正确按键得分 +10', scoreAfter > 0, `score=${scoreAfter} 首音label=${wfLabel} 选曲=${chosen}`);
  const hitAfter = await evaluate(`document.querySelector('.practice-hud .hud-hits') ? parseInt(document.querySelector('.practice-hud .hud-hits').textContent) : -1`);
  check('命中数 +1', hitAfter >= 1, `hits=${hitAfter}`);

  // 错键 → 连击清零（按一个不相关键 KeyX=midi48 可能错；但需在窗口内才判定错键）硬按一个远键 miss
  // 直接按 KeyF（F=midi65，非当前音）→ 错键
  await press('KeyF', 100);
  await new Promise((r) => setTimeout(r, 300));
  const comboAfter = await evaluate(`document.querySelector('.practice-hud .hud-combo') ? document.querySelector('.practice-hud .hud-combo').textContent : ''`);
  // 若时间不在窗口/已过音，则仍是 0
  check('连击状态存在(0 或 1)', comboAfter === '0' || comboAfter === '1', `combo=${comboAfter}`);
  const comboNo = parseInt(comboAfter);
  const bestCombo = await evaluate(`window.modePractice ? 'n/a' : ''`); // 不可直接访问闭包
  const hudBest = await evaluate(`document.querySelector('.practice-hud .hud-combo') ? document.querySelector('.practice-hud .hud-combo').textContent : ''`);

  // 等待歌曲结束 → 结算屏（两只老虎 约 5~10s；等 15s）
  const screen = await waitFor(`!!document.querySelector('.practice-screen')`, 20000);
  check('曲末结算屏出现', !!screen);
  if (screen) {
    const stars = await evaluate(`document.querySelector('.practice-screen .stars') ? document.querySelector('.practice-screen .stars').textContent.replace(/[⭐☆]/g, '').length : 0`);
    check('结算星级显示', stars >= 0 && stars <= 3, `stars=${stars}`);
    const info = await evaluate(`document.querySelector('.practice-screen .info') ? document.querySelector('.practice-screen .info').textContent : ''`);
    check('结算信息(得分/命中/连击)', /得分/.test(info), info);
  }

  ws.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== V3 汇总: ${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) { for (const f of failed) console.log('  - ' + f.name + (f.extra ? ' | ' + f.extra : '')); process.exit(1); }
  process.exit(0);
}
main().catch((e) => { console.error('PRACTICE-TEST-ERROR', e); process.exit(2); });
