// roll-test.mjs — V6 录音室卷帘验证（录音→欣赏模式回放→卷帘视图+播放头）
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

  // 复位到 play（点击 chip；P3 F 键已删除）
  await evaluate(`document.querySelector('#modeChips .mode-chip[data-mode="play"]').click(); true;`);
  await new Promise((r) => setTimeout(r, 300));

  // 录音：顶栏「● 录音」→ 按 3 键 → 顶栏「■ 停止」
  await evaluate(`document.getElementById('btnRec').click(); true;`);
  await new Promise((r) => setTimeout(r, 300));
  await press('KeyA', 150);
  await press('KeyS', 150);
  await press('KeyD', 150);
  await evaluate(`document.getElementById('btnStopRec').click(); true;`);
  const saved = await waitFor(`document.getElementById('statusText') ? /已保存录音/.test(document.getElementById('statusText').textContent) : false`, 3000);
  check('录音已保存', !!saved);

  // 进入欣赏模式（点击 chip）
  await evaluate(`document.querySelector('#modeChips .mode-chip[data-mode="enjoy"]').click(); true;`);
  await new Promise((r) => setTimeout(r, 300));
  const chip = await evaluate(`document.querySelector('#modeChips .mode-chip.active') ? document.querySelector('#modeChips .mode-chip.active').textContent : ''`);
  check('进入欣赏模式', chip.includes('欣赏'), chip);

  // 顶栏「▶ 回放」最新录音 → 卷帘视图（录音 fromSong=false → roll）
  await evaluate(`document.getElementById('btnPlayRec').click(); true;`);
  await new Promise((r) => setTimeout(r, 800));
  const roll = await evaluate(`!!document.querySelector('.roll-wrap')`);
  check('卷帘视图出现', roll);
  const notes = await evaluate(`document.querySelectorAll('.roll-note').length`);
  check('卷帘音符块生成', notes >= 3, `notes=${notes}`); // 3 键按下→至少3块
  const count = await evaluate(`document.querySelector('.rp-count') ? document.querySelector('.rp-count').textContent : ''`);
  check('卷帘计数信息', /音/.test(count), count);

  // 播放头推进
  const ph0 = await evaluate(`document.querySelector('.roll-playhead') ? document.querySelector('.roll-playhead').style.left : ''`);
  await new Promise((r) => setTimeout(r, 600));
  const ph1 = await evaluate(`document.querySelector('.roll-playhead') ? document.querySelector('.roll-playhead').style.left : ''`);
  const w0 = ph0 ? parseFloat(ph0) : 0, w1 = ph1 ? parseFloat(ph1) : 0;
  check('播放头移动', w1 > w0, `ph ${w0}→${w1}`);

  // 播放结束/停止 → 卷帘退出
  await new Promise((r) => setTimeout(r, 600));
  await evaluate(`document.getElementById('btnStopPlay').click(); true;`); // 停止
  await new Promise((r) => setTimeout(r, 400));
  const rollGone = await evaluate(`!document.querySelector('.roll-wrap')`);
  check('停止后卷帘退出', rollGone);

  ws.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== V6 汇总: ${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) { for (const f of failed) console.log('  - ' + f.name + (f.extra ? ' | ' + f.extra : '')); process.exit(1); }
  process.exit(0);
}
main().catch((e) => { console.error('ROLL-TEST-ERROR', e); process.exit(2); });
