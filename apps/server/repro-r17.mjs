/**
 * R17 验证(导图折线"一坨乱线"根因 = 布局宽度 ≠ 卡片真实 DOM 宽度,走廊被吃掉):
 *  ① 折线下每条边恰好 3 段 L(横出 → 共用竖干 → 横入),不再出现 5 段回折 S 线
 *  ② 路径 x 全程单调不减(永不向左回折)
 *  ③ 每条边目标 x − 起点 x ≥ 48(走廊没被超宽卡片吃掉;修复前实测仅 7.5)
 *  ④ 长标题卡片显式定宽且 = 真实 DOM 宽(canvas 实测文字宽,不再是拍脑袋公式)
 *  ⑤ 全图节点两两无重叠
 *  ⑥ 结构标签在折线下穿线仍在
 *  ⑦ 曲线(含 C)/直线(单段)两形态不受影响  ⑧ 刷新后折线与 3 段规则保持  ⑨ 收尾恢复舒缓
 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('.', import.meta.url));
const WebSocket = require('ws');
const APP = 'http://127.0.0.1:30090';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[r17]', ...a);
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
ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } });
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

// ---------- 清场 + 种子:长题(30 字 CJK,真实卡宽 ~250px > 旧公式上限 200)→ 4 子 → 1 孙 ----------
const LONG = '长题这是一个非常长的中文标题用来撑宽卡片让走廊收窄触发回折问题';
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
  [...document.querySelectorAll('button')].find(b => b.textContent.includes('新任务')).click();
  await new Promise(r => setTimeout(r, 150));
  const edit = [...document.querySelectorAll('input')].filter(i => i.offsetParent !== null && i.closest('[data-row]'))[0];
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(edit, ${JSON.stringify(LONG)});
  edit.dispatchEvent(new Event('input', { bubbles: true }));
  edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise(r => setTimeout(r, 220));
  return 1;
})()`);
// 视口外的行点不到(CDP 视口外点击静默无效),先 scrollIntoView
const rowOf = async (title) => evalJS(`(() => {
  const b = [...document.querySelectorAll('[data-row] button')].find(x => x.textContent.trim() === ${JSON.stringify(title)});
  if (!b) return null;
  const row = b.closest('[data-row]');
  row.scrollIntoView({ block: 'center' });
  const r = row.getBoundingClientRect();
  return { x: Math.round(r.left + r.width * 0.6), y: Math.round(r.top + r.height / 2) };
})()`);
const openSheetBy = async (title) => {
  const p = await rowOf(title);
  await clickPt(p.x, p.y);
  await sleep(450);
  await evalJS(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '编辑详情')?.click(); 1`);
  await sleep(650);
};
const closeSheet = async () => {
  const card = await evalJS(`(() => { const c = [...document.body.querySelectorAll('[data-state="open"]')][0]; if (!c) return null; const r = c.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top) }; })()`);
  if (card) await clickPt(Math.max(8, card.l - 140), Math.min(300, card.t + 40), 40);
  await sleep(400);
};
for (const [parent, child] of [[LONG, '子任务甲'], [LONG, '子任务乙'], [LONG, '子任务丙'], [LONG, '子任务丁'], ['子任务甲', '孙任务甲']]) {
  await openSheetBy(parent);
  const r = await evalJS(`(async () => {
    const card = [...document.body.querySelectorAll('[data-state="open"]')][0];
    const inp = [...card.querySelectorAll('input')].find(i => i.placeholder && i.placeholder.includes('添加子任务'));
    if (!inp) return 'NO-SUB-INPUT';
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, ${JSON.stringify(child)});
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    return 'ok';
  })()`);
  if (r !== 'ok') log('种子子任务失败:', parent, '→', child, r);
  await closeSheet();
}
// 子任务乙 → 结构节点(折线下穿线回归)
{
  const p = await rowOf('子任务乙');
  await rightClickPt(p.x, p.y);
  await evalJS(`(() => { [...document.querySelectorAll('button')].find(b => b.textContent.includes('转为结构节点'))?.click(); return 1; })()`);
  await sleep(500);
}
await nav(`${APP}/tasks?view=mindmap`);
await sleep(2600);

// ---------- 页内测量:全量边 d + 节点 rect/显式宽 + 缩放 ----------
const snap = () => evalJS(`(() => {
  const viewport = document.querySelector('.react-flow__viewport');
  const zoom = parseFloat((viewport.style.transform.match(/scale\\(([\\d.]+)\\)/) || [])[1]) || 1;
  const nodes = [...document.querySelectorAll('.react-flow__node')].map((n) => {
    const inner = n.querySelector('div.group') || n.firstElementChild;
    const r = inner.getBoundingClientRect();
    return {
      id: n.dataset.id, text: (n.textContent || '').slice(0, 24),
      l: r.left, t: r.top, w: r.width, h: r.height,
      styleW: parseFloat(inner.style.width) || null,
      line: !!inner.querySelector('[data-structural-line]'),
    };
  });
  const edges = [...document.querySelectorAll('.react-flow__edge')].map((g) => {
    const p = g.querySelector('.react-flow__edge-path');
    return { id: g.dataset.id, w: parseFloat(getComputedStyle(p).strokeWidth), d: p.getAttribute('d') || '' };
  });
  return { zoom, nodes, edges };
})()`);

const clickStyle = async (label) => {
  await evalJS(`(() => { [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})?.click(); return 1; })()`);
  await sleep(600);
};
const parseD = (d) => {
  const nums = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
  return { pts, ls: (d.match(/L/g) || []).length };
};

// ---------- ①②③ 折线:3 段 / 不回折 / 走廊 ----------
await clickStyle('折线');
const s1 = await snap();
{
  const badL = [], backtrack = [], narrow = [];
  for (const e of s1.edges) {
    const { pts, ls } = parseD(e.d);
    if (ls !== 3) badL.push(`${e.id}:${ls}L`);
    for (let i = 1; i < pts.length; i++) if (pts[i].x < pts[i - 1].x - 0.5) { backtrack.push(e.id); break; }
    const gap = pts.at(-1).x - pts[0].x;
    if (gap < 48) narrow.push(`${e.id}:${gap.toFixed(1)}px`);
  }
  check(`① 每条边恰好 3 段 L(${s1.edges.length}/${s1.edges.length})`, s1.edges.length > 0 && badL.length === 0, badL.join(', '));
  check('② 路径 x 全程单调(零回折)', backtrack.length === 0, backtrack.slice(0, 4).join(', '));
  check('③ 走廊宽 ≥ 48px(修复前 7.5)', narrow.length === 0, narrow.join(', '));
}

// ---------- ④ 长题卡片:显式定宽 = 真实宽(canvas 实测) ----------
{
  const long = s1.nodes.find((n) => n.text.includes('长题'));
  const realW = long ? long.w / s1.zoom : 0;
  check('④ 长题卡片显式宽 ≥ 230 且 = 真实 DOM 宽(±2)',
    !!long && long.styleW >= 230 && Math.abs(realW - long.styleW) <= 2,
    long ? `style=${long.styleW} real=${realW.toFixed(1)}` : '未找到');
}

// ---------- ⑤ 节点两两无重叠 ----------
{
  let overlaps = 0;
  const ns = s1.nodes;
  for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) {
    const a = ns[i], b = ns[j];
    if (Math.min(a.l + a.w, b.l + b.w) - Math.max(a.l, b.l) > 1 && Math.min(a.t + a.h, b.t + b.h) - Math.max(a.t, b.t) > 1) overlaps++;
  }
  check(`⑤ 节点两两无重叠(${ns.length} 节点)`, overlaps === 0, `重叠 ${overlaps} 对`);
}

// ---------- ⑥ 结构标签穿线仍在 ----------
{
  const s = s1.nodes.find((n) => n.text.includes('子任务乙'));
  check('⑥ 结构标签(子任务乙)折线下穿线仍在', !!s && s.line, JSON.stringify(s?.text));
}

// ---------- ⑦ 曲线/直线形态不受影响 ----------
await clickStyle('舒缓');
const s2 = await snap();
check('⑦ 曲线模式恢复(bezier C 段)', s2.edges.length === s1.edges.length && s2.edges.every((e) => e.d.includes('C')));
await clickStyle('直线');
const s3 = await snap();
check('⑦ 直线模式单段直达', s3.edges.length > 0 && s3.edges.every((e) => (e.d.match(/L/g) || []).length === 1));
await clickStyle('折线');

// ---------- ⑧ 刷新后保持 ----------
await nav(`${APP}/tasks?view=mindmap`);
await sleep(2600);
const s4 = await snap();
{
  const badL = s4.edges.filter((e) => (e.d.match(/L/g) || []).length !== 3);
  check(`⑧ 刷新后折线 + 3 段规则保持(${s4.edges.length} 边)`, s4.edges.length === s1.edges.length && badL.length === 0, badL.map((e) => e.id).slice(0, 4).join(', '));
}

// ---------- ⑨ 收尾恢复舒缓 ----------
await clickStyle('舒缓');
const s5 = await snap();
check('⑨ 收尾恢复舒缓曲线', s5.edges.some((e) => e.d.includes('C')));
log(`结果: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
