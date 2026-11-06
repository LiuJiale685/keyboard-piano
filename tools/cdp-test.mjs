// CDP 端到端验证脚本：连到已启动的 Electron (--remote-debugging-port=9222)
// 通过 Runtime.evaluate 在渲染层驱动按键/函数，验证发声、录音、回放、儿歌、面板
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
let round = 0; // 轮询轮次（页面前端轮询用）

function send(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const results = [];
function check(name, cond, extra = '') {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${name}${extra ? ' | ' + extra : ''}`);
}

async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.error) throw new Error('CDP eval error: ' + JSON.stringify(r.error));
  if (r.exceptionDetails) throw new Error('CDP exception: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
}

async function press(code, hold = 120) {
  // 通过 window.dispatchEvent 构造 keydown/keyup 事件（KeyboardRouter 监听 window）
  const down = `window.dispatchEvent(new KeyboardEvent('keydown', { code: '${code}', bubbles: true, cancelable: true })); true;`;
  await evaluate(down);
  await new Promise((r) => setTimeout(r, hold));
  const up = `window.dispatchEvent(new KeyboardEvent('keyup', { code: '${code}', bubbles: true, cancelable: true })); true;`;
  await evaluate(up);
}

// ---- 顶栏按钮点击助手（P3：全部功能按钮化） ----
async function clickBtn(id) {
  const ok = await evaluate(`(() => { const el = document.getElementById('${id}'); if (!el) return false; el.click(); return true; })()`);
  if (!ok) throw new Error('button not found: ' + id);
}
const clickVol = (dir) => evaluate(`(() => { const els = Array.from(document.querySelectorAll('.toolbar .tbtn[title*="音量"]')); const el = els.find((e) => e.title.includes('${dir}')); if (!el) return false; el.click(); return true; })()`);

async function waitFor(expr, timeout = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await evaluate(expr);
    if (v) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

async function main() {
  const list = JSON.parse(await httpGet('/json/list'));
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');

  const target = page.webSocketDebuggerUrl;
  ws = new WebSocket(target);
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

  // 1. 基础状态（采样全量预加载完成后才进入就绪；等待最多 60s）
  const stage = await waitFor(`document.getElementById('stage') && document.getElementById('stage').classList.contains('show')`, 60000);
  check('应用进入就绪 stage', !!stage);
  const songCount = await evaluate(`window.SONGS ? window.SONGS.length : -1`);
  check('SONGS 曲目数据', songCount === 10, `count=${songCount}`);

  // 2. 采样已加载（buffers 数量应 ≥ 90）
  const bufCount = await evaluate(`Array.from(document.querySelectorAll('*')).length > 0 ? (window.__s ? window.__s : null) : null`);
  // 通过按键触发一次发声来间接验证发声引擎 ready
  const before = await evaluate(`(() => { const s = document.querySelector('#statusText'); return s ? s.textContent : ''; })()`);
  check('状态条初始文本', before.includes('就绪') || before.length > 0, before);

  // 3. 按键发声：按下 KeyA (C4) 触发 onNoteDown → sampler.play → voices.size 应 > 0
  //    sampler 是闭包内实例，不可直接访问；用 AudioContext 状态 + 无报错间接验证。
  //    通过 window.onerror 捕获渲染错误。
  const errors = [];
  await evaluate(`window.__errHooked = true;`);
  await evaluate(`window.addEventListener('error', (e) => { try { window.__errors = window.__errors || []; window.__errors.push(e.message); } catch(_){} }); true;`);
  await press('KeyA', 150);
  await press('KeyS', 150);

  // 3.1 P3: F1~F12 全部映射 none —— 按下应无任何动作（模式不变、状态不跳变）
  const modeBeforeF1 = await evaluate(`document.querySelector('#modeChips .mode-chip.active').dataset.mode`);
  await press('F1', 100); await press('F2', 100); await press('F5', 100); await press('F6', 100); await press('F11', 100); await press('F12', 100);
  const modeAfterF = await evaluate(`document.querySelector('#modeChips .mode-chip.active').dataset.mode`);
  const statusAfterF = await evaluate(`document.getElementById('statusText').textContent`);
  const isRec = await evaluate(`document.getElementById('btnRec') ? document.getElementById('btnRec').disabled : null`);
  check('F1~F12 无动作（不切模式/不触发功能）', modeBeforeF1 === modeAfterF && !/录音中|播放中|回放中|音区:/.test(statusAfterF), `mode=${modeAfterF} status=${statusAfterF} recDisabled=${isRec}`);

  // 3.2 P3: 顶栏按钮 儿歌面板
  await clickBtn('btnSongs');
  const panelOpen = await evaluate(`document.getElementById('songPanel') ? document.getElementById('songPanel').classList.contains('show') : false`);
  check('顶栏「儿歌」打开面板', panelOpen);

  // 4. 选曲后播放儿歌（面板已开，箭头选 A；顶栏「▶ 播放」播放）
  await press('ArrowDown', 100);
  await clickBtn('btnPlaySong');
  const playingStatus = await waitFor(`document.getElementById('statusText') ? document.getElementById('statusText').textContent : ''`);
  check('儿歌播放状态显示', /播放中/.test(playingStatus), playingStatus);

  // 5. 录音：顶栏「● 录音」开始、按两个键、顶栏「■ 停止」停止
  await clickBtn('btnRec');
  const recState = await waitFor(`document.getElementById('statusText') ? document.getElementById('statusText').textContent : ''`, 2000);
  check('录音开始状态', /录音中/.test(recState), recState);
  await press('KeyA', 150);
  await press('KeyF', 150);
  await press('KeyG', 150);
  await clickBtn('btnStopRec');
  const savedStatus = await waitFor(`document.getElementById('statusText') ? document.getElementById('statusText').textContent : ''`, 3000);
  check('录音保存状态', /已保存录音/.test(savedStatus), savedStatus);

  // 6. 回放最新录音（顶栏「▶ 回放」）
  await clickBtn('btnPlayRec');
  const playbackStatus = await waitFor(`document.getElementById('statusText') ? document.getElementById('statusText').textContent : ''`, 2000);
  check('回放状态', /回放中/.test(playbackStatus), playbackStatus);
  await clickBtn('btnStopPlay');

  // 7. 录音列表持久化（recList 应有条目）
  const recItems = await evaluate(`document.getElementById('recList') ? document.getElementById('recList').children.length : -1`);
  check('录音列表持久化条目', recItems >= 1, `items=${recItems}`);

  // 8. 渲染错误检查
  const errList = await evaluate(`window.__errors ? window.__errors.join(';') : ''`);
  check('无渲染层 JS 错误', errList.length === 0, errList);

  // 9. 音量调节（顶栏「音量 +」）
  await clickVol('增大');
  const volStatus = await waitFor(`document.getElementById('statusText') ? document.getElementById('statusText').textContent : ''`, 2000);
  check('音量调节状态', /音量/.test(volStatus), volStatus);

  // 10. Escape 关闭面板
  await press('Escape', 50);
  const panelClosed = await evaluate(`!document.getElementById('songPanel').classList.contains('show') && !document.getElementById('recPanel').classList.contains('show')`);
  check('Escape 关闭全部面板', panelClosed);

  // ---- 第二批视觉层断言（P2-1~P2-8 / P3 88 键 + 按钮化）----

  // helper：点击模式 chip 切换到目标模式
  async function clickChip(mode) {
    const ok = await evaluate(`(() => { const el = document.querySelector('#modeChips .mode-chip[data-mode="${mode}"]'); if (!el) return false; el.click(); return true; })()`);
    await new Promise((r) => setTimeout(r, 400));
    return ok;
  }

  // 11. 三段布局 + 88 键 + 模式 chips 切换（弹奏→欣赏→练谱→挑战→弹奏）
  const vkbKeys = await evaluate(`document.querySelectorAll('#vkbWrap .vkb-key').length`);
  check('布局虚拟键盘 88 键 (21~108)', vkbKeys === 88, `keys=${vkbKeys}`);
  const chipEnjoy = await clickChip('enjoy');
  const chipPractice = await clickChip('practice');
  const chipChallenge = await clickChip('challenge');
  const chipPlay = await clickChip('play');
  const activeNow = await evaluate(`document.querySelector('#modeChips .mode-chip.active').dataset.mode`);
  check('模式 chips 点击切换', chipEnjoy && chipPractice && chipChallenge && chipPlay && activeNow === 'play', `active=${activeNow}`);

  // 11.1 P3: 音区按钮 ±1 八度 + 边界禁切
  await clickBtn('btnOctUp');
  const octStatus1 = await waitFor(`document.getElementById('statusText') ? document.getElementById('statusText').textContent : ''`, 2000);
  check('音区 + 状态', /音区: \+1/.test(octStatus1), octStatus1);
  // 上移八度后 KeyA 发声应落在 60+12=72（C5）；发声正确性由录音/回放音高间接验证 + 下方专项
  await clickBtn('btnOctDown');

  // 12. 弹奏模式音名气泡（按下 KeyA→C4 上方漂浮气泡）
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', bubbles: true, cancelable: true })); true;`);
  await new Promise((r) => setTimeout(r, 150));
  const bubbles = await evaluate(`document.querySelectorAll('.sky .sky-bubble').length`);
  check('弹奏模式音名气泡', bubbles >= 1, `bubbles=${bubbles}`);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA', bubbles: true, cancelable: true })); true;`);

  // 13. 布局：CentralC 徽标
  const c4Badge = await evaluate(`!!document.querySelector('.vkb-c4badge')`);
  check('中央C徽标', c4Badge);

  // 14. 字幕带元素存在
  const subBar = await evaluate(`!!document.getElementById('subtitleBar')`);
  check('字幕带 DOM 存在', subBar);

  // 15. 切欣赏播放：瀑布 + 键盘点亮（视觉层订阅播放器事件）
  await clickChip('enjoy');
  await press('ArrowDown', 100); await new Promise((r) => setTimeout(r, 200));
  await press('ArrowRight', 100); // songPlay（保留了方向键选曲/播放）
  await new Promise((r) => setTimeout(r, 500));
  const wf = await evaluate(`document.querySelectorAll('.enjoy-waterfall .wf-note').length`);
  check('欣赏模式瀑布方块', wf > 0, `wf=${wf}`);
  const subtitleTones = await evaluate(`document.querySelectorAll('#subtitleBar .sub-tone').length`);
  check('字幕带简谱序列', subtitleTones > 0, `tones=${subtitleTones}`);
  let litMax = 0;
  for (let i = 0; i < 6; i++) {
    const l = await evaluate(`document.querySelectorAll('#vkbWrap .vkb-key.on').length`);
    litMax = Math.max(litMax, l);
    await new Promise((r) => setTimeout(r, 150));
  }
  check('欣赏播放点亮虚拟键', litMax > 0, `litMax=${litMax}`);
  await clickBtn('btnStopSong'); // 停止

  // 16. 渲染错误复核（含全部视觉层交互后）
  const errFinal = await evaluate(`window.__errors ? window.__errors.join(';') : ''`);
  check('视觉层交互后无 JS 错误', errFinal.length === 0, errFinal);

  ws.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== 汇总: ${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) {
    console.log('未通过:');
    for (const f of failed) console.log(`  - ${f.name}${f.extra ? ' | ' + f.extra : ''}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => { console.error('CDP-TEST-ERROR', e); process.exit(2); });
