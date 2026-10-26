/** R15 截图:结构节点标签悬在连线上方 + 连线统一色/样式切换(舒缓 vs 折线) */
import { createRequire } from 'node:module';
const require = createRequire(new URL('.', import.meta.url));
const WebSocket = require('ws');
const APP = 'http://127.0.0.1:30090';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[r15shot]', ...a);
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
await send('Runtime.enable'); await send('Page.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await nav(`${APP}/tasks`);
await evalJS(`(async () => {
  if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
  await indexedDB.databases().then(dbs => Promise.all(dbs.filter(d => d.name && d.name.startsWith('cortex:')).map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = r; }))));
})()`);
await nav(`${APP}/tasks?view=list`);
await sleep(900);
await evalJS(`(async () => {
  for (const name of ['发布里程碑', '写需求文档', '联调测试', '写周报']) {
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
  await evalJS(`(() => { [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '编辑详情')?.click(); return 1; })()`);
  await sleep(650);
};
const closeSheet = async () => {
  const card = await evalJS(`(() => { const c = [...document.body.querySelectorAll('[data-state="open"]')][0]; if (!c) return null; const r = c.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top) }; })()`);
  if (card) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.max(8, card.l - 140), y: Math.min(300, card.t + 40), button: 'left', buttons: 1, clickCount: 1 });
    await sleep(40);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.max(8, card.l - 140), y: Math.min(300, card.t + 40), button: 'left', buttons: 0, clickCount: 1 });
  }
  await sleep(400);
};
await openSheet('发布里程碑');
await evalJS(`(async () => {
  const card = [...document.body.querySelectorAll('[data-state="open"]')][0];
  for (const name of ['写需求文档', '联调测试', '写周报']) {
    const inp = [...card.querySelectorAll('input')].find(i => i.placeholder && i.placeholder.includes('添加子任务'));
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, name);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 350));
  }
})()`);
await closeSheet();
// 右击 发布里程碑 → 转为结构节点;删掉顶层多余的三个
{
  const pt = await evalJS(`(() => { const r = [...document.querySelectorAll('[data-row]')].find(x => x.textContent.includes('发布里程碑')).getBoundingClientRect(); return { x: Math.round(r.left + r.width * 0.5), y: Math.round(r.top + r.height / 2) }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'right', buttons: 2, clickCount: 1 });
  await sleep(50);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'right', buttons: 0, clickCount: 1 });
  await sleep(350);
  await evalJS(`(() => { [...document.querySelectorAll('button')].find(b => b.textContent.includes('转为结构节点'))?.click(); return 1; })()`);
  await sleep(500);
}
for (const n of ['写需求文档', '联调测试', '写周报']) {
  const pt = await evalJS(`(() => {
    const row = [...document.querySelectorAll('[data-row]')].find(r => [...r.querySelectorAll('button')].some(b => b.textContent.trim() === ${JSON.stringify(n)}));
    if (!row) return null;
    const r = row.getBoundingClientRect();
    return { x: Math.round(r.left + r.width * 0.5), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!pt) continue;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'right', buttons: 2, clickCount: 1 });
  await sleep(50);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'right', buttons: 0, clickCount: 1 });
  await sleep(350);
  await evalJS(`(() => { [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '删除')?.click(); return 1; })()`);
  await sleep(350);
}
await nav(`${APP}/tasks?view=mindmap`);
await sleep(2600);
await send('Page.captureScreenshot', { format: 'png' }).then((r) => {
  require('node:fs').writeFileSync('/tmp/r15-curve.png', Buffer.from(r.data, 'base64'));
  log('舒缓曲线截图: /tmp/r15-curve.png');
});
await evalJS(`(() => { [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '折线')?.click(); return 1; })()`);
await sleep(700);
await send('Page.captureScreenshot', { format: 'png' }).then((r) => {
  require('node:fs').writeFileSync('/tmp/r15-step.png', Buffer.from(r.data, 'base64'));
  log('折线截图: /tmp/r15-step.png');
});
process.exit(0);
