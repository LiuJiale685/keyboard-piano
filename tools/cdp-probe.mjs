// 最小 CDP 探针：输出原始响应
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
async function main() {
  const list = JSON.parse(await httpGet('/json/list'));
  const page = list.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.addEventListener('message', (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(m.error) : p.resolve(m.result || {});
    }
  });
  await send('Runtime.enable');
  const raw = await send('Runtime.evaluate', { expression: `({ ok: true, ts: Date.now(), hasWindow: typeof window, hasDoc: !!document, son: typeof window.SONGS, stage: !!document.getElementById('stage') })`, returnByValue: true });
  console.log('RAW RESPONSE:', JSON.stringify(raw, null, 2));
  ws.close();
  process.exit(0);
}
main().catch((e) => { console.error('ERR', e); process.exit(2); });
