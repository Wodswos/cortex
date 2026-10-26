/** R11 目视:甘特(优先级填色/无聚合条/缩进)+ 导图(优先级色框)截图 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(new URL('.', import.meta.url));
const WebSocket = require('ws');
const APP = 'http://127.0.0.1:30090';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`/tmp/${name}.png`, Buffer.from(r.data, 'base64')); console.log('shot', name); };
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

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
  for (const name of ['Serve 服务化', 'Workflow 编排', 'Infra 基建']) {
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

const openSheet = async (title) => {
  await evalJS(`(() => { [...document.querySelectorAll('[data-row]')].find(r => r.textContent.includes(${JSON.stringify(title)}))?.click(); return 1; })()`);
  await sleep(450);
  await evalJS(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '编辑详情')?.click(); 'open'`);
  await sleep(650);
};
const closeSheet = async () => {
  const card = await evalJS(`(() => { const c = [...document.body.querySelectorAll('[data-state="open"]')][0]; if (!c) return null; const r = c.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top) }; })()`);
  if (card) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.max(8, card.l - 140), y: Math.min(300, card.t + 40), button: 'left', buttons: 1, clickCount: 1 });
    await sleep(50);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.max(8, card.l - 140), y: Math.min(300, card.t + 40), button: 'left', buttons: 0, clickCount: 1 });
  }
  await sleep(400);
};
const setDetail = async (title, { startMin, dueMin, priority }) => {
  await openSheet(title);
  await evalJS(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const card = [...document.body.querySelectorAll('[data-state="open"]')][0];
    if (!card) return 'NO-CARD';
    const pad = n => String(n).padStart(2, '0');
    const local = (ms) => { const d = new Date(ms); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes()); };
    const fieldBtn = (label) => { const s = [...card.querySelectorAll('span')].find(x => x.textContent.trim() === label); return s ? s.parentElement.querySelector('button') : null; };
    const fill = async (btn, ms) => {
      btn.click(); await sleep(150);
      const inp = [...card.querySelectorAll('input[type="datetime-local"]')].find(i => i.offsetParent !== null);
      if (!inp) return 'NO-INPUT';
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, local(ms));
      inp.dispatchEvent(new Event('change', { bubbles: true })); await sleep(200); return 'ok';
    };
    if (${startMin} != null) await fill(fieldBtn('开始时间'), Date.now() + ${startMin} * 60000);
    if (${dueMin} != null) await fill(fieldBtn('截止时间'), Date.now() + ${dueMin} * 60000);
    if (${JSON.stringify(priority ?? null)} != null) {
      const pb = [...card.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(priority ?? '')});
      pb?.click(); await sleep(200);
    }
    return 'ok';
  })()`);
  await closeSheet();
};


// 挂层级:经详情面板的「添加子任务」建子任务(Serve 下两个、Infra 下一个)
const addChild = async (parent, child) => {
  await openSheet(parent);
  await evalJS(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const card = [...document.body.querySelectorAll('[data-state="open"]')][0];
    const inp = [...card.querySelectorAll('input')].find(i => i.placeholder && i.placeholder.includes('添加子任务'));
    if (!inp) return 'NO-SUB-INPUT';
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, ${JSON.stringify(child)});
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(400);
    return 'ok';
  })()`);
  await closeSheet();
};
await setDetail('Serve 服务化', { startMin: -600, dueMin: 480, priority: 'P0' });
await setDetail('Workflow 编排', { startMin: -300, dueMin: 600, priority: 'P1' });
await setDetail('Infra 基建', { startMin: 0, dueMin: 900, priority: 'P2' });
await addChild('Serve 服务化', 'Proteina 上线');
await addChild('Serve 服务化', 'OpenDDE 联调');
await addChild('Infra 基建', '集群资源盘点');
await setDetail('Proteina 上线', { startMin: -120, dueMin: 300, priority: 'P0' });
await setDetail('OpenDDE 联调', { startMin: -60, dueMin: 420, priority: 'P1' });
await setDetail('集群资源盘点', { startMin: -30, dueMin: 600, priority: 'P3' });
// 完成一个:Proteina → 甘特条应变绿
await evalJS(`(() => {
  const row = [...document.querySelectorAll('[data-row]')].find(r => r.textContent.includes('Proteina 上线'));
  row?.querySelector('button[aria-label="完成"]')?.click();
  return 1;
})()`);
await sleep(400);

await nav(`${APP}/tasks?view=gantt`);
await sleep(1500);
await evalJS(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.title === '时间轴放大(拖条可按 5 分钟微调)'); b.click(); b.click(); return 1; })()`);
await sleep(600);
await shot('r11-gantt');

await nav(`${APP}/tasks?view=mindmap`);
await sleep(2000);
await shot('r11-mindmap');
ws.close();
