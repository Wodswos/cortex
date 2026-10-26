/**
 * R16 验证(导图连线穿线 + 粗细层级化):
 *  ① 结构节点区域内有穿线:与连线同色同宽的横线铺满容器,标签底下不再是空缺
 *     (R15 的根因:连线只画到左右锚点,标签正下方一段压根没线,看着像被遮住)
 *  ② 连线真正"从标签下方完整穿过":边路径端点落在穿线两端(无缝),标签悬在穿线上方
 *  ③ 连线粗细随层级收细:第一层 4 → 每深一层 −1 → 下限 1.5
 *  ④ 除粗细外样式完全统一:同色/实线/圆头/同透明度
 *  ⑤ 任务卡片仍是端点(卡片内无穿线)
 *  ⑥ 切折线后穿线/粗细规则不变  ⑦ 刷新后保持  ⑧ 收尾恢复舒缓
 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('.', import.meta.url));
const WebSocket = require('ws');
const APP = 'http://127.0.0.1:30090';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[r16]', ...a);
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

// ---------- 清场 + 种子:干S → 枝S → 叶T → 芽T 四级链(只建干S为根,子级全走子任务入口,无杂散根) ----------
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
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(edit, '干S');
  edit.dispatchEvent(new Event('input', { bubbles: true }));
  edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise(r => setTimeout(r, 220));
  return 1;
})()`);
// 按钮精确定位自己的行(嵌套行不能按"包含"找,否则父行也会命中)
const rowOf = async (title) => evalJS(`(() => {
  const b = [...document.querySelectorAll('[data-row] button')].find(x => x.textContent.trim() === ${JSON.stringify(title)});
  if (!b) return null;
  const r = b.closest('[data-row]').getBoundingClientRect();
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
for (const [parent, child] of [['干S', '枝S'], ['枝S', '叶T'], ['叶T', '芽T']]) {
  await openSheetBy(parent);
  await evalJS(`(async () => {
    const card = [...document.body.querySelectorAll('[data-state="open"]')][0];
    const inp = [...card.querySelectorAll('input')].find(i => i.placeholder && i.placeholder.includes('添加子任务'));
    if (!inp) return 'NO-SUB-INPUT';
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, ${JSON.stringify(child)});
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    return 'ok';
  })()`);
  await closeSheet();
}
for (const n of ['干S', '枝S']) {
  const p = await rowOf(n);
  await rightClickPt(p.x, p.y);
  await evalJS(`(() => { [...document.querySelectorAll('button')].find(b => b.textContent.includes('转为结构节点'))?.click(); return 1; })()`);
  await sleep(500);
}
await nav(`${APP}/tasks?view=mindmap`);
await sleep(2600);

// ---------- 页内测量工具(evalJS 里带不出函数,一次取全量快照) ----------
const snap = () => evalJS(`(() => {
  const byText = (t) => [...document.querySelectorAll('.react-flow__node')].find(n => (n.textContent || '').includes(t));
  const innerOf = (n) => n ? (n.querySelector('div.group') || n.firstElementChild) : null;
  const node = (t) => {
    const n = byText(t);
    if (!n) return null;
    const inner = innerOf(n);
    const r = inner.getBoundingClientRect();
    const line = inner.querySelector('[data-structural-line]');
    const lr = line ? line.getBoundingClientRect() : null;
    const title = [...inner.querySelectorAll('span')].find(s => (s.textContent || '').trim() === t);
    const label = title ? title.parentElement : null;
    const tr = label ? label.getBoundingClientRect() : null;
    return {
      id: n.dataset.id,
      rect: { l: +r.left.toFixed(1), r: +r.right.toFixed(1), mid: +(r.top + r.height / 2).toFixed(1), w: +r.width.toFixed(1) },
      line: lr ? { l: +lr.left.toFixed(1), r: +lr.right.toFixed(1), t: +lr.top.toFixed(1), b: +lr.bottom.toFixed(1), h: +lr.height.toFixed(2), bg: getComputedStyle(line).backgroundColor } : null,
      label: tr ? { b: +tr.bottom.toFixed(1), bg: getComputedStyle(label).backgroundColor } : null,
      checkbox: !!inner.querySelector('button[aria-label="完成"]'),
      borderW: getComputedStyle(inner).borderTopWidth,
    };
  };
  const ends = {};
  const edge = (id) => {
    const g = [...document.querySelectorAll('.react-flow__edge')].find(x => x.dataset.id === id);
    if (!g) return null;
    const p = g.querySelector('.react-flow__edge-path');
    const ctm = p.ownerSVGElement.getScreenCTM();
    const len = p.getTotalLength();
    const map = (pt) => { const s = new DOMPoint(pt.x, pt.y).matrixTransform(ctm); return { x: +s.x.toFixed(1), y: +s.y.toFixed(1) }; };
    const cs = getComputedStyle(p);
    return { first: map(p.getPointAtLength(0)), last: map(p.getPointAtLength(len)), w: parseFloat(cs.strokeWidth) };
  };
  const all = [...document.querySelectorAll('.react-flow__edge')].map((g) => {
    const p = g.querySelector('.react-flow__edge-path');
    const cs = getComputedStyle(p);
    return { id: g.dataset.id, w: parseFloat(cs.strokeWidth), stroke: cs.stroke, dash: cs.strokeDasharray, cap: cs.strokeLinecap, op: cs.opacity, d: p.getAttribute('d') || '' };
  });
  const ids = {};
  for (const t of ['干S', '枝S', '叶T', '芽T']) { const n = byText(t); if (n) ids[t] = n.dataset.id; }
  return { ids, nodes: { 干S: node('干S'), 枝S: node('枝S'), 叶T: node('叶T'), 芽T: node('芽T') }, all };
})()`);

const s0 = await snap();
const eid = (from, to) => `${from === 'VR' ? '__cortex_all__' : s0.ids[from]}->${s0.ids[to]}`;
const edgeOf = (s, id) => s.all.find((e) => e.id === id);

// ---------- ① 结构节点穿线存在且几何正确 ----------
check('① 干S/枝S 都有穿线元素', !!s0.nodes.干S.line && !!s0.nodes.枝S.line,
  JSON.stringify({ 干S: s0.nodes.干S.line, 枝S: s0.nodes.枝S.line }));
if (s0.nodes.干S.line && s0.nodes.枝S.line) {
  // 屏幕像素换回 CSS 像素:结构容器显式宽 = nodeWidth("干S"/"枝S") = 64px,屏宽/64 即当前缩放
  const lineOK = (n, expectW) => {
    const zoom = n.rect.w / 64;
    const mid2 = (n.line.t + n.line.b) / 2;
    return Math.abs(n.line.h / zoom - expectW) < 0.3 && Math.abs(mid2 - n.rect.mid) <= 1.5 && n.line.l <= n.rect.l && n.line.r >= n.rect.r;
  };
  check('① 干S 穿线:粗4.0/居中线/铺满容器', lineOK(s0.nodes.干S, 4), JSON.stringify({ rect: s0.nodes.干S.rect, line: s0.nodes.干S.line }));
  check('① 枝S 穿线:粗3.0/居中线/铺满容器', lineOK(s0.nodes.枝S, 3), JSON.stringify({ rect: s0.nodes.枝S.rect, line: s0.nodes.枝S.line }));
  const anyStroke = edgeOf(s0, eid('VR', '干S'))?.stroke;
  check('① 穿线颜色与连线一致(同 rgba)', s0.nodes.干S.line.bg === anyStroke, `${s0.nodes.干S.line.bg} vs ${anyStroke}`);
}

// ---------- ② 连线真正穿过:边端点落在穿线两端,标签悬在穿线上方 ----------
{
  const endsOf = async (id) => evalJS(`(() => {
    const g = [...document.querySelectorAll('.react-flow__edge')].find(x => x.dataset.id === ${JSON.stringify(id)});
    if (!g) return null;
    const p = g.querySelector('.react-flow__edge-path');
    const ctm = p.ownerSVGElement.getScreenCTM();
    const len = p.getTotalLength();
    const map = (pt) => { const s = new DOMPoint(pt.x, pt.y).matrixTransform(ctm); return { x: +s.x.toFixed(1), y: +s.y.toFixed(1) }; };
    return { first: map(p.getPointAtLength(0)), last: map(p.getPointAtLength(len)) };
  })()`);
  for (const [name, node, inEdge, outEdge] of [
    ['干S', s0.nodes.干S, eid('VR', '干S'), eid('干S', '枝S')],
    ['枝S', s0.nodes.枝S, eid('干S', '枝S'), eid('枝S', '叶T')],
  ]) {
    if (!node.line) continue;
    const ie = await endsOf(inEdge), oe = await endsOf(outEdge);
    const inJoin = ie && ie.last.x >= node.line.l - 2 && ie.last.x <= node.rect.l + 4 && Math.abs(ie.last.y - node.rect.mid) <= 2;
    const outJoin = oe && oe.first.x <= node.line.r + 2 && oe.first.x >= node.rect.r - 4 && Math.abs(oe.first.y - node.rect.mid) <= 2;
    check(`② ${name} 入线/出线端点都落在穿线两端(无缝穿过)`, inJoin && outJoin,
      JSON.stringify({ inEnd: ie?.last, outStart: oe?.first, line: node.line, mid: node.rect.mid }));
    check(`② ${name} 标签悬在穿线上方(留缝不遮线)`, node.label.b <= node.line.t - 1 && node.label.bg === 'rgba(0, 0, 0, 0)',
      `labelBottom=${node.label.b} lineTop=${node.line.t}`);
  }
}

// ---------- ③ 粗细随层级收细 ----------
const ladder = [
  ['VR->干S', eid('VR', '干S'), 4],
  ['干S->枝S', eid('干S', '枝S'), 3],
  ['枝S->叶T', eid('枝S', '叶T'), 2],
  ['叶T->芽T', eid('叶T', '芽T'), 1.5],
];
for (const [label, id, expect] of ladder) {
  const e = edgeOf(s0, id);
  check(`③ ${label} 粗细 = ${expect}`, e && Math.abs(e.w - expect) < 0.01, e ? `实际 ${e.w}` : '边不存在');
}

// ---------- ④ 除粗细外样式完全统一 ----------
{
  const strokes = new Set(s0.all.map((e) => e.stroke));
  const dashes = new Set(s0.all.map((e) => e.dash));
  const caps = new Set(s0.all.map((e) => e.cap));
  const ops = new Set(s0.all.map((e) => e.op));
  const widthsOK = s0.all.every((e) => [4, 3, 2, 1.5].includes(e.w));
  check('④ 颜色全图唯一', strokes.size === 1, JSON.stringify([...strokes]));
  check('④ 全部实线(dash none)/圆头/同透明度', dashes.has('none') && dashes.size === 1 && caps.size === 1 && caps.has('round') && ops.size === 1,
    JSON.stringify({ dashes: [...dashes], caps: [...caps], ops: [...ops] }));
  check('④ 粗细只取 {4, 3, 2, 1.5} 阶梯值', widthsOK, JSON.stringify([...new Set(s0.all.map((e) => e.w))]));
}

// ---------- ⑤ 任务卡片仍是端点(无穿线) ----------
check('⑤ 叶T/芽T 卡片内无穿线,仍有边框+勾选框',
  !s0.nodes.叶T.line && !s0.nodes.芽T.line && parseFloat(s0.nodes.叶T.borderW) >= 1 && s0.nodes.叶T.checkbox === true && s0.nodes.芽T.checkbox === true,
  JSON.stringify({ 叶T: { line: s0.nodes.叶T.line, borderW: s0.nodes.叶T.borderW, checkbox: s0.nodes.叶T.checkbox }, 芽T: { checkbox: s0.nodes.芽T.checkbox } }));

// ---------- ⑥ 切折线:穿线仍在,粗细规则不变 ----------
const clickStyle = async (label) => {
  await evalJS(`(() => { [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})?.click(); return 1; })()`);
  await sleep(600);
};
await clickStyle('折线');
const s1 = await snap();
{
  const stepEdges = s1.all;
  const noC = stepEdges.every((e) => !e.d.includes('C'));
  const multiL = stepEdges.reduce((a, e) => a + (e.d.match(/L/g) || []).length, 0) > stepEdges.length;
  check('⑥ 折线生效(无 C、有直角拐点)', noC && multiL);
  const lineOK = (n, expectW) => n.line && Math.abs(n.line.h / (n.rect.w / 64) - expectW) < 0.3 && Math.abs((n.line.t + n.line.b) / 2 - n.rect.mid) <= 1.5;
  check('⑥ 折线下穿线仍在且对齐中线', lineOK(s1.nodes.干S, 4) && lineOK(s1.nodes.枝S, 3),
    JSON.stringify({ 干S: s1.nodes.干S.line, 枝S: s1.nodes.枝S.line }));
  const w = (id) => edgeOf(s1, id)?.w;
  check('⑥ 折线下粗细阶梯不变', Math.abs(w(eid('VR', '干S')) - 4) < 0.01 && Math.abs(w(eid('枝S', '叶T')) - 2) < 0.01,
    JSON.stringify({ a: w(eid('VR', '干S')), d: w(eid('枝S', '叶T')) }));
}

// ---------- ⑦ 刷新后保持 ----------
await nav(`${APP}/tasks?view=mindmap`);
await sleep(2600);
const s2 = await snap();
check('⑦ 刷新后粗细阶梯保持', Math.abs(edgeOf(s2, eid('VR', '干S'))?.w - 4) < 0.01 && Math.abs(edgeOf(s2, eid('叶T', '芽T'))?.w - 1.5) < 0.01 && !!s2.nodes.干S.line,
  JSON.stringify({ a: edgeOf(s2, eid('VR', '干S'))?.w, d: edgeOf(s2, eid('叶T', '芽T'))?.w, line: !!s2.nodes.干S.line }));

// ---------- ⑧ 收尾恢复舒缓 ----------
await clickStyle('舒缓');
const s3 = await snap();
check('⑧ 收尾恢复舒缓曲线', s3.all.some((e) => e.d.includes('C')));
log(`结果: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
