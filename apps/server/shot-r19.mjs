/** R19 目检截图:右击菜单 + 悬停「设定时间」的级联子菜单(右侧)/ 右缘翻左侧 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('.', import.meta.url));
const WebSocket = require('ws');
const CDP = 'http://127.0.0.1:9222';
const APP = 'http://127.0.0.1:30090';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[shot]', ...a);
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
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const rightClickPt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
};
const hoverPt = async (x, y) => { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 }); };

await send('Page.navigate', { url: `${APP}/tasks` });
await sleep(2800);
await evalJS(`(async () => {
  [...document.querySelectorAll('button')].find(b => b.textContent.includes('新任务')).click();
  await new Promise(r => setTimeout(r, 180));
  const edit = [...document.querySelectorAll('input')].filter(i => i.offsetParent !== null && i.closest('[data-row]'))[0];
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(edit, '截图任务');
  edit.dispatchEvent(new Event('input', { bubbles: true }));
  edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise(r => setTimeout(r, 250));
})()`);
const p = await evalJS(`(() => { const row = [...document.querySelectorAll('[data-row]')].find(r => r.textContent.includes('截图任务')); const r = row.getBoundingClientRect(); return { x: Math.round(r.left + 160), y: Math.round(r.top + r.height / 2) }; })()`);
await rightClickPt(p.x, p.y);
await sleep(300);
let item = await evalJS(`(() => { const menu = [...document.querySelectorAll('div')].find(d => String(d.className).includes('glass-raised') && String(d.className).includes('fixed')); const b = [...menu.querySelectorAll('button')].find(x => x.textContent.includes('设定时间')); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
await hoverPt(item.x, item.y);
await sleep(400);
await send('Page.captureScreenshot', { format: 'png' }).then((r) => { require('node:fs').writeFileSync('/tmp/r19-right.png', Buffer.from(r.data, 'base64')); log('右侧级联 → /tmp/r19-right.png'); });
await evalJS(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 1`);
await sleep(300);
const p2 = await evalJS(`(() => { const row = [...document.querySelectorAll('[data-row]')].find(r => r.textContent.includes('截图任务')); const r = row.getBoundingClientRect(); return { x: Math.round(Math.min(1432, r.right - 10)), y: Math.round(r.top + r.height / 2) }; })()`);
await rightClickPt(p2.x, p2.y);
await sleep(300);
item = await evalJS(`(() => { const menu = [...document.querySelectorAll('div')].find(d => String(d.className).includes('glass-raised') && String(d.className).includes('fixed')); const b = [...menu.querySelectorAll('button')].find(x => x.textContent.includes('优先级')); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
await hoverPt(item.x, item.y);
await sleep(400);
await send('Page.captureScreenshot', { format: 'png' }).then((r) => { require('node:fs').writeFileSync('/tmp/r19-left.png', Buffer.from(r.data, 'base64')); log('左翻级联 → /tmp/r19-left.png'); });
process.exit(0);
