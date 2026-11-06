// challenge-test.mjs — V5 挑战模式验证（打地鼠/圆环/连击/星级）
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
  // 点击「挑战」chip → 挑战
  await evaluate(`document.querySelector('#modeChips .mode-chip[data-mode="challenge"]').click(); true;`);
  await new Promise((r) => setTimeout(r, 300));
  const activeChip = await evaluate(`document.querySelector('#modeChips .mode-chip.active') ? document.querySelector('#modeChips .mode-chip.active').textContent : ''`);
  check('点击 chip 进入挑战', activeChip.includes('挑战'), activeChip);
  // 空态引导
  const guide = await evaluate(`!!document.querySelector('.ch-guidance')`);
  check('挑战空态引导', guide);

  // 顶栏「▶ 播放」开始（不再 F7）
  await evaluate(`document.getElementById('btnPlaySong').click(); true;`);
  await new Promise((r) => setTimeout(r, 400));
  const hud = await evaluate(`!!document.querySelector('.ch-hud')`);
  check('挑战 HUD 出现', hud);
  const ring = await evaluate(`!!document.querySelector('.ch-ring')`);
  check('倒计时圆环出现', ring);
  const targetCount = await evaluate(`document.querySelectorAll('.ch-key').length`);
  check('候选按键区渲染', targetCount > 30, `keys=${targetCount}`);
  const targetTxt = await evaluate(`document.querySelector('.ch-target') ? document.querySelector('.ch-target').textContent : ''`);
  check('目标显示', targetTxt.length > 0, targetTxt);

  // 读取当前目标 midi → 反查物理 code → 按对 → 得分增加
  // 目标 key 有 data-midi；从 ch-key.blink 读
  const targetMidi = await evaluate(`(() => { const el = document.querySelector('.ch-key.blink'); return el ? parseInt(el.dataset.midi) : -1; })()`);
  check('目标键闪烁中', targetMidi >= 0, `midi=${targetMidi}`);
  let code = '';
  if (targetMidi >= 0) {
    // keymap.keys 反查: midi → code
    code = await evaluate(`(() => {
      // 通过 vkb 键 DOM 找对应 code: vkb 的 key element 有 label; 反查 keymap? 不可达。
      // 改为从 keymap 反查 — keymap 不可达闭包。用 vkb 键 label 序列: ch-key.textContent = code
      const el = document.querySelector('.ch-key.blink');
      return el ? el.textContent : '';
    })()`);
  }
  // 注意: ch-key.textContent 存的是 label(如 'A'), 需要对应物理 code KeyA；对数字键 Digit1.. 需还原
  let physCode = code;
  if (/^[A-Z]$/.test(code)) physCode = 'Key' + code;
  else if (/^\d$/.test(code)) physCode = 'Digit' + code;
  if (physCode) {
    const score0 = await evaluate(`parseInt(document.querySelector('.ch-score').textContent)||0`);
    await new Promise((r) => setTimeout(r, 200)); // 等圆环开始
    await press(physCode, 100);
    await new Promise((r) => setTimeout(r, 400));
    const score1 = await evaluate(`parseInt(document.querySelector('.ch-score').textContent)||0`);
    check('正确按键得分增加', score1 > score0, `score ${score0}→${score1}`);
    const combo = await evaluate(`parseInt(document.querySelector('.ch-combo').textContent)||0`);
    check('连击 +1', combo >= 1, `combo=${combo}`);
  } else {
    check('正确按键得分增加', false, '无法反查目标键');
  }

  // 等目标超时 → 错误计数 + 连击清零（combo 清零即判定成功，题目序号时序由结算屏兜底）
  await new Promise((r) => setTimeout(r, 3200));
  const comboAfter = await evaluate(`parseInt(document.querySelector('.ch-combo') ? document.querySelector('.ch-combo').textContent : '0')||0`);
  const asked = await evaluate(`parseInt(document.querySelector('.ch-asked').textContent)||0`);
  check('超时后连击清零', comboAfter === 0, `combo=${comboAfter} asked=${asked}`);
  await new Promise((r) => setTimeout(r, 800));
  const comboAfter2 = await evaluate(`parseInt(document.querySelector('.ch-combo') ? document.querySelector('.ch-combo').textContent : '0')||0`);
  check('后续题连击保持清零', comboAfter2 === 0, `combo=${comboAfter2}`);

  // 连环答对 12 题 → 结算（不现实逐个等；直接开新一局跑完: 用 JS 直接调用内部? 不可达。
  // 改为: 观察 12 题循环太慢，验证结算用直接塞满: 从 DOM 无法。跳过完整结算，
  // 只用 errors 增长判断。若时间允许快速按 12 次? 每题都得读 blink 目标。做 3 题验证即可。
  // 结算屏验证: 用当前局继续不按，但这只增加 errors。改直接再开一局并把 round 缩到 3?
  // 无法改 cfg(闭包)。妥协: 连按对 12 题。
  // 实际: 累积按对直到解决（每题重新读 blink）
  let solved = 1; // 已答对1题
  let loopMax = 40; // 安全阀
  let finalScreen = false;
  while (loopMax-- > 0) {
    const tst = await evaluate(`document.querySelector('.ch-screen') ? 'screen' : (document.querySelector('.ch-hud') ? 'playing' : 'none')`);
    if (tst === 'screen') { finalScreen = true; break; }
    if (tst !== 'playing') break;
    const midi = await evaluate(`(() => { const el = document.querySelector('.ch-key.blink'); return el ? parseInt(el.dataset.midi) : -1; })()`);
    const lbl = await evaluate(`(() => { const el = document.querySelector('.ch-key.blink'); return el ? el.textContent : ''; })()`);
    if (midi < 0 || !lbl) { await new Promise((r) => setTimeout(r, 1300)); continue; } // 双键目标等待/超时
    let pc = '';
    if (/^[A-Z]$/.test(lbl)) pc = 'Key' + lbl;
    else if (/^\d$/.test(lbl)) pc = 'Digit' + lbl;
    else if (lbl.length > 1) pc = lbl; // NP/CD? 
    if (pc) { await press(pc, 80); await new Promise((r) => setTimeout(r, 300)); }
    else { await new Promise((r) => setTimeout(r, 1300)); }
  }
  check('12 题后结算屏出现', finalScreen);
  if (finalScreen) {
    const starsTxt = await evaluate(`document.querySelector('.ch-screen .stars') ? document.querySelector('.ch-screen .stars').textContent : ''`);
    const starCnt = (starsTxt.match(/⭐/g) || []).length;
    check('结算星级显示', starCnt >= 1 && starCnt <= 3, `stars=${starsTxt}`);
    const info = await evaluate(`document.querySelector('.ch-screen .info') ? document.querySelector('.ch-screen .info').textContent : ''`);
    check('结算信息(得分/连击)', /得分/.test(info), info);
  }

  ws.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== V5 汇总: ${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) { for (const f of failed) console.log('  - ' + f.name + (f.extra ? ' | ' + f.extra : '')); process.exit(1); }
  process.exit(0);
}
main().catch((e) => { console.error('CHALLENGE-TEST-ERROR', e); process.exit(2); });
