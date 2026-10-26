/** R12 截图:结构节点(容器)在列表/甘特 + 逾期「!」角标 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('.', import.meta.url));
const WebSocket = require('ws');
const APP = 'http://127.0.0.1:30090';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[r12shot]', ...a);

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
await send('Emulation.setEmulatedMedia', { media: 'prefers-color-scheme', features: [] });

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
  for (const name of ['里程碑M(结构)', '逾期P0', '进行中P1']) {
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
    await sleep(40);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.max(8, card.l - 140), y: Math.min(300, card.t + 40), button: 'left', buttons: 0, clickCount: 1 });
  }
  await sleep(400);
};
const setTime = async (title, startMin, dueMin) => {
  await openSheet(title);
  await evalJS(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const card = [...document.body.querySelectorAll('[data-state="open"]')][0];
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
    await fillByLabel('开始时间', Date.now() + ${startMin} * 60000);
    await fillByLabel('截止时间', Date.now() + ${dueMin} * 60000);
    return 'ok';
  })()`);
  await closeSheet();
};

// 里程碑M 加两个子任务并排期;自己转为结构节点
await openSheet('里程碑M(结构)');
await evalJS(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const card = [...document.body.querySelectorAll('[data-state="open"]')][0];
  for (const name of ['需求梳理', '联调验证']) {
    const inp = [...card.querySelectorAll('input')].find(i => i.placeholder && i.placeholder.includes('添加子任务'));
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, name);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(350);
  }
  return 'ok';
})()`);
await closeSheet();
await setTime('需求梳理', -150, 60);
await setTime('联调验证', 40, 260);
await setTime('逾期P0', -180, -40);
await setTime('进行中P1', -60, 120);

// 右击 里程碑M → 转为结构节点
const pt = await evalJS(`(() => {
  const row = [...document.querySelectorAll('[data-row]')].find(r => [...r.querySelectorAll('button')].some(b => b.textContent.trim() === '里程碑M(结构)'));
  const r = row.getBoundingClientRect();
  return { x: Math.round(r.left + r.width * 0.5), y: Math.round(r.top + r.height / 2) };
})()`);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'right', buttons: 2, clickCount: 1 });
await sleep(50);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'right', buttons: 0, clickCount: 1 });
await sleep(350);
await evalJS(`(() => { [...document.querySelectorAll('button')].find(b => b.textContent.includes('转为结构节点'))?.click(); return 1; })()`);
await sleep(500);

// 列表截图(右栏 dock 一个结构节点详情展示 KindToggle)
await evalJS(`(() => { [...document.querySelectorAll('[data-row]')].find(r => r.textContent.includes('里程碑M(结构)'))?.click(); return 1; })()`);
await sleep(600);
await send('Page.captureScreenshot', { format: 'png' }).then((r) => {
  require('node:fs').writeFileSync('/tmp/r12-list.png', Buffer.from(r.data, 'base64'));
  log('列表截图: /tmp/r12-list.png');
});

// 甘特截图
await nav(`${APP}/tasks?view=gantt`);
await sleep(1800);
await send('Page.captureScreenshot', { format: 'png' }).then((r) => {
  require('node:fs').writeFileSync('/tmp/r12-gantt.png', Buffer.from(r.data, 'base64'));
  log('甘特截图: /tmp/r12-gantt.png');
});
process.exit(0);
