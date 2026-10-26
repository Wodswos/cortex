/**
 * mindmap 删除/选中状态机回归:清库 → 建任务 → 五个场景 → 刷新持久化断言。
 * 场景:S1 编辑后删 · S2 Tab建子后删(只删子)· S3 空白处框选批量删 ·
 *       S4 备注聚焦时退格(不删)· S5 Enter新建同级后删。
 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('.', import.meta.url));
const WebSocket = require('ws');

const CDP = 'http://127.0.0.1:9222';
const APP = 'http://127.0.0.1:30090';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[reg]', ...a);
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  log((ok ? '✓' : '✗') + ' ' + name + (extra ? ' | ' + extra : ''));
};

async function main() {
  // 关掉旧标签页:同一 profile 共享 IndexedDB,残留页面的跨标签广播会污染本轮数据
  for (const t of await (await fetch(`${CDP}/json/list`)).json()) {
    if (t.type === 'page') await fetch(`${CDP}/json/close/${t.id}`).catch(() => {});
  }
  await sleep(500);
  const res = await fetch(`${CDP}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
  const ws = new WebSocket((await res.json()).webSocketDebuggerUrl);
  await new Promise((r) => ws.once('open', r));
  let seq = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 150));
    } else if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push('EXC: ' + JSON.stringify(m.params.exceptionDetails.exception ?? {}).slice(0, 250));
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('page js: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result?.value;
  };
  const click = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  };
  const dblClick = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 2 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 2 });
  };
  const drag = async (x1, y1, x2, y2) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 12; i++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: x1 + ((x2 - x1) * i) / 12, y: y1 + ((y2 - y1) * i) / 12 });
      await sleep(16);
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', buttons: 0, clickCount: 1 });
  };
  const key = async (k, code) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: code === 'Enter' ? 13 : code === 'Tab' ? 9 : 8 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: code === 'Enter' ? 13 : code === 'Tab' ? 9 : 8 });
  };
  const nav = async (url) => { await send('Page.navigate', { url }); await sleep(2400); };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  // 禁用 HTTP 缓存:确保每次跑的都是刚部署的 bundle(heuristic 缓存会喂旧 index.html)
  await send('Network.setCacheDisabled', { cacheDisabled: true });

  // 清 Service Worker/缓存,再清上一轮的本地数据
  await nav(`${APP}/tasks`);
  await evalJS(`(async () => {
    if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
    return 1;
  })()`);
  await evalJS(`indexedDB.databases().then(dbs => Promise.all(dbs.filter(d => d.name && d.name.startsWith('cortex:')).map(d => new Promise(r => { const rq = indexedDB.deleteDatabase(d.name); rq.onsuccess = rq.onerror = rq.onblocked = r; })))).then(() => 'cleared')`);
  await nav(`${APP}/tasks`);
  await sleep(1000);

  // 建任务
  await evalJS(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    for (const name of ['A1','A2','A3','B1','C1','C2']) {
      [...document.querySelectorAll('button')].find(b => b.textContent.includes('新任务')).click();
      await sleep(150);
      const edit = [...document.querySelectorAll('input')].filter(i => i.offsetParent !== null && i.closest('[data-row]'))[0];
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(edit, name);
      edit.dispatchEvent(new Event('input', { bubbles: true }));
      edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await sleep(200);
    }
    return 'seeded';
  })()`);

  const nodesOnce = () => evalJS(`(() => {
    const out = {};
    for (const n of document.querySelectorAll('.react-flow__node')) {
      const r = n.getBoundingClientRect();
      out[n.textContent.replace(/\\d+\\/\\d+/g, '').trim().slice(0, 8)] = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }
    return out;
  })()`);
  /** 等到导图节点出现(最多 ~8s)再返回 */
  const nodes = async () => {
    for (let i = 0; i < 20; i++) {
      const c = await nodesOnce();
      if (Object.keys(c).length > 0) return c;
      await sleep(400);
    }
    const dbg = await evalJS(`location.href + ' | rf=' + !!document.querySelector('.react-flow') + ' | rows=' + document.querySelectorAll('[data-row]').length + ' | body=' + document.body.textContent.slice(0, 80)`);
    throw new Error('nodes() empty: ' + dbg);
  };

  await nav(`${APP}/tasks?view=mindmap`);

  // S1 编辑标题 → Enter → Delete
  let c = await nodes();
  await dblClick(c['A1'].x, c['A1'].y); await sleep(350);
  await send('Input.insertText', { text: 'A1x' }); await key('Enter', 'Enter'); await sleep(450);
  await key('Backspace', 'Backspace'); await sleep(500);
  c = await nodes();
  check('S1 编辑提交后删除', !('A1x' in c), Object.keys(c).join(','));

  // S2 Tab 建子 → 提交 → Delete(只删新建的子)
  c = await nodes();
  await click(c['A2'].x, c['A2'].y); await sleep(350);
  await key('Tab', 'Tab'); await sleep(450);
  await send('Input.insertText', { text: 'A2c' }); await key('Enter', 'Enter'); await sleep(450);
  await key('Backspace', 'Backspace'); await sleep(500);
  c = await nodes();
  check('S2 Tab建子后删除(删子留父)', !('A2c' in c) && 'A2' in c, Object.keys(c).join(','));

  // S3 空白处起拖框选 → 批量删(起拖点选在「全部任务」与任务列之间的空白走廊,画布内)
  c = await nodes();
  const paneRect = await evalJS(`(() => { const r = document.querySelector('.react-flow__pane').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const allNode = Object.keys(c).find((k) => k.includes('全部任务'));
  const anyTask = Object.keys(c).find((k) => k !== '全部任务' && !k.includes('全部任务'));
  const corridorX = allNode && anyTask ? (c[allNode].x + c[anyTask].x) / 2 : paneRect.x + paneRect.w / 2;
  const startX = Math.max(paneRect.x + 10, corridorX);
  const startY = paneRect.y + paneRect.h - 12;
  const endX = c[anyTask] ? c[anyTask].x + 40 : paneRect.x + paneRect.w - 20;
  const endY = paneRect.y + 12;
  const hitStart = await evalJS(`(() => { const el = document.elementFromPoint(${Math.round(startX)}, ${Math.round(startY)}); return el ? el.tagName + '.' + String(el.className).slice(0, 50) : 'null'; })()`);
  log('S3 起点', Math.round(startX), Math.round(startY), '→', hitStart);
  await drag(startX, startY, endX, endY);
  await sleep(300);
  log('S3 拖拽后 selection 矩形:', await evalJS(`(() => { const s = document.querySelector('.react-flow__selection'); return s ? 'EXISTS' : 'none'; })()`));
  await sleep(200);
  const selCount = await evalJS(`document.querySelectorAll('.react-flow__node.selected').length`);
  await key('Backspace', 'Backspace'); await sleep(600);
  c = await nodes();
  const remaining = Object.keys(c);
  // 框只罩住任务列的 4 个(A2/A3/B1/C1),C2 在框外应幸存;虚拟真根不可删
  check('S3 框选批量删除(选中 ' + selCount + ' 个)', selCount === 4 && remaining.join(',') === '全部任务,C2', remaining.join(','));
  if (selCount < 2) check('S3a 框选本身有效', false, '选中数=' + selCount);

  // S4 备注聚焦时退格:不删
  await nav(`${APP}/tasks`);
  await evalJS(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    for (const name of ['D1']) {
      [...document.querySelectorAll('button')].find(b => b.textContent.includes('新任务')).click();
      await sleep(150);
      const edit = [...document.querySelectorAll('input')].filter(i => i.offsetParent !== null && i.closest('[data-row]'))[0];
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(edit, name);
      edit.dispatchEvent(new Event('input', { bubbles: true }));
      edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await sleep(200);
    }
  })()`);
  await nav(`${APP}/tasks?view=mindmap`);
  c = await nodes();
  await click(c['D1'].x, c['D1'].y); await sleep(450);
  const notes = await evalJS(`(() => { const ta = document.querySelector('[data-inspector] textarea'); if (!ta) return null; const r = ta.getBoundingClientRect(); return { x: r.x + 40, y: r.y + 10 }; })()`);
  if (notes) {
    await click(notes.x, notes.y); await sleep(250);
    await key('Backspace', 'Backspace'); await sleep(400);
    c = await nodes();
    check('S4 备注聚焦时退格不删任务', 'D1' in c);
  }

  // S5 Enter 新建同级 → 提交 → Delete
  c = await nodes();
  if (c['D1']) {
    await click(c['D1'].x, c['D1'].y); await sleep(350);
    await key('Enter', 'Enter'); await sleep(450);
    await send('Input.insertText', { text: 'D2' }); await key('Enter', 'Enter'); await sleep(450);
    await key('Backspace', 'Backspace'); await sleep(500);
    c = await nodes();
    check('S5 Enter新建同级后删除(删新留旧)', !('D2' in c) && 'D1' in c, Object.keys(c).join(','));
  }

  // 刷新持久化
  await nav(`${APP}/tasks?view=mindmap`);
  c = await nodes();
  const finalKeys = Object.keys(c).join(',');
  check('RELOAD 持久化一致', finalKeys === '全部任务,C2,D1', finalKeys);
  check('无页面异常', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' || '));

  const failed = results.filter((r) => !r.ok);
  log(`\n==== ${results.length - failed.length}/${results.length} passed ====`);
  ws.close();
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('[reg] FAILED:', e); process.exit(2); });
