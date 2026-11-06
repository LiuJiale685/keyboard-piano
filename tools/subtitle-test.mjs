// subtitle-test.mjs — V4 简谱字幕带验证（卡拉OK高亮）
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

  // 复位到 play
  await evaluate(`document.querySelector('#modeChips .mode-chip[data-mode="play"]').click(); true;`);
  await new Promise((r) => setTimeout(r, 300));
  // 进入欣赏并播放
  await evaluate(`document.querySelector('#modeChips .mode-chip[data-mode="enjoy"]').click(); true;`);
  await new Promise((r) => setTimeout(r, 300));
  await press('ArrowDown', 100);
  await new Promise((r) => setTimeout(r, 200));
  await press('ArrowRight', 100); // songPlay
  await waitFor(`document.getElementById('statusText') ? /播放中/.test(document.getElementById('statusText').textContent) : false`, 5000);

  await new Promise((r) => setTimeout(r, 600));
  // 字幕带元素
  const tones = await evaluate(`document.querySelectorAll('#subtitleBar .sub-tone').length`);
  check('字幕带简谱序列生成', tones > 0, `tones=${tones}`);
  const show = await evaluate(`document.getElementById('subtitleBar').classList.contains('show')`);
  check('字幕带可见', show);

  // 等待高亮推进（active 从无到有；返回 idx+1 以免索引 0 被 waitFor 当成假值）
  const activeHit = await waitFor(`(() => { const els = document.querySelectorAll('#subtitleBar .sub-tone'); let a = -1; for (let i = 0; i < els.length; i++) if (els[i].classList.contains('active')) { a = i; break; } return a + 1; })()`, 3000);
  const activeIdx = activeHit == null ? null : activeHit - 1;
  check('卡拉OK高亮推进', activeIdx !== null && activeIdx >= 0, `activeIdx=${activeIdx}`);

  // 高亮会前进（2s 后 active 索引应更大或至少仍存在）
  await new Promise((r) => setTimeout(r, 1500));
  const activeIdx2 = await evaluate(`(() => { const els = document.querySelectorAll('#subtitleBar .sub-tone'); let a = -1; for (let i = 0; i < els.length; i++) if (els[i].classList.contains('active')) { a = i; break; } return a; })()`);
  check('高亮随时间前进', activeIdx2 > (activeIdx ?? -1), `activeIdx2=${activeIdx2}`);

  // 字幕内容为简谱数字（1-7），非空白
  const text = await evaluate(`document.getElementById('subtitleBar').textContent.replace(/\\s/g, '')`);
  check('字幕为简谱数字', /^[1-7—\-]+$/.test(text) && text.length > 0, text.slice(0, 30));

  // 停止后字幕清空
  await evaluate(`document.getElementById('btnStopSong').click(); true;`);
  await new Promise((r) => setTimeout(r, 400));
  const cleared = await evaluate(`document.getElementById('subtitleBar').innerHTML === '' || !document.getElementById('subtitleBar').classList.contains('show')`);
  check('停止后字幕清理', cleared);

  ws.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== V4 汇总: ${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) { for (const f of failed) console.log('  - ' + f.name + (f.extra ? ' | ' + f.extra : '')); process.exit(1); }
  process.exit(0);
}
main().catch((e) => { console.error('SUBTITLE-TEST-ERROR', e); process.exit(2); });
