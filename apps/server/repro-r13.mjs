/**
 * R13 验证:
 *  ① 多选一批任务 → 工具条「挂到…」→ 点目标任务 = 整批挂到它下面(Esc 取消)
 *  ② 甘特图右击任务 = 应用 TaskMenu(不再是浏览器原生菜单),可转换/删除等
 *  ③ 结构节点样式:导图 = 无边框文字标签悬在连线上方(R15);列表/甘特标题加粗(组头感)
 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('.', import.meta.url));
const WebSocket = require('ws');
const APP = 'http://127.0.0.1:30090';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[r13]', ...a);
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`); };

for (const t of await (await fetch('http://127.0.0.1:9222/json/list')).json()) {
  if (t.type === 'page') await fetch(`http://127.0.0.1:9222/json/close/${t.id}`).catch(() => {});
}
await sleep(400);
const res = await fetch('http://127.0.0.1:9222/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' });
const ws = new WebSocket((await res.json()).webSocketDebuggerUrl);
await new Promise((r) => ws.once('open', r));
let seq = 0; const pending = new Map();
ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } });
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evalJS = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || '').slice(0, 300)); return r.result?.value; };
const nav = async (url) => { await send('Page.navigate', { url }); await sleep(2600); };
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const clickPt = async (x, y, { gap = 60, ctrl = false } = {}) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, modifiers: ctrl ? 2 : 0 });
  await sleep(gap);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, modifiers: ctrl ? 2 : 0 });
};
const rightClickPt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
  await sleep(50);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
  await sleep(350);
};
const rowPt = async (title) => evalJS(`(() => {
  const row = [...document.querySelectorAll('[data-row]')].find(r => [...r.querySelectorAll('button')].some(b => b.textContent.trim() === ${JSON.stringify(title)}));
  if (!row) return null;
  const r = row.getBoundingClientRect();
  return { x: Math.round(r.left + r.width * 0.6), y: Math.round(r.top + r.height / 2) };
})()`);

// ---------- 清场 + 种子 ----------
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
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (const name of ['目标D', '移动1', '移动2']) {
    [...document.querySelectorAll('button')].find(b => b.textContent.includes('新任务')).click();
    await sleep(150);
    const edit = [...document.querySelectorAll('input')].filter(i => i.offsetParent !== null && i.closest('[data-row]'))[0];
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(edit, name);
    edit.dispatchEvent(new Event('input', { bubbles: true }));
    edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(220);
  }
  return 'seeded';
})()`);

const rowMeta = () => evalJS(`(() => {
  const meta = {};
  for (const name of ['目标D', '移动1', '移动2']) {
    const row = [...document.querySelectorAll('[data-row]')].find(r => [...r.querySelectorAll('button')].some(b => b.textContent.trim() === name));
    meta[name] = row ? { ml: getComputedStyle(row).marginLeft, chevron: !!row.querySelector('button .lucide-chevron-right, button svg.lucide-chevron-right') } : null;
  }
  const bar = [...document.querySelectorAll('div')].find(d => String(d.className||'').includes('fixed') && String(d.className||'').includes('bottom-6'));
  return { meta, bar: !!bar };
})()`);
const before = await rowMeta();
check('种子就绪:三个根任务(无缩进)', before.meta['移动1']?.ml === '0px' && before.meta['移动2']?.ml === '0px', JSON.stringify(before.meta));

// ---------- ① 批量挂载 ----------
const p1 = await rowPt('移动1'), p2 = await rowPt('移动2'), pT = await rowPt('目标D');
await clickPt(900, 95, { gap: 40 }); // 点过滤条空白:清掉"新建后自动选中"(否则 ctrl 点会变成反选)
await sleep(200);
await clickPt(p1.x, p1.y); // 单选 移动1
await clickPt(p2.x, p2.y, { ctrl: true }); // ctrl 增选 → 多选 2
await sleep(300);
const toolbar = await evalJS(`(() => {
  const bar = [...document.querySelectorAll('div')].find(d => String(d.className||'').includes('fixed') && String(d.className||'').includes('bottom-6'));
  if (!bar) return null;
  return { text: bar.textContent || '', hasAttach: !![...bar.querySelectorAll('button')].find(b => b.textContent.includes('挂到')) };
})()`);
check('① 多选出现工具条,含「挂到…」', toolbar && toolbar.hasAttach && toolbar.text.includes('已选 2 项'), JSON.stringify(toolbar));
await evalJS(`(() => { const bar=[...document.querySelectorAll('div')].find(d => String(d.className||'').includes('fixed') && String(d.className||'').includes('bottom-6')); if (!bar) return 'NO-BAR'; [...bar.querySelectorAll('button')].find(b => b.textContent.includes('挂到'))?.click(); return 1; })()`);
await sleep(300);
const hint = await evalJS(`(() => {
  const bar = [...document.querySelectorAll('div')].find(d => String(d.className||'').includes('fixed') && String(d.className||'').includes('bottom-6'));
  return bar ? (bar.textContent || '') : null;
})()`);
check('① 挂载模式提示出现(Esc 取消)', !!hint && hint.includes('挂到它下面'), JSON.stringify(hint));
const hover = await evalJS(`(() => {
  const row = [...document.querySelectorAll('[data-row]')].find(r => [...r.querySelectorAll('button')].some(b => b.textContent.trim() === '目标D'));
  return row ? String(row.className) : null;
})()`);
check('① 目标行有拾取态(cursor-copy)', !!hover && hover.includes('cursor-copy'), hover?.slice(-90));
await clickPt(pT.x, pT.y); // 点目标D → 整批挂载
await sleep(600);
const after = await rowMeta();
check('① 两个任务都挂到 目标D 下(缩进 18px)', after.meta['移动1']?.ml === '18px' && after.meta['移动2']?.ml === '18px', JSON.stringify(after.meta));
check('① 目标D 出现折叠钮(有子级了)', after.meta['目标D']?.chevron === true, JSON.stringify(after.meta['目标D']));
check('① 挂载后工具条消失(选区已清)', after.bar === false);

// 给 移动1 设「今天」截止(甘特只画有日期的任务;经列表右击菜单的设定时间子菜单)
await clickPt(900, 95, { gap: 40 }); await sleep(200);
{
  const p = await rowPt('移动1');
  await rightClickPt(p.x, p.y);
  await evalJS(`(() => { [...document.querySelectorAll('button')].find(b => b.textContent.includes('设定时间'))?.click(); return 1; })()`);
  await sleep(300);
  // 注意:「今天」过滤 chip 也是同名按钮,必须 scope 到菜单容器里点;
  // R19 起时间选项在级联子菜单(第二个 glass-raised fixed 面板)里,要扫全部菜单面板
  await evalJS(`(() => { const menus = [...document.querySelectorAll('div')].filter(d => String(d.className).includes('glass-raised') && String(d.className).includes('fixed')); const btn = menus.flatMap(m => [...m.querySelectorAll('button')]).find(b => b.textContent.trim() === '今天'); if (!btn) return 'NO-MENU'; btn.click(); return 1; })()`);
  await sleep(400);
}

// ---------- ② 甘特右击 = 应用菜单 ----------
await nav(`${APP}/tasks?view=gantt`);
await sleep(1600);
const gpt = await evalJS(`(() => {
  const rows = [...document.querySelectorAll('div')].filter(d => String(d.className||'').includes('sticky'));
  const row = rows.find(d => [...d.querySelectorAll('button')].some(b => b.textContent.trim() === '目标D'));
  if (!row) return null;
  const r = row.getBoundingClientRect();
  return { x: Math.round(r.left + r.width * 0.5), y: Math.round(r.top + r.height / 2) };
})()`);
check('② 甘特里 目标D(及其子树)有行', !!gpt, JSON.stringify(gpt));
await rightClickPt(gpt.x, gpt.y);
const gmenu = await evalJS(`(() => {
  const menu = [...document.querySelectorAll('div')].find(d => String(d.className).includes('glass-raised') && String(d.className).includes('fixed'));
  if (!menu) return null;
  return { sub: (menu.textContent || '').includes('创建子任务'), convert: (menu.textContent || '').includes('转为结构节点') };
})()`);
check('② 右击出应用 TaskMenu(创建子任务/转换)', gmenu && gmenu.sub && gmenu.convert, JSON.stringify(gmenu));
await evalJS(`(() => { [...document.querySelectorAll('button')].find(b => b.textContent.includes('转为结构节点'))?.click(); return 1; })()`);
await sleep(500);
const gnode = await evalJS(`(() => {
  const rows = [...document.querySelectorAll('div')].filter(d => String(d.className||'').includes('sticky'));
  const row = rows.find(d => [...d.querySelectorAll('button')].some(b => b.textContent.trim() === '目标D'));
  if (!row) return null;
  const titleBtn = [...row.querySelectorAll('button')].find(b => b.textContent.trim() === '目标D');
  return { folder: !!row.querySelector('[title="结构节点(无完成态)"]'), bold: titleBtn ? getComputedStyle(titleBtn).fontWeight : null };
})()`);
check('② 甘特右击直接转换成功:Folder + 组头加粗', gnode && gnode.folder && Number(gnode.bold) >= 500, JSON.stringify(gnode));

// ---------- ③ 导图:结构节点 = 无边框文字标签悬在连线上方(R15 起不压线) ----------
await nav(`${APP}/tasks?view=mindmap`);
await sleep(2200);
const mm = await evalJS(`(() => {
  const nodes = [...document.querySelectorAll('.react-flow__node')];
  const find = (t) => nodes.find(n => (n.textContent || '').includes(t));
  const g = find('目标D'), m1 = find('移动1');
  const inner = (n) => n ? n.querySelector('div.group') || n.firstElementChild : null;
  const gi = inner(g), mi = inner(m1);
  const title = gi ? [...gi.querySelectorAll('span')].find(s => (s.textContent || '').trim() === '目标D') : null;
  const label = title ? title.parentElement : null;
  const gs = gi ? getComputedStyle(gi) : null;
  const gr = gi ? gi.getBoundingClientRect() : null;
  const lr = label ? label.getBoundingClientRect() : null;
  const mid = gr ? gr.top + gr.height / 2 : null; // 连线锚在节点竖直中线
  return {
    gBorder: gs ? gs.borderTopWidth + ' ' + gs.borderTopStyle : null,
    gBg: gs ? gs.backgroundColor : null,
    gFolder: g ? !!g.querySelector('svg.lucide-folder') : null,
    gCheckbox: g ? !!g.querySelector('button[aria-label="完成"]') : null,
    labelBottom: lr ? Math.round(lr.bottom) : null, midline: mid != null ? Math.round(mid) : null,
    labelBg: label ? getComputedStyle(label).backgroundColor : null,
    m1Radius: mi ? getComputedStyle(mi).borderRadius : null,
    m1BorderW: mi ? getComputedStyle(mi).borderTopWidth : null,
    m1Checkbox: m1 ? !!m1.querySelector('button[aria-label="完成"]') : null,
  };
})()`);
check('③ 导图:结构节点 = 无边框标签(无卡片/Folder/勾选框)',
  String(mm.gBorder).startsWith('0px') && mm.gBg === 'rgba(0, 0, 0, 0)' && mm.gFolder === false && mm.gCheckbox === false, JSON.stringify(mm));
check('③ 导图:标签悬在连线上方(高于中线、无底色不遮线)', mm.labelBottom != null && mm.labelBottom <= mm.midline - 2 && mm.labelBg === 'rgba(0, 0, 0, 0)', `labelBottom=${mm.labelBottom} midline=${mm.midline}`);
check('③ 导图:任务仍是圆角卡片 + 勾选框', mm.m1Radius && parseFloat(mm.m1Radius) < 24 && parseFloat(mm.m1BorderW) >= 1 && mm.m1Checkbox === true, JSON.stringify(mm));

log(`结果: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
