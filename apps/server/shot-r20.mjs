/** R20 目检截图:拖选高亮 + 「已复制」提示 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(new URL('.', import.meta.url));
const WebSocket = require('ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hostSSH = (cmd) => { try { return execSync(`docker exec cortex ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no wuzh@172.19.0.1 ${JSON.stringify(cmd)}`, { encoding: 'utf8' }).trim(); } catch { return ''; } };

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
const nav = async (url) => { await send('Page.navigate', { url }); await sleep(2800); };
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const clickPt = async (x, y, gap = 50) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(gap);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
};
const waitFor = async (expr, timeout = 15000, every = 400) => {
  for (const dead = Date.now() + timeout; ; ) {
    const v = await evalJS(expr);
    if (v) return v;
    if (Date.now() > dead) return null;
    await sleep(every);
  }
};
hostSSH(`tmux kill-session -t r20shot 2>/dev/null; tmux new-session -d -s r20shot "printf 'SELECT-ME-0123456789-ABCDEFGHIJ\\n'; sleep 120"`);
await sleep(500);
await nav('http://127.0.0.1:30090/tasks');
await evalJS(`(async () => {
  if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
  await indexedDB.databases().then(dbs => Promise.all(dbs.filter(d => d.name && d.name.startsWith('cortex:')).map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = r; }))));
  return 1;
})()`);
await nav('http://127.0.0.1:30090/settings');
await sleep(800);
await evalJS(`(() => {
  const set = (ph, v) => { const el = [...document.querySelectorAll('input')].find(i => i.placeholder.includes(ph)); Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  set('名称', '本机网关');
  set('user@ip', 'wuzh@172.19.0.1');
  [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '添加')?.click();
  return 1;
})()`);
await sleep(600);
await nav('http://127.0.0.1:30090/tasks');
await sleep(900);
await evalJS(`(async () => {
  [...document.querySelectorAll('button')].find(b => b.textContent.includes('新任务')).click();
  await new Promise(r => setTimeout(r, 180));
  const edit = [...document.querySelectorAll('input')].filter(i => i.offsetParent !== null && i.closest('[data-row]'))[0];
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(edit, 'R20截图');
  edit.dispatchEvent(new Event('input', { bubbles: true }));
  edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise(r => setTimeout(r, 250));
})()`);
await evalJS(`[...document.querySelectorAll('[data-row]')][0]?.click(); 1`);
await sleep(500);
await waitFor(`(() => { const sel = document.querySelector('[data-inspector] select'); return !!sel && [...sel.options].some(o => o.textContent.includes('本机网关')); })()`, 8000);
await evalJS(`(() => {
  const sel = document.querySelector('[data-inspector] select');
  const opt = [...sel.options].find(o => o.textContent.includes('本机网关'));
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(sel, opt.value);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await waitFor(`(() => { const sel = [...document.querySelectorAll('[data-inspector] select')].find(x => [...x.options].some(o => o.value === 'r20shot')); if (!sel) return false; Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(sel, 'r20shot'); sel.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`, 12000);
await evalJS(`[...document.querySelectorAll('[data-inspector] button')].find(b => b.textContent.includes('关联'))?.click(); 1`);
await sleep(400);
const chip = await evalJS(`(() => { const b = [...document.querySelectorAll('[data-inspector] button')].find(x => x.textContent.includes('r20shot')); const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
await clickPt(chip.x, chip.y);
await waitFor(`!![...document.querySelectorAll('.fixed.inset-0 span')].find(s => s.textContent.trim() === '已连接')`, 20000);
await sleep(2200);
// 首行标记文本上拖选一段(行中心 y,col 2 → col 34)
const geom = hostSSH(`tmux display -pt r20shot '#{pane_width} #{pane_height}'`).split(/\s+/).map(Number);
const r = await evalJS(`(() => { const q = document.querySelector('.fixed.inset-0 .xterm').getBoundingClientRect(); return { l: q.left, t: q.top, rgt: q.right, b: q.bottom }; })()`);
const cellW = (r.rgt - r.l) / geom[0], cellH = (r.b - r.t) / geom[1];
const y = Math.round(r.t + 0.5 * cellH);
const x1 = Math.round(r.l + 2 * cellW), x2 = Math.round(r.l + 34 * cellW);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y, button: 'left', buttons: 1, clickCount: 1 });
for (let i = 1; i <= 4; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + ((x2 - x1) * i) / 4, y, button: 'left', buttons: 1 });
  await sleep(30);
}
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y, button: 'left', buttons: 0, clickCount: 1 });
await sleep(200);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'c', code: 'KeyC', modifiers: 10 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'c', code: 'KeyC', modifiers: 10 });
await sleep(500);
await send('Page.captureScreenshot', { format: 'png' }).then((q) => { require('node:fs').writeFileSync('/tmp/r20-copy.png', Buffer.from(q.data, 'base64')); console.log('[shot] 选区+已复制提示 → /tmp/r20-copy.png'); });
hostSSH('tmux kill-session -t r20shot 2>/dev/null');
process.exit(0);
