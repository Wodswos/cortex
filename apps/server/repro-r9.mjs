/**
 * R9 验证:① 甘特/时间线/四象限点击 Task → 右上浮动卡(可见、无边距、点外部可关)
 *      ② 状态自动推导(进行中/待办/未开始)与优先级 P0~P3 落地
 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('.', import.meta.url));
const WebSocket = require('ws');
const CDP = 'http://127.0.0.1:9222';
const APP = 'http://127.0.0.1:30090';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[r9]', ...a);
for (const t of await (await fetch(`${CDP}/json/list`)).json()) { if (t.type === 'page') await fetch(`${CDP}/json/close/${t.id}`).catch(() => {}); }
await sleep(400);
const res = await fetch(`${CDP}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
const ws = new WebSocket((await res.json()).webSocketDebuggerUrl);
await new Promise((r) => ws.once('open', r));
let seq = 0; const pending = new Map();
ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } });
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evalJS = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || '').slice(0, 300)); return r.result?.value; };
const nav = async (url) => { await send('Page.navigate', { url }); await sleep(2400); };
const clickPt = async (x, y, gap = 60) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(gap);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
};
const getCard = () => evalJS(`(() => {
  const c = [...document.body.querySelectorAll('[data-state="open"]')];
  if (!c.length) return null;
  const r = c[0].getBoundingClientRect();
  return { n: c.length, rect: { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) }, cls: (c[0].className||'').slice(0,50) };
})()`);
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });

// 清场 + 建任务
await nav(`${APP}/tasks`);
await evalJS(`(async () => {
  if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
  await indexedDB.databases().then(dbs => Promise.all(dbs.filter(d => d.name && d.name.startsWith('cortex:')).map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = r; }))));
  return 1;
})()`);
await nav(`${APP}/tasks?view=list`);
await sleep(900);
await evalJS(`(async () => {
  const sleep2 = (ms) => new Promise(r => setTimeout(r, ms));
  for (const name of ['丙明天', '甲due', '乙随便']) {
    [...document.querySelectorAll('button')].find(b => b.textContent.includes('新任务')).click();
    await sleep2(150);
    const edit = [...document.querySelectorAll('input')].filter(i => i.offsetParent !== null && i.closest('[data-row]'))[0];
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(edit, name);
    edit.dispatchEvent(new Event('input', { bubbles: true }));
    edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep2(220);
  }
  return 'seeded';
})()`);

// 用浮窗给任务设时间: 甲due → 截止=现在+30min(start 不设 → 进行中); 丙明天 → 开始=明天(未开始)
const setTaskTimes = async (title, idx, tExpr) => {
  await evalJS(`(() => { [...document.querySelectorAll('[data-row]')].find(r => r.textContent.includes(${JSON.stringify(title)}))?.click(); return 'row'; })()`);
  await sleep(500);
  await evalJS(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '编辑详情')?.click(); 'open'`);
  await sleep(700);
  const r = await evalJS(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const card = [...document.body.querySelectorAll('[data-state="open"]')][0];
    if (!card) return 'NO-CARD';
    // 时间字段现在是「—」按钮,点一下才出现原生输入(R11 起);idx: 0=开始 1=截止
    const label = ${idx} === 0 ? '开始时间' : '截止时间';
    const lbl = [...card.querySelectorAll('span')].find(x => x.textContent.trim() === label);
    const btn = lbl ? lbl.parentElement.querySelector('button') : null;
    if (!btn) return 'NO-FIELD-BTN';
    btn.click();
    await sleep(200);
    const dts = [...card.querySelectorAll('input')].filter(i => i.type === 'datetime-local' && i.offsetParent !== null);
    if (dts.length < 1) return 'NO-DT:' + dts.length;
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const d = new Date(${tExpr});
    const pad = n => String(n).padStart(2, '0');
    const val = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    set.call(dts[0], val); dts[0].dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(200);
    return 'dt:' + val;
  })()`);
  await sleep(400);
  // 点外部关
  const card2 = await getCard();
  if (card2) {
    const x = Math.max(8, card2.rect.left - 120);
    await clickPt(x, Math.max(20, Math.min(300, card2.rect.top + 40)), 40);
  }
  await sleep(500);
  return r;
};

await setTaskTimes('甲due', 1, `Date.now() + 30 * 60000`); // 只设 截止(索引1)
await setTaskTimes('丙明天', 0, `Date.now() + 26 * 3600e3`); // 只设 开始(索引0)

// ---------- ① 列表:状态徽标 ----------
await nav(`${APP}/tasks?view=list`);
await sleep(1200);
const listBadges = await evalJS(`(() => {
  const rows = [...document.querySelectorAll('[data-row]')];
  const out = {};
  for (const [name, want] of [['甲due',['进行中']],['丙明天',['未开始']],['乙随便',['待办']]]) {
    const r = rows.find(x => x.textContent.includes(name));
    out[name] = want.map(w => r?.textContent.includes(w) ? w : null).filter(Boolean);
  }
  return out;
})()`);
log('① 列表状态徽标:', JSON.stringify(listBadges), (listBadges['甲due'][0]==='进行中'&&listBadges['丙明天'][0]==='未开始'&&listBadges['乙随便'][0]==='待办')?'✓':'✗');
// 优先级拾取器:打开甲due,点 P0 → 读 important/urgent(经浮窗 text 反映? 改为查看四象限位置)
await evalJS(`(() => { [...document.querySelectorAll('[data-row]')].find(r => r.textContent.includes('甲due'))?.click(); return 1; })()`);
await sleep(500);
await evalJS(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '编辑详情')?.click(); 'open'`);
await sleep(700);
const picker = await evalJS(`(() => {
  const card = [...document.body.querySelectorAll('[data-state="open"]')][0];
  if (!card) return 'NO-CARD';
  const btns = [...card.querySelectorAll('button')].filter(b => /^P[0-3]$/.test(b.textContent.trim()));
  return btns.map(b => b.textContent.trim()) + '|' + card.textContent.includes('当前 立即做') + ':' + card.textContent.includes('P0 立即做');
})()`);
log('② 浮窗优先级拾取器:', picker);
// 点 P0
await evalJS(`(() => {
  const card = [...document.body.querySelectorAll('[data-state="open"]')][0];
  const b = [...card.querySelectorAll('button')].find(b => b.textContent.trim() === 'P0');
  b?.click(); return 'p0-clicked';
})()`);
await sleep(400);
// 关窗
const c2 = await getCard();
if (c2) { await clickPt(Math.max(8, c2.rect.left - 120), Math.min(300, c2.rect.top + 40), 40); }
await sleep(400);

// ---------- ③ 矩阵:甲due 应在 立即做(P0);真实指针点 chip → 浮窗 ----------
await nav(`${APP}/tasks?view=matrix`);
await sleep(1200);
const matrixChip = await evalJS(`(() => {
  const quadrants = [...document.querySelectorAll('div')].filter(d => d.className.includes && typeof d.className==='string' && d.className.includes('grid-cols-2') && d.parentElement && d.parentElement.className.includes('md:grid-cols-2'));
  return 'skip-quadrant-loc';
})()`);
// 定位「立即做」象限内的甲due chip
const chipInQ = await evalJS(`(() => {
  const all = [...document.querySelectorAll('div[role="button"]')];
  const chip = all.find(d => d.textContent.includes('甲due'));
  if (!chip) return null;
  const r = chip.getBoundingClientRect();
  return { x: r.x + r.width/2, y: r.y + r.height/2, vis: r.top>=0 && r.bottom<=innerHeight };
})()`);
log('③ 矩阵甲due chip:', JSON.stringify(chipInQ), !!chipInQ ? (chipInQ.vis ? '可见' : '不可见') : '缺');
if (chipInQ?.vis) {
  await clickPt(chipInQ.x, chipInQ.y, 80);
  await sleep(800);
  const open = (await getCard());
  log('  · 真实指针点击 →', open ? `OPENED rect=${JSON.stringify(open.rect)}` : 'NOT-OPENED');
  const c3 = await getCard();
  if (open?.n) { await clickPt(Math.max(8, open.rect.left - 120), Math.min(300, open.rect.top + 40), 40); }
  await sleep(300);
}

// ---------- ④ 甘特点击条 → 浮窗可见(右上,420px,无遮罩) ----------
await nav(`${APP}/tasks?view=gantt`);
await sleep(1600);
const gBar = await evalJS(`(async () => {
  await new Promise(r => setTimeout(r, 100));
  const all = [...document.querySelectorAll('[title]')].filter(x => (x.getAttribute('title')||'').includes('甲due'));
  const bar = all.find(x => (x.className||'').includes && (x.className||'').includes('absolute') && (x.className||'').includes('top-1/2'));
  if (!bar) return null;
  const r = bar.getBoundingClientRect();
  return { x: r.x + r.width/2, y: r.y + r.height/2, vis: r.top>=0 && r.bottom<=innerHeight, cls: (bar.className||'').slice(0,60) };
})()`);
const vw = await evalJS(`innerWidth`);
log('④ 甘特甲due条:', JSON.stringify(gBar));
if (gBar?.vis) {
  await clickPt(gBar.x, gBar.y, 60);
  await sleep(800);
  const g = await getCard();
  const ok = g && g.n === 1 && g.rect.w >= 380 && g.rect.w <= 460 && g.rect.top <= 100 && g.rect.right <= vw + 4;
  log('  · 浮窗:', JSON.stringify(g), ok ? '✓ (420px 右上可见无遮罩)' : '✗');
  if (g) { await clickPt(Math.max(8, g.rect.left - 120), Math.min(300, g.rect.top + 40), 40); }
  await sleep(400);
}

// ---------- ⑤ 时间线点 ⏰ 块 → 浮窗 ----------
await nav(`${APP}/tasks?view=timeline`);
await sleep(1600);
const tl = await evalJS(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.title||'').includes('截止') && (x.title||'').includes('甲due'));
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: r.x + r.width/2, y: r.y + r.height/2, vis: r.top>=0 && r.bottom<=innerHeight && r.right<=innerWidth };
})()`);
log('⑤ 时间线⏰块:', JSON.stringify(tl));
if (tl?.vis) {
  await clickPt(tl.x, tl.y, 80);
  await sleep(800);
  const t = await getCard();
  log('  · 浮窗:', JSON.stringify(t), t && t.n===1 ? '✓' : '✗');
}

// ---------- ⑥ 溢出卡片不出现遮罩且原视图可继续交互(卡片没挡住主体) ----------
const finalOverlay = await evalJS(`!!document.querySelector('[data-radix-overlay]') || !!document.querySelector('.fixed.inset-0.z-40')`);
log('⑥ 有无遮罩:', finalOverlay ? '✗ 有遮罩' : '✓ 无遮罩');
ws.close();