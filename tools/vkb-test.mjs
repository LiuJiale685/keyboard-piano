// vkb-test.mjs — 第二批视觉层验证（V0/V1 模式循环 + 弹奏动画 / P3：chip 点击 + 88 键）
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

  // 复位到弹奏模式（前序测试可能遗留其他模式）
async function cycleTo(mode) {
  for (let i = 0; i < 6; i++) {
    const cur = await evaluate(`document.querySelector('#modeChips .mode-chip.active') ? document.querySelector('#modeChips .mode-chip.active').dataset.mode : ''`);
    if (cur === mode) return true;
    await evaluate(`document.querySelector('#modeChips .mode-chip[data-mode="${mode}"]').click(); true;`);
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
const resetOk = await cycleTo('play');
if (!resetOk) { console.error('VKB-TEST-ERROR: 无法复位到弹奏模式'); process.exit(2); }

// ---- V0: 模式循环（点击 chips） ----
await evaluate(`document.querySelector('#modeChips .mode-chip[data-mode="enjoy"]').click(); true;`);
await new Promise((r) => setTimeout(r, 300));
let cur = await evaluate(`document.querySelector('#modeChips .mode-chip.active') ? document.querySelector('#modeChips .mode-chip.active').textContent : ''`);
check('点击 chip → 欣赏模式', cur.includes('欣赏'), cur);

await evaluate(`document.querySelector('#modeChips .mode-chip[data-mode="practice"]').click(); true;`);
await new Promise((r) => setTimeout(r, 300));
cur = await evaluate(`document.querySelector('#modeChips .mode-chip.active') ? document.querySelector('#modeChips .mode-chip.active').textContent : ''`);
check('点击 chip → 练谱模式', cur.includes('练谱'), cur);

await evaluate(`document.querySelector('#modeChips .mode-chip[data-mode="challenge"]').click(); true;`);
await new Promise((r) => setTimeout(r, 300));
cur = await evaluate(`document.querySelector('#modeChips .mode-chip.active') ? document.querySelector('#modeChips .mode-chip.active').textContent : ''`);
check('点击 chip → 挑战模式', cur.includes('挑战'), cur);

await evaluate(`document.querySelector('#modeChips .mode-chip[data-mode="play"]').click(); true;`);
await new Promise((r) => setTimeout(r, 300));
cur = await evaluate(`document.querySelector('#modeChips .mode-chip.active') ? document.querySelector('#modeChips .mode-chip.active').textContent : ''`);
check('点击 chip → 弹奏模式', cur.includes('弹奏'), cur);

// ---- V0: 虚拟键盘渲染（P3：88 键 21~108） ----
const vkbCount = await evaluate(`document.querySelectorAll('#vkbWrap .vkb-key').length`);
check('虚拟键盘键数 (21~108 = 88键)', vkbCount === 88, `count=${vkbCount}`);

  // ---- V1: 弹奏模式按下动画 + 气泡 ----
  // 弹奏模式下按下 KeyA (C4=midi60)：down 后立即检查 .on，再 up
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', bubbles: true, cancelable: true })); true;`);
  await new Promise((r) => setTimeout(r, 150));
  const bubble = await evaluate(`document.querySelectorAll('.sky .sky-bubble').length`);
  check('弹奏模式按下产生气泡', bubble >= 1, `bubbles=${bubble}`);
  const vkbActive = await evaluate(`document.querySelectorAll('#vkbWrap .vkb-key.on').length`);
  check('按下键高亮 .on', vkbActive >= 1, `active=${vkbActive}`);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA', bubbles: true, cancelable: true })); true;`);
  await new Promise((r) => setTimeout(r, 300));
  const activeAfter = await evaluate(`document.querySelectorAll('#vkbWrap .vkb-key.on').length`);
  check('松键后 .on 清除', activeAfter === 0, `active=${activeAfter}`);
  // 气泡动画结束自动移除
  await new Promise((r) => setTimeout(r, 2900));
  const bubbleAfter = await evaluate(`document.querySelectorAll('.sky .sky-bubble').length`);
  check('气泡动画结束自动移除', bubbleAfter === 0, `bubbles=${bubbleAfter}`);

  ws.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== V0/V1 汇总: ${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) { for (const f of failed) console.log('  - ' + f.name + (f.extra ? ' | ' + f.extra : '')); process.exit(1); }
  process.exit(0);
}
main().catch((e) => { console.error('VKB-TEST-ERROR', e); process.exit(2); });
