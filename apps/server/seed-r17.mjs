/** R17:把用户真实树(/tmp/r17-tree.json)种子进 CDP 浏览器本地档,供复现导图连线混乱 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('.', import.meta.url));
const WebSocket = require('ws');
const APP = 'http://127.0.0.1:30090';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[r17seed]', ...a);
const TREE = JSON.parse(require('node:fs').readFileSync('/tmp/r17-tree.json', 'utf8'));

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
const evalJS = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || '').slice(0, 400)); return r.result?.value; };
const nav = async (url) => { await send('Page.navigate', { url }); await sleep(2600); };
await send('Runtime.enable'); await send('Page.enable');
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

// 清场(只清浏览器本地档,不碰服务器)
await nav(`${APP}/tasks`);
await evalJS(`(async () => {
  if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
  await indexedDB.databases().then(dbs => Promise.all(dbs.filter(d => d.name && d.name.startsWith('cortex:')).map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = r; }))));
  return 1;
})()`);
await nav(`${APP}/tasks?view=list`);
await sleep(1000);

const setInput = (exp, val) => evalJS(`(() => {
  const inp = ${exp};
  if (!inp) return 'NO-INPUT';
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, ${JSON.stringify(val)});
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return 'ok';
})()`);

// 第 k 次出现的同名行(种子顺序 = DFS = 列表渲染顺序,出现序严格对应)
const nthRowPt = (title, n) => evalJS(`(() => {
  const bs = [...document.querySelectorAll('[data-row] button')].filter(x => x.textContent.trim() === ${JSON.stringify(title)});
  const b = bs[${n}];
  if (!b) return { err: 'NOT-FOUND', total: bs.length };
  const row = b.closest('[data-row]');
  row.scrollIntoView({ block: 'center' }); // 视口外的行点不到(CDP 视口外点击静默无效)
  const r = row.getBoundingClientRect();
  return { x: Math.round(r.left + r.width * 0.6), y: Math.round(r.top + r.height / 2) };
})()`);

const seen = new Map();
const occ = (t) => { const k = (seen.get(t) ?? 0); seen.set(t, k + 1); return k; };

// 根:新任务
for (const root of TREE) {
  await evalJS(`(() => { [...document.querySelectorAll('button')].find(b => b.textContent.includes('新任务')).click(); return 1; })()`);
  await sleep(200);
  await evalJS(`(() => {
    const edit = [...document.querySelectorAll('input')].filter(i => i.offsetParent !== null && i.closest('[data-row]'))[0];
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(edit, ${JSON.stringify(root.t)});
    edit.dispatchEvent(new Event('input', { bubbles: true }));
    edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return 1;
  })()`);
  occ(root.t);
  await sleep(260);
}

// 子孙:sheet 添加子任务(先给每个节点分配同名出现序号:种子顺序 = DFS = 列表 DOM 顺序)
const openSheet = async (title, n) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const p = await nthRowPt(title, n);
    if (p.err) throw new Error(`openSheet ${title}#${n}: ${p.err}/${p.total}`);
    await clickPt(p.x, p.y);
    await sleep(450);
    await evalJS(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '编辑详情')?.click(); 1`);
    await sleep(650);
    const ok = await evalJS(`(() => { const c = [...document.body.querySelectorAll('[data-state="open"]')][0]; return !!(c && [...c.querySelectorAll('input')].some(i => i.placeholder && i.placeholder.includes('添加子任务'))); })()`);
    if (ok) return;
    log(`sheet 未开,重试 ${attempt + 1}`, title);
    await closeSheet();
    await sleep(400);
  }
  throw new Error(`openSheet ${title}#${n} 三次失败`);
};
const closeSheet = async () => {
  const card = await evalJS(`(() => { const c = [...document.body.querySelectorAll('[data-state="open"]')][0]; if (!c) return null; const r = c.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top) }; })()`);
  if (card) await clickPt(Math.max(8, card.l - 140), Math.min(300, card.t + 40), 40);
  await sleep(350);
};
let made = TREE.length;
seen.clear();
const assign = (nodes) => { for (const n of nodes) { n.occ = occ(n.t); assign(n.children); } };
assign(TREE);
const seedChildren2 = async (node) => {
  if (!node.children.length) return;
  await openSheet(node.t, node.occ);
  for (const c of node.children) {
    const r = await setInput(`[...document.body.querySelectorAll('[data-state="open"]')][0]
      ? [...[...document.body.querySelectorAll('[data-state="open"]')][0].querySelectorAll('input')].find(i => i.placeholder && i.placeholder.includes('添加子任务'))
      : null`, c.t);
    if (r !== 'ok') throw new Error(`sub-input ${node.t} → ${c.t}: ${r}`);
    made++;
    await sleep(300);
  }
  await closeSheet();
  for (const c of node.children) await seedChildren2(c);
};
for (const root of TREE) await seedChildren2(root);
log(`种子完成:${made} 节点`);

// 结构节点转换:右击 → 转为结构节点
let converted = 0;
const convertAll = async (nodes) => {
  for (const n of nodes) {
    if (n.s) {
      const p = await nthRowPt(n.t, n.occ);
      if (p.err) { log('!! 转换定位失败', n.t, JSON.stringify(p)); continue; }
      await rightClickPt(p.x, p.y);
      const clicked = await evalJS(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('转为结构节点')); if (b) { b.click(); return 1; } return 0; })()`);
      await sleep(450);
      if (clicked) converted++;
    }
    await convertAll(n.children);
  }
};
await convertAll(TREE);
log(`结构节点转换:${converted}`);
await nav(`${APP}/tasks?view=mindmap`);
await sleep(3000);
log('完成,已停在导图视图');
process.exit(0);
