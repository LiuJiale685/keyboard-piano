// enjoy-test.mjs — V2 欣赏模式验证（瀑布+播放条+键盘点亮）
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

  // 复位到 play（点击 chip）
  await evaluate(`document.querySelector('#modeChips .mode-chip[data-mode="play"]').click(); true;`);
  await new Promise((r) => setTimeout(r, 300));
  // 点击「欣赏」chip
  await evaluate(`document.querySelector('#modeChips .mode-chip[data-mode="enjoy"]').click();`);
  await new Promise((r) => setTimeout(r, 300));
  const activeChip = await evaluate(`document.querySelector('#modeChips .mode-chip.active') ? document.querySelector('#modeChips .mode-chip.active').textContent : ''`);
  check('点击 chip 进入欣赏模式', activeChip.includes('欣赏'), activeChip);

  // 播放条存在
  const playbar = await evaluate(`!!document.querySelector('.enjoy-playbar')`);
  check('欣赏模式含播放条', playbar);

  // 打开儿歌面板并播放第一首
  await evaluate(`document.getElementById('btnPlaySong').click(); true;`); // 顶栏「▶ 播放」默认播当前选中
  const playing = await waitFor(`document.getElementById('statusText') ? /播放中/.test(document.getElementById('statusText').textContent) : false`, 5000);
  check('儿歌播放中', !!playing);

  // 瀑布方块生成（等待 1s）
  await new Promise((r) => setTimeout(r, 1200));
  const wfCount = await evaluate(`document.querySelectorAll('.enjoy-waterfall .wf-note').length`);
  check('瀑布音符方块生成', wfCount > 0, `wf-note=${wfCount}`);

  // 播放条标题
  const barTitle = await evaluate(`document.querySelector('.enjoy-playbar .t-title') ? document.querySelector('.enjoy-playbar .t-title').textContent : ''`);
  check('播放条显示曲名', barTitle.length > 0, barTitle);

  // 键盘点亮（回放 onEvent 点亮）：播放中多次采样，任一时刻有亮键即过
  let litMax = 0;
  for (let i = 0; i < 6; i++) {
    const lit = await evaluate(`document.querySelectorAll('#vkbWrap .vkb-key.on').length`);
    litMax = Math.max(litMax, lit);
    await new Promise((r) => setTimeout(r, 200));
  }
  check('回放点亮虚拟键', litMax > 0, `litMax=${litMax}`);
  await new Promise((r) => setTimeout(r, 1000));

  // 播放推进：进度条宽度 > 0
  const trackW = await evaluate(`(() => { const t = document.querySelector('.enjoy-playbar .track'); if (!t) return 0; const i = t.querySelector('i'); return i ? (parseFloat(i.style.width) || 0) : 0; })()`);
  check('播放条进度推进', trackW > 0, `w=${trackW}`);

  // 停止（顶栏「■ 停止」）
  await evaluate(`document.getElementById('btnStopSong').click(); true;`);
  const stopped = await waitFor(`document.getElementById('statusText') ? /停止/.test(document.getElementById('statusText').textContent) : false`, 3000);
  check('顶栏停止回放', !!stopped, stopped ? '' : await evaluate(`document.getElementById('statusText').textContent`));

  ws.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== V2 汇总: ${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) { for (const f of failed) console.log('  - ' + f.name + (f.extra ? ' | ' + f.extra : '')); process.exit(1); }
  process.exit(0);
}
main().catch((e) => { console.error('ENJOY-TEST-ERROR', e); process.exit(2); });
