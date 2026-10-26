/**
 * R12 验证(节点类型 todo ↔ node):
 *  ① 右击菜单可把任务转为「结构节点」;再右击时菜单变「转为 TODO 任务」,且不再给设定时间/优先级
 *  ② 列表:结构节点行无完成勾选(Folder 角标)、无状态徽标;子任务不受影响
 *  ③ 矩阵:结构节点不出现;普通任务照常
 *  ④ 甘特:结构节点只作分组行(无条、不在未排期坞);其有日期的子任务照常画条
 *  ⑤ 详情面板:KindToggle 双向转换;结构节点态隐藏状态/优先级/时间区块,转回即恢复
 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('.', import.meta.url));
const WebSocket = require('ws');
const APP = 'http://127.0.0.1:30090';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[r12kind]', ...a);
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

const clickPt = async (x, y, gap = 60) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(gap);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
};
const rightClickPt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
  await sleep(50);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
  await sleep(350);
};

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
  for (const name of ['容器A', '普通C']) {
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

/** 打开某任务的完整详情抽屉 */
const openSheet = async (title) => {
  await evalJS(`(() => { [...document.querySelectorAll('[data-row]')].find(r => r.textContent.includes(${JSON.stringify(title)}))?.click(); return 1; })()`);
  await sleep(450);
  await evalJS(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '编辑详情')?.click(); 'open'`);
  await sleep(650);
};
const closeSheet = async () => {
  const card = await evalJS(`(() => { const c = [...document.body.querySelectorAll('[data-state="open"]')][0]; if (!c) return null; const r = c.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top) }; })()`);
  if (card) await clickPt(Math.max(8, card.l - 140), Math.min(300, card.t + 40), 40);
  await sleep(400);
};

// 容器A 加子任务 子B(经详情抽屉)
await openSheet('容器A');
await evalJS(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const card = [...document.body.querySelectorAll('[data-state="open"]')][0];
  const inp = [...card.querySelectorAll('input')].find(i => i.placeholder && i.placeholder.includes('添加子任务'));
  if (!inp) return 'NO-SUB-INPUT';
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, '子B');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(400);
  return 'sub-added';
})()`);
await closeSheet();

// 子B 设时间(甘特里会有条;容器A 保持无日期 → 只能当容器行出现)
await openSheet('子B');
await evalJS(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const card = [...document.body.querySelectorAll('[data-state="open"]')][0];
  if (!card) return 'NO-CARD';
  const pad = n => String(n).padStart(2, '0');
  const local = (ms) => { const d = new Date(ms); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes()); };
  // R14 起「开始」选完自动弹「截止」输入:先找已可见的输入,没有再点字段按钮
  const fillByLabel = async (label, ms) => {
    let inp = [...card.querySelectorAll('input[type="datetime-local"]')].find(i => i.offsetParent !== null);
    if (!inp) {
      const s = [...card.querySelectorAll('span')].find(x => x.textContent.trim() === label);
      const btn = s ? s.parentElement.querySelector('button') : null;
      if (!btn) return 'NO-BTN';
      btn.click();
      await sleep(120);
      inp = [...card.querySelectorAll('input[type="datetime-local"]')].find(i => i.offsetParent !== null);
    }
    if (!inp) return 'NO-INPUT';
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, local(ms));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(200);
    return 'ok';
  };
  const s = await fillByLabel('开始时间', Date.now() - 60 * 60000); if (s !== 'ok') return 'START:' + s;
  const d = await fillByLabel('截止时间', Date.now() + 120 * 60000); if (d !== 'ok') return 'DUE:' + d;
  return 'ok';
})()`);
await closeSheet();

const rowInfo = (title) => evalJS(`(() => {
  const row = [...document.querySelectorAll('[data-row]')].find(r => [...r.querySelectorAll('button')].some(b => b.textContent.trim() === ${JSON.stringify(title)} || b.textContent.includes(${JSON.stringify(title)})));
  if (!row) return null;
  return {
    checkbox: !!row.querySelector('button[aria-label="完成"], button[aria-label="标记未完成"]'),
    folder: !!row.querySelector('[title="结构节点(无完成态)"]'),
    statusBadge: !!row.querySelector('[title^="状态:"]'),
    focusBtn: !!row.querySelector('[title="开始专注"]'),
  };
})()`);
check('种子就绪:容器A 是 TODO(有勾选)', (await rowInfo('容器A'))?.checkbox === true, JSON.stringify(await rowInfo('容器A')));

// ---------- ① 右击 → 转为结构节点 ----------
const pt = await evalJS(`(() => {
  const row = [...document.querySelectorAll('[data-row]')].find(r => [...r.querySelectorAll('button')].some(b => b.textContent.trim() === '容器A'));
  if (!row) return null;
  const r = row.getBoundingClientRect();
  return { x: Math.round(r.left + r.width * 0.5), y: Math.round(r.top + r.height / 2) };
})()`);
await rightClickPt(pt.x, pt.y);
const menuHasConvert = await evalJS(`(() => !![...document.querySelectorAll('button')].find(b => b.textContent.includes('转为结构节点')))()`);
check('① 右击菜单出现「转为结构节点」', menuHasConvert === true);
await evalJS(`(() => { [...document.querySelectorAll('button')].find(b => b.textContent.includes('转为结构节点'))?.click(); return 1; })()`);
await sleep(500);

// ---------- ② 列表渲染 ----------
const aNode = await rowInfo('容器A');
const bTodo = await rowInfo('子B');
const cTodo = await rowInfo('普通C');
check('② 结构节点行:无完成勾选、有 Folder 角标', aNode && aNode.checkbox === false && aNode.folder === true, JSON.stringify(aNode));
check('② 结构节点行:无状态徽标', aNode && aNode.statusBadge === false, JSON.stringify(aNode));
check('② 结构节点行:无专注按钮', aNode && aNode.focusBtn === false);
check('② 子任务仍是 TODO(勾选还在)', bTodo && bTodo.checkbox === true && bTodo.folder === false, JSON.stringify(bTodo));
check('② 其它任务不受影响', cTodo && cTodo.checkbox === true, JSON.stringify(cTodo));

// ---------- ①(续)结构节点的右击菜单 ----------
await rightClickPt(pt.x, pt.y);
const menuInfo = await evalJS(`(() => {
  const menu = [...document.querySelectorAll('div')].find(d => String(d.className).includes('glass-raised') && String(d.className).includes('fixed'));
  const txt = menu ? (menu.textContent || '') : '';
  return {
    back: !![...document.querySelectorAll('button')].find(b => b.textContent.includes('转为 TODO 任务')),
    time: txt.includes('设定时间'), priority: txt.includes('优先级'),
  };
})()`);
check('① 再右击:菜单变「转为 TODO 任务」', menuInfo.back === true, JSON.stringify(menuInfo));
check('① 结构节点菜单无「设定时间 / 优先级」', menuInfo.time === false && menuInfo.priority === false, JSON.stringify(menuInfo));
await evalJS(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); [...document.querySelectorAll('.fixed.inset-0')].forEach(d => d.click?.()); return 1; })()`);
await sleep(300);
await clickPt(700, 700, 40); // 点空白处兜底关菜单

// ---------- ③ 矩阵 ----------
await nav(`${APP}/tasks?view=matrix`);
await sleep(1400);
const matrix = await evalJS(`(() => {
  const cards = [...document.querySelectorAll('[draggable], [data-row], button, span')].filter(e => e.childElementCount === 0 && /容器A|子B|普通C/.test(e.textContent || ''));
  const names = [...new Set(cards.map(c => (c.textContent || '').trim()).filter(t => /^(容器A|子B|普通C)$/.test(t)))];
  return names;
})()`);
check('③ 矩阵:结构节点不出现', !matrix.includes('容器A'), JSON.stringify(matrix));
check('③ 矩阵:普通任务照常出现', matrix.includes('普通C'), JSON.stringify(matrix));

// ---------- ④ 甘特 ----------
await nav(`${APP}/tasks?view=gantt`);
await sleep(1600);
const gantt = await evalJS(`(() => {
  const row = [...document.querySelectorAll('div')].filter(d => d.querySelector('button')?.textContent === '容器A' || [...d.querySelectorAll('button')].some(b => b.textContent.trim() === '容器A')).find(d => d.className && String(d.className).includes('sticky'));
  const bar = [...document.querySelectorAll('div[title]')].find(x => (x.getAttribute('title') || '').startsWith('容器A · '));
  const subBar = [...document.querySelectorAll('div[title]')].find(x => (x.getAttribute('title') || '').startsWith('子B · '));
  const tray = [...document.querySelectorAll('button.touch-none')].map(b => b.textContent.trim());
  return {
    rowVisible: !!row, rowCheckbox: row ? !!row.querySelector('button[aria-label="完成"]') : null,
    rowFolder: row ? !!row.querySelector('[title="结构节点(无完成态)"]') : null,
    ownBar: !!bar, subBar: !!subBar, tray,
  };
})()`);
check('④ 甘特:结构节点有分组行(无勾选、Folder 角标)', gantt.rowVisible && gantt.rowCheckbox === false && gantt.rowFolder === true, JSON.stringify({ v: gantt.rowVisible, cb: gantt.rowCheckbox, f: gantt.rowFolder }));
check('④ 甘特:结构节点无自己的条', gantt.ownBar === false);
check('④ 甘特:有日期的子任务照常画条', gantt.subBar === true);
check('④ 未排期坞不含结构节点', !gantt.tray.includes('容器A'), JSON.stringify(gantt.tray));

// ---------- ⑤ 详情面板双向转换 ----------
await nav(`${APP}/tasks?view=list`);
await sleep(900);
await openSheet('容器A');
const sheetNode = await evalJS(`(() => {
  const card = [...document.body.querySelectorAll('[data-state="open"]')][0];
  if (!card) return null;
  const txt = card.textContent || '';
  const active = [...card.querySelectorAll('button')].find(b => b.textContent.includes('结构节点') && String(b.className).includes('gradient-bg'));
  const label = (t) => [...card.querySelectorAll('span')].some(x => x.textContent.trim() === t);
  return {
    hasKind: txt.includes('节点类型'), hasStatus: label('状态'), hasPriority: label('优先级'),
    activeStructural: !!active,
  };
})()`);
check('⑤ 详情:有「节点类型」切换且高亮结构节点', sheetNode && sheetNode.hasKind && sheetNode.activeStructural === true, JSON.stringify(sheetNode));
check('⑤ 详情:结构节点隐藏状态/优先级区块', sheetNode && sheetNode.hasStatus === false && sheetNode.hasPriority === false, JSON.stringify(sheetNode));
await evalJS(`(() => { const card = [...document.body.querySelectorAll('[data-state="open"]')][0]; [...card.querySelectorAll('button')].find(b => b.textContent.trim() === 'TODO 任务')?.click(); return 1; })()`);
await sleep(500);
const sheetTodo = await evalJS(`(() => {
  const card = [...document.body.querySelectorAll('[data-state="open"]')][0];
  const txt = card.textContent || '';
  return { hasPriority: txt.includes('优先级'), hasStatus: txt.includes('状态'), activeTodo: !![...card.querySelectorAll('button')].find(b => b.textContent.includes('TODO 任务') && String(b.className).includes('gradient-bg')) };
})()`);
check('⑤ 转回 TODO:状态/优先级区块恢复', sheetTodo && sheetTodo.hasPriority && sheetTodo.hasStatus && sheetTodo.activeTodo === true, JSON.stringify(sheetTodo));
await closeSheet();
const aBack = await rowInfo('容器A');
check('⑤ 列表勾选框回来了', aBack && aBack.checkbox === true && aBack.folder === false, JSON.stringify(aBack));

log(`结果: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
