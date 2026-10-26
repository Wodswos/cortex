/**
 * R15 验证(导图连线三件套):
 *  ① 结构节点文字标签悬在连线上方(高于节点中线,不再压线遮线)
 *  ② 连线颜色统一中性色:所有 edge 同一个灰调,不再跟随任务优先级边框色
 *  ③ 连线样式可切换:舒缓曲线(默认)/ 直线 / 折线,切换即时生效
 *  ④ 样式存 settings:刷新后保持
 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('.', import.meta.url));
const WebSocket = require('ws');
const APP = 'http://127.0.0.1:30090';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[r15]', ...a);
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

// ---------- 清场 + 种子:测A(普通,带子任务) + 组G(结构节点,带子任务) ----------
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
  for (const name of ['测A', '组G']) {
    [...document.querySelectorAll('button')].find(b => b.textContent.includes('新任务')).click();
    await new Promise(r => setTimeout(r, 150));
    const edit = [...document.querySelectorAll('input')].filter(i => i.offsetParent !== null && i.closest('[data-row]'))[0];
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(edit, name);
    edit.dispatchEvent(new Event('input', { bubbles: true }));
    edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 220));
  }
})()`);
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
for (const [parent, child] of [['测A', '子甲'], ['组G', '子乙']]) {
  await openSheet(parent);
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
{
  const pt = await evalJS(`(() => {
    const row = [...document.querySelectorAll('[data-row]')].find(r => [...r.querySelectorAll('button')].some(b => b.textContent.trim() === '组G'));
    const r = row.getBoundingClientRect();
    return { x: Math.round(r.left + r.width * 0.5), y: Math.round(r.top + r.height / 2) };
  })()`);
  await rightClickPt(pt.x, pt.y);
  await evalJS(`(() => { [...document.querySelectorAll('button')].find(b => b.textContent.includes('转为结构节点'))?.click(); return 1; })()`);
  await sleep(500);
}
await nav(`${APP}/tasks?view=mindmap`);
await sleep(2600);

// ---------- ① 结构节点标签悬在连线上方 ----------
const mm = await evalJS(`(() => {
  const nodes = [...document.querySelectorAll('.react-flow__node')];
  const find = (t) => nodes.find(n => (n.textContent || '').includes(t));
  const g = find('组G'), k = find('子乙');
  const inner = (n) => n ? n.querySelector('div.group') || n.firstElementChild : null;
  const gi = inner(g), ki = inner(k);
  const title = gi ? [...gi.querySelectorAll('span')].find(s => (s.textContent || '').trim() === '组G') : null;
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
    labelBottom: lr ? Math.round(lr.bottom) : null,
    midline: mid != null ? Math.round(mid) : null,
    labelBg: label ? getComputedStyle(label).backgroundColor : null,
    kBorderW: ki ? getComputedStyle(ki).borderTopWidth : null,
    kCheckbox: k ? !!k.querySelector('button[aria-label="完成"]') : null,
  };
})()`);
check('① 结构节点仍是标签形态(无边框/无 Folder/无勾选)',
  String(mm.gBorder).startsWith('0px') && mm.gBg === 'rgba(0, 0, 0, 0)' && mm.gFolder === false && mm.gCheckbox === false, JSON.stringify(mm));
check('① 文字标签悬在连线上方(标签底高于节点中线 ≥2px)', mm.labelBottom != null && mm.labelBottom <= mm.midline - 2, `labelBottom=${mm.labelBottom} midline=${mm.midline}`);
check('① 标签无底色,不遮线', mm.labelBg === 'rgba(0, 0, 0, 0)', String(mm.labelBg));
check('① 子任务仍是卡片(有边框 + 勾选框)', parseFloat(mm.kBorderW) >= 1 && mm.kCheckbox === true, JSON.stringify(mm));

// ---------- ② 连线颜色统一 ----------
const edgeInfo = () => evalJS(`(() => {
  const paths = [...document.querySelectorAll('.react-flow__edge-path')];
  return {
    count: paths.length,
    strokes: paths.map(p => getComputedStyle(p).stroke),
    ds: paths.map(p => p.getAttribute('d') || ''),
  };
})()`);
const e0 = await edgeInfo();
const strokeSet = new Set(e0.strokes);
const grayish = (s) => { const n = (s.match(/[\d.]+/g) || []).map(Number); return n.length >= 3 && Math.abs(n[0] - n[1]) < 8 && Math.abs(n[1] - n[2]) < 8; };
check('② 连线至少 3 条(结构/任务分支都在)', e0.count >= 3, `count=${e0.count}`);
check('② 所有连线同一个颜色(不再按优先级染色)', strokeSet.size === 1, JSON.stringify([...strokeSet]));
check('② 颜色是中性灰(不是 P0 红/P1 橙等语义色)', e0.strokes.every(grayish), JSON.stringify(e0.strokes.slice(0, 2)));

// ---------- ③ 连线样式切换:舒缓 / 直线 / 折线 ----------
const shape = (ei) => ({
  count: ei.count,
  hasC: ei.ds.some((d) => d.includes('C')),
  totalL: ei.ds.reduce((a, d) => a + (d.match(/L/g) || []).length, 0),
});
const clickStyle = async (label) => {
  await evalJS(`(() => { [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})?.click(); return 1; })()`);
  await sleep(600);
};
const activeStyle = () => evalJS(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => ['舒缓','直线','折线'].includes(x.textContent.trim()) && String(x.className).includes('gradient-bg'));
  return b ? b.textContent.trim() : null;
})()`);
const sCurve = shape(e0);
check('③ 默认 = 舒缓曲线(path 有 C 控制点)', sCurve.hasC && sCurve.count >= 3, JSON.stringify(sCurve));
check('③ 默认高亮「舒缓」', (await activeStyle()) === '舒缓', await activeStyle());

await clickStyle('直线');
const sStraight = shape(await edgeInfo());
check('③ 直线:无 C、每条恰好一段 L', !sStraight.hasC && sStraight.totalL === sStraight.count, JSON.stringify(sStraight));
check('③ 切换后高亮「直线」', (await activeStyle()) === '直线', await activeStyle());

await clickStyle('折线');
const sStep = shape(await edgeInfo());
check('③ 折线:无 C、出现直角拐点(L 段多于边数)', !sStep.hasC && sStep.totalL > sStep.count, JSON.stringify(sStep));
check('③ 切换后高亮「折线」', (await activeStyle()) === '折线', await activeStyle());

// ---------- ④ 样式持久化:刷新后仍是折线 ----------
await nav(`${APP}/tasks?view=mindmap`);
await sleep(2600);
const sReload = shape(await edgeInfo());
check('④ 刷新后仍是折线(settings 持久)', !sReload.hasC && sReload.totalL > sReload.count, JSON.stringify(sReload));
check('④ 刷新后高亮「折线」', (await activeStyle()) === '折线', await activeStyle());
// 收尾:恢复默认曲线
await clickStyle('舒缓');
const sBack = shape(await edgeInfo());
check('④ 收尾恢复舒缓曲线', sBack.hasC, JSON.stringify(sBack));

log(`结果: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
