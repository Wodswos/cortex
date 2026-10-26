/**
 * R19 验证:
 *  ① 完成时间语义:原本无截止 → 勾选完成后截止补为完成时刻;
 *     原本有截止 → 勾选完成后截止保持不动
 *  ② TaskMenu 级联子菜单:悬停「设定时间/优先级」自动在右侧弹出(主菜单不消失);
 *     右侧放不下自动翻左侧;悬停普通条目收起子菜单;子菜单选项可直接点(设值生效)
 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('.', import.meta.url));
const WebSocket = require('ws');
const CDP = 'http://127.0.0.1:9222';
const APP = 'http://127.0.0.1:30090';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[r19]', ...a);
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`); };

for (const t of await (await fetch(`${CDP}/json/list`)).json()) {
  if (t.type === 'page') await fetch(`${CDP}/json/close/${t.id}`).catch(() => {});
}
await sleep(400);
const res = await fetch(`${CDP}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
const ws = new WebSocket((await res.json()).webSocketDebuggerUrl);
await new Promise((r) => ws.once('open', r));
let seq = 0; const pending = new Map();
ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } });
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evalJS = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || '').slice(0, 300)); return r.result?.value; };
const nav = async (url) => { await send('Page.navigate', { url }); await sleep(2800); };
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const clickPt = async (x, y, gap = 60) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(gap);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
};
const rightClickPt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
};
const hoverPt = async (x, y) => { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 }); };
/** 轮询直到表达式真值或超时 */
const waitFor = async (expr, timeout = 10000, every = 300) => {
  for (const dead = Date.now() + timeout; ; ) {
    const v = await evalJS(expr);
    if (v) return v;
    if (Date.now() > dead) return null;
    await sleep(every);
  }
};
/** 当前所有 TaskMenu 面板(glass-raised + fixed)rects + 文本 */
const menuPanels = () => evalJS(`(() => {
  const panels = [...document.querySelectorAll('div')].filter(d => String(d.className).includes('glass-raised') && String(d.className).includes('fixed')).map(d => { const r = d.getBoundingClientRect(); return { l: Math.round(r.left), rgt: Math.round(r.right), t: Math.round(r.top), txt: (d.textContent || '').slice(0, 80) }; });
  return panels;
})()`);
const btnCenterIn = (panelsIdx, text) => evalJS(`(() => {
  const panels = [...document.querySelectorAll('div')].filter(d => String(d.className).includes('glass-raised') && String(d.className).includes('fixed'));
  const p = panels[${panelsIdx}];
  if (!p) return null;
  const b = [...p.querySelectorAll('button')].find(x => x.textContent.includes(${JSON.stringify(text)}));
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`);
const rowPt = (title) => evalJS(`(() => {
  const row = [...document.querySelectorAll('[data-row]')].find(r => r.textContent.includes(${JSON.stringify(title)}));
  if (!row) return null;
  const r = row.getBoundingClientRect();
  return { x: Math.round(r.left + 160), y: Math.round(r.top + r.height / 2) };
})()`);
/** 详情浮窗里读「截止时间」字段显示文本(— = 未设置) */
const dueFieldText = () => evalJS(`(() => {
  const card = document.querySelectorAll('[data-state="open"]')[0];
  if (!card) return null;
  const lbl = [...card.querySelectorAll('span')].find(x => x.textContent.trim() === '截止时间');
  const btn = lbl ? lbl.parentElement.querySelector('button') : null;
  return btn ? btn.textContent.trim() : null;
})()`);
const toggleDoneInSheet = () => evalJS(`(() => {
  const card = document.querySelectorAll('[data-state="open"]')[0];
  const cb = card?.querySelector('button[aria-label="完成"]');
  if (!cb) return null;
  const r = cb.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`);

// ---------- 清场 ----------
await nav(`${APP}/tasks`);
await evalJS(`(async () => {
  if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
  await indexedDB.databases().then(dbs => Promise.all(dbs.filter(d => d.name && d.name.startsWith('cortex:')).map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = r; }))));
  return 1;
})()`);
await nav(`${APP}/tasks`);
await sleep(900);
// 建两个任务:甲无截止 / 乙稍后经菜单设「明天」
for (const name of ['甲无截止', '乙有排期']) {
  await evalJS(`(async () => {
    [...document.querySelectorAll('button')].find(b => b.textContent.includes('新任务')).click();
    await new Promise(r => setTimeout(r, 180));
    const edit = [...document.querySelectorAll('input')].filter(i => i.offsetParent !== null && i.closest('[data-row]'))[0];
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(edit, ${JSON.stringify(name)});
    edit.dispatchEvent(new Event('input', { bubbles: true }));
    edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 250));
  })()`);
}

// ---------- ② 级联子菜单:悬停弹出 + 右侧定位 + 点选项生效 ----------
{
  const p = await rowPt('乙有排期');
  await rightClickPt(p.x, p.y);
  const opened = await waitFor(`(() => [...document.querySelectorAll('div')].some(d => String(d.className).includes('glass-raised') && String(d.className).includes('fixed') && (d.textContent || '').includes('创建子任务')))()`, 6000);
  check('前置:右击出主菜单', !!opened);
  const item = await btnCenterIn(0, '设定时间');
  await hoverPt(item.x, item.y);
  await sleep(400);
  let panels = await menuPanels();
  const main = panels[0], subP = panels[1];
  check('② 悬停「设定时间」→ 级联子菜单弹出(主菜单仍在)', panels.length === 2 && !!subP && subP.txt.includes('明天'), JSON.stringify({ n: panels.length, sub: subP?.txt.slice(0, 40) }));
  check('② 子菜单在主菜单右侧', !!subP && subP.l >= main.rgt - 1, subP ? `main.r=${main.rgt} sub.l=${subP.l}` : '');
  // 悬停普通条目 → 子菜单收起,主菜单保留
  const plain = await btnCenterIn(0, '打开详情');
  await hoverPt(plain.x, plain.y);
  await sleep(400);
  panels = await menuPanels();
  check('② 悬停普通条目 → 子菜单收起(主菜单保留)', panels.length === 1 && (panels[0]?.txt || '').includes('创建子任务'));
  // 再悬停回「设定时间」,点「明天」设截止
  const item2 = await btnCenterIn(0, '设定时间');
  await hoverPt(item2.x, item2.y);
  await sleep(350);
  const tomorrow = await btnCenterIn(1, '明天');
  check('② 子菜单含「明天」可点', !!tomorrow);
  await clickPt(tomorrow.x, tomorrow.y);
  await sleep(400);
  const closed = await evalJS(`[...document.querySelectorAll('div')].filter(d => String(d.className).includes('glass-raised') && String(d.className).includes('fixed')).length === 0`);
  check('② 点选项后菜单整体关闭', closed);
}

// ---------- ② 右缘:子菜单自动翻左侧 ----------
{
  // 贴着行自身右缘右击(x=1430 会落到行外,菜单根本不开)
  const p = await evalJS(`(() => { const row = [...document.querySelectorAll('[data-row]')].find(r => r.textContent.includes('甲无截止')); const r = row.getBoundingClientRect(); return { x: Math.round(Math.min(1432, r.right - 10)), y: Math.round(r.top + r.height / 2) }; })()`);
  await rightClickPt(p.x, p.y);
  await sleep(300);
  const item = await btnCenterIn(0, '优先级');
  if (!item) check('② 右缘悬停「优先级」出子菜单', false, 'NO-ITEM');
  else {
    await hoverPt(item.x, item.y);
    await sleep(400);
    const panels = await menuPanels();
    const main = panels[0], subP = panels[1];
    check('② 右缘:悬停「优先级」子菜单翻到左侧', !!subP && subP.txt.includes('P0') && subP.rgt <= main.l + 1, subP ? `main.l=${main.l} sub.r=${subP.rgt} sub=${subP.txt.slice(0, 26)}` : `panels=${panels.length}`);
  }
  await evalJS(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 1`);
  await sleep(300);
}

// ---------- ① 完成时间语义 ----------
// 乙有排期:菜单已设截止=明天 → 打开详情,勾选完成,截止显示不变
{
  await evalJS(`[...document.querySelectorAll('[data-row]')].find(r => r.textContent.includes('乙有排期'))?.click(); 1`);
  await sleep(500);
  await evalJS(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '编辑详情')?.click(); 'open'`);
  await waitFor(`!!document.querySelectorAll('[data-state="open"]')[0]`, 8000);
  await sleep(400);
  const before = await dueFieldText();
  check('① 前置:乙的截止已设(≠ —)', !!before && before !== '—', String(before));
  const cb = await toggleDoneInSheet();
  await clickPt(cb.x, cb.y);
  await sleep(700);
  const after = await dueFieldText();
  const badge = await evalJS(`document.querySelectorAll('[data-state="open"]')[0].textContent.includes('已完成')`);
  check('① 有截止:完成后截止保持不动', !!after && after === before, `before=${before} after=${after}`);
  check('① 有截止:完成态生效', !!badge);
  // 点外部关浮窗
  const rect = await evalJS(`(() => { const r = document.querySelectorAll('[data-state="open"]')[0].getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top) }; })()`);
  await clickPt(Math.max(8, rect.x - 160), 300, 40);
  await sleep(500);
}
// 甲无截止:打开详情勾选完成 → 截止补为完成时刻(不再是 —)
{
  await evalJS(`[...document.querySelectorAll('[data-row]')].find(r => r.textContent.includes('甲无截止'))?.click(); 1`);
  await sleep(500);
  await evalJS(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '编辑详情')?.click(); 'open'`);
  await waitFor(`!!document.querySelectorAll('[data-state="open"]')[0]`, 8000);
  await sleep(400);
  const before = await dueFieldText();
  check('① 前置:甲的截止未设(—)', before === '—', String(before));
  const cb = await toggleDoneInSheet();
  await clickPt(cb.x, cb.y);
  await sleep(700);
  const after = await dueFieldText();
  check('① 无截止:完成后截止补为完成时刻(≠ —)', !!after && after !== '—', `after=${after}`);
}

log(`结果: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
