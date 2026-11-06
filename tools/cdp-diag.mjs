// 诊断脚本：检查渲染层真实状态（window 全局、DOM、错误）
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
  return r.result?.value;
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
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result || {});
    }
  });
  await send('Runtime.enable');
  await send('Log.enable');

  const checks = [
    ['typeof window.SONGS', `typeof window.SONGS`],
    ['typeof window.PianoSampler', `typeof window.PianoSampler`],
    ['typeof window.KeymapRegistry', `typeof window.KeymapRegistry`],
    ['typeof window.KeyboardRouter', `typeof window.KeyboardRouter`],
    ['typeof window.Recorder', `typeof window.Recorder`],
    ['typeof window.Playback', `typeof window.Playback`],
    ['typeof window.NoteEventsToMidi', `typeof window.NoteEventsToMidi`],
    ['typeof window.SongToEvents', `typeof window.SongToEvents`],
    ['window.onerror hint', `typeof window.onerror`],
    ['has stage', `!!document.getElementById('stage')`],
    ['has statusText', `!!document.getElementById('statusText')`],
    ['has loadErr', `!!document.getElementById('loadErr')`],
    ['loadErr text', `document.getElementById('loadErr') ? document.getElementById('loadErr').style.display + '|' + document.getElementById('loadErr').textContent : 'N/A'`],
    ['body 前 200 字符', `document.body ? document.body.innerHTML.substring(0, 200) : 'N/A'`],
  ];
  for (const [name, expr] of checks) {
    try {
      const r = await evaluate(expr);
      console.log(`${name} => ${JSON.stringify(r?.value)}`);
    } catch (e) {
      console.log(`${name} => ERROR ${e.message}`);
    }
  }

  // 抓取 pending 的 exception 事件
  const ex = await send('Runtime.evaluate', { expression: `window.__seenErrors = window.__seenErrors || []; window.__seenErrors.join(';')`, returnByValue: true });
  console.log('seenErrors =>', JSON.stringify(ex.result?.value));

  ws.close();
  process.exit(0);
}
main().catch((e) => { console.error('DIAG-ERROR', e); process.exit(2); });
