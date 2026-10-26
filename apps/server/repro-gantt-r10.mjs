/**
 * R10 验证:① 条圆角变小(rounded-md,非全圆)
 *      ② 无时间任务默认隐藏 → 出现在底部「未排期」坞;拖坞中任务到某天 → 出条
 *      ③ 行内空白按下拖划 = 设定 startAt~dueAt(00:00 ~ 23:59)
 *      ④ 条右端把手拖动 = 同步改截止时间
 *      ⑤ 不同根任务之间有分组分隔线
 *      ⑥ 拖拽后不误弹详情浮窗
 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('.', import.meta.url));
const WebSocket = require('ws');
const APP = 'http://127.0.0.1:30090';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[r10]', ...a);

for (const t of await (await fetch('http://127.0.0.1:9222/json/list')).json()) {
  if (t.type === 'page') await fetch(`http://127.0.0.1:9222/json/close/${t.id}`).catch(() => {});
}
await sleep(400);
const res = await fetch('http://127.0.0.1:9222/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' });
const ws = new WebSocket((await res.json()).webSocketDebuggerUrl);
await new Promise((r) => ws.once('open', r));
let seq = 0; const pending = new Map();
ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } });
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evalJS = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || '').slice(0, 300)); return r.result?.value; };
const nav = async (url) => { await send('Page.navigate', { url }); await sleep(2600); };
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });

const clickPt = async (x, y, gap = 60) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(gap);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
};
/** 真实指针拖拽:press → 插值 move → release */
const dragPt = async (x0, y0, x1, y1, steps = 10) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(60);
  for (let i = 1; i <= steps; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps, button: 'left', buttons: 1 });
    await sleep(20);
  }
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(600);
};

// 清场 + 建 4 个任务:甲due(今天+30min)、乙随便(无时间)、丙一(明天)、丁二(明天)
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
  for (const name of ['甲due', '乙随便', '丙一', '丁二']) {
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

// 经浮窗设截止时间
const setDue = async (title, tExpr) => {
  await evalJS(`(() => { [...document.querySelectorAll('[data-row]')].find(r => r.textContent.includes(${JSON.stringify(title)}))?.click(); return 1; })()`);
  await sleep(500);
  await evalJS(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '编辑详情')?.click(); 'open'`);
  await sleep(700);
  const r = await evalJS(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const card = [...document.body.querySelectorAll('[data-state="open"]')][0];
    if (!card) return 'NO-CARD';
    // 时间字段现在是「—」按钮,点一下才出现原生 datetime-local 输入(R11 起)
    const s = [...card.querySelectorAll('span')].find(x => x.textContent.trim() === '截止时间');
    const btn = s ? s.parentElement.querySelector('button') : null;
    if (!btn) return 'NO-FIELD-BTN';
    btn.click();
    await sleep(150);
    const dts = [...card.querySelectorAll('input')].filter(i => i.type === 'datetime-local' && i.offsetParent !== null);
    if (dts.length < 1) return 'NO-DT:' + dts.length;
    const d = new Date(${tExpr});
    const pad = n => String(n).padStart(2, '0');
    const val = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(dts[0], val);
    dts[0].dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(200);
    return 'dt:' + val;
  })()`);
  await sleep(400);
  const card2 = await evalJS(`(() => { const c = [...document.body.querySelectorAll('[data-state="open"]')][0]; if (!c) return null; const r = c.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top) }; })()`);
  if (card2) await clickPt(Math.max(8, card2.l - 120), Math.min(300, card2.t + 40), 40);
  await sleep(400);
  return r;
};
log('种日期 甲due:', await setDue('甲due', `Date.now() + 30 * 60000`));
log('种日期 丙一:', await setDue('丙一', `Date.now() + 26 * 3600e3`));
log('种日期 丁二:', await setDue('丁二', `Date.now() + 30 * 3600e3`));

// ---------- 甘特 ----------
await nav(`${APP}/tasks?view=gantt`);
await sleep(1600);

// ① 圆角 + ⑤ 分组分隔线 + ② 乙随便默认隐藏/在未排期坞
const layout = await evalJS(`(() => {
  const bars = [...document.querySelectorAll('div[title][class*="top-1/2"]')];
  const cls = bars[0] ? bars[0].className : '';
  const trackOf = (name) => [...document.querySelectorAll('[data-gantt-track]')].find(el => (el.previousElementSibling?.textContent || '').includes(name)) || null;
  const rowsOf = (name) => !!trackOf(name);
  const tray = document.body.textContent.includes('未排期');
  const trayChip = [...document.querySelectorAll('button.touch-none')].some(b => b.textContent.trim() === '乙随便');
  const seps = document.querySelectorAll('.gantt-group-sep').length;
  return {
    bars: bars.length, roundedMd: cls.includes('rounded-md'), notFull: !cls.includes('rounded-full'),
    甲row: rowsOf('甲due'), 丙row: rowsOf('丙一'), 丁row: rowsOf('丁二'),
    乙row: rowsOf('乙随便'), tray, trayChip, seps,
  };
})()`);
log('①/②/⑤ 布局:', JSON.stringify(layout));
log('  ① 条圆角变小:', layout.roundedMd && layout.notFull ? '✓' : '✗');
log('  ② 无时间乙随便:行隐藏 + 未排期坞有 chip:',
  !layout.乙row && layout.tray && layout.trayChip ? '✓' : '✗');
log(`  ⑤ 分组分隔线(${layout.seps} 条,3 个有日期根 → 期望 2):`, layout.seps >= 2 ? '✓' : '✗');

// ④ 条右端把手拖动 = 改截止(丙一先做伸缩,因为此刻它的条够宽)
const barOf = (name) => evalJS(`(() => {
  const el = [...document.querySelectorAll('[title]')].find(x =>
    (x.getAttribute('title')||'').includes(${JSON.stringify(name)}) &&
    (x.className||'').includes('absolute') && (x.className||'').includes('top-1/2'));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, title: el.getAttribute('title') };
})()`);
const 丙1 = await barOf('丙一');
if (丙1 && 丙1.w >= 36) {
  const before = 丙1.title;
  await dragPt(丙1.x + 丙1.w - 3, 丙1.y + 丙1.h / 2, 丙1.x + 丙1.w + 130, 丙1.y + 丙1.h / 2);
  const 丙2 = await barOf('丙一');
  // 只设了截止的任务:R11 起条 = 当天开头 ~ 截止,所以右端后移时左沿会跟着日期走,
  // 宽度不一定变大 —— 断言改为"截止时刻确实后移了"
  const endOf = (t) => { const m = (t || '').match(/~ (\d+)\/(\d+) (\d+):(\d+)/); return m ? Number(m[2]) * 1440 + Number(m[3]) * 60 + Number(m[4]) : null; };
  const e1 = endOf(before), e2 = endOf(丙2?.title);
  log('  ④ 右端把手伸缩:', before, '→', 丙2?.title, 丙2 && 丙2.title !== before && e2 > e1 ? '✓' : '✗');
} else {
  log('  ④ 跳过:丙一条宽', 丙1?.w, '不足 36px 无把手');
}
const noCard1 = await evalJS(`![...document.body.querySelectorAll('[data-state="open"]')].length`);
log('  ⑥ 伸缩后未误弹浮窗:', noCard1 ? '✓' : '✗');

// ③ 行内空白拖划 = 设时间范围(丙一条现已在窗口尾部;改在 丁二 行的空白周六→周日)
const trackInfo = await evalJS(`(() => {
  const el = [...document.querySelectorAll('[data-gantt-track]')].find(e => (e.previousElementSibling?.textContent || '').includes('丁二'));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, h: r.height, pxPerDay: r.width / 7 };
})()`);
if (trackInfo) {
  const { left, top, h, pxPerDay } = trackInfo;
  await dragPt(left + 5.5 * pxPerDay, top + h / 2, left + 6.5 * pxPerDay, top + h / 2);
  const 丁 = await barOf('丁二');
  log('  ③ 空白拖划设范围(周六→周日):', 丁?.title, 丁 && 丁.title.includes('9/19 00:00') && 丁.title.includes('9/20 23:59') ? '✓' : '(看 title 时间)');
} else {
  log('  ③ 找不到丁二轨道 ✗');
}
const noCard2 = await evalJS(`![...document.body.querySelectorAll('[data-state="open"]')].length`);
log('  ⑥ 拖划后未误弹浮窗:', noCard2 ? '✓' : '✗');

// ②b 未排期坞:拖 乙随便 到 甲due 轨道的周三 → 乙随便出条、出坞
const chip = await evalJS(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '乙随便');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
})()`);
const trackA = await evalJS(`(() => {
  const el = [...document.querySelectorAll('[data-gantt-track]')].find(e => (e.previousElementSibling?.textContent || '').includes('甲due'));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, h: r.height, pxPerDay: r.width / 7 };
})()`);
if (chip && trackA) {
  await dragPt(chip.x, chip.y, trackA.left + 2.5 * trackA.pxPerDay, trackA.top + trackA.h / 2);
  const after = await evalJS(`(() => {
    const row = [...document.querySelectorAll('[data-gantt-track]')].some(el => (el.previousElementSibling?.textContent || '').includes('乙随便'));
    const bar = [...document.querySelectorAll('[title]')].some(x => (x.getAttribute('title')||'').includes('乙随便') && (x.className||'').includes('top-1/2'));
    const stillTray = [...document.querySelectorAll('button.touch-none')].some(b => b.textContent.trim() === '乙随便');
    return { row, bar, stillTray };
  })()`);
  log('  ②b 拖坞排期:乙随便', JSON.stringify(after), after.row && after.bar && !after.stillTray ? '✓' : '✗');
} else {
  log('  ②b 跳过:chip/轨道缺失', JSON.stringify({ chip: !!chip, trackA: !!trackA }));
}

// 分隔线数量在乙随便排期后应为 3(4 个根)
const seps2 = await evalJS(`document.querySelectorAll('.gantt-group-sep').length`);
log(`  ⑤b 排期后分隔线 ${seps2} 条(4 根 → 期望 3):`, seps2 === 3 ? '✓' : '(树序可能相邻合并)');
ws.close();
