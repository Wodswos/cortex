/**
 * 复现:① tmux 点击 chip 后立刻断开(走完整 UI 路径:设置加服务器→任务关联→点击)
 *      ② 编辑态点击文本应移动光标而非退出编辑
 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('.', import.meta.url));
const WebSocket = require('ws');

const CDP = 'http://127.0.0.1:9222';
const APP = 'http://127.0.0.1:30090';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[ui]', ...a);

async function main() {
  for (const t of await (await fetch(`${CDP}/json/list`)).json()) {
    if (t.type === 'page') await fetch(`${CDP}/json/close/${t.id}`).catch(() => {});
  }
  await sleep(400);
  const res = await fetch(`${CDP}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
  const ws = new WebSocket((await res.json()).webSocketDebuggerUrl);
  await new Promise((r) => ws.once('open', r));
  let seq = 0;
  const pending = new Map();
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJS = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('pagejs: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)).slice(0, 250));
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
  const nav = async (url) => { await send('Page.navigate', { url }); await sleep(2600); };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });

  const setInputValue = (el, v) => evalJS(`(() => {
    const el = ${el};
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(v)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);

  // ---------- 清场 ----------
  await nav(`${APP}/tasks`);
  await evalJS(`(async () => {
    if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
    await indexedDB.databases().then(dbs => Promise.all(dbs.filter(d => d.name && d.name.startsWith('cortex:')).map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = r; }))));
    return 1;
  })()`);
  await nav(`${APP}/tasks`);
  await sleep(900);

  // ---------- ① 设置页:加服务器档案 ----------
  await nav(`${APP}/settings`);
  await setInputValue(`[...document.querySelectorAll('input')].find(i => i.placeholder.includes('名称'))`, '本机网关');
  await setInputValue(`[...document.querySelectorAll('input')].find(i => i.placeholder.includes('user@ip'))`, 'wuzh@172.19.0.1');
  await evalJS(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '添加')?.click(); 'clicked'`);
  await sleep(600);
  const serverRow = await evalJS(`document.body.textContent.includes('本机网关') ? 'server-added' : 'ADD-FAILED'`);
  log('① 服务器档案:', serverRow);

  // ---------- ② 列表:建任务,点行 → 详情面板关联 tmux ----------
  await nav(`${APP}/tasks`);
  await sleep(800);
  await evalJS(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('button')].find(b => b.textContent.includes('新任务')).click();
    await sleep(180);
    const edit = [...document.querySelectorAll('input')].filter(i => i.offsetParent !== null && i.closest('[data-row]'))[0];
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(edit, 'tmux任务');
    edit.dispatchEvent(new Event('input', { bubbles: true }));
    edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(250);
  })()`);
  await evalJS(`[...document.querySelectorAll('[data-row]')][0]?.click(); 'row-clicked'`);
  await sleep(500);
  const inspector = await evalJS(`!!document.querySelector('[data-inspector]')`);
  log('② 详情面板打开:', inspector);
  // 选服务器 + session 名 → 关联
  await evalJS(`(() => {
    const sel = document.querySelector('[data-inspector] select');
    if (!sel) return 'NO-SELECT';
    const opt = [...sel.options].find(o => o.textContent.includes('本机网关'));
    if (!opt) return 'NO-OPTION: ' + [...sel.options].map(o => o.textContent).join(',');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, opt.value);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return 'selected';
  })()`);
  // 原生 select:等会话列表拉回后选 5cortex
  let picked = null;
  for (let i = 0; i < 10; i++) {
    picked = await evalJS(`(() => {
      const sel = [...document.querySelectorAll('[data-inspector] select')].find(x => [...x.options].some(o => o.value === '__new__'));
      if (!sel) return 'NO-SELECT';
      const opt = [...sel.options].find(o => o.value === '5cortex');
      if (!opt) return 'not-loaded:' + sel.options.length;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, '5cortex');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return 'picked';
    })()`);
    if (picked === 'picked') break;
    await sleep(500);
  }
  log('② 会话下拉选择 5cortex:', picked);
  await evalJS(`[...document.querySelectorAll('[data-inspector] button')].find(b => b.textContent.includes('关联'))?.click(); 'linked'`);
  await sleep(500);
  const chip = await evalJS(`[...document.querySelectorAll('[data-inspector] button')].some(b => b.textContent.includes('5cortex'))`);
  log('② tmux 关联 chip 出现:', chip);

  // ---------- ③ 点 chip → 观察连接状态 ----------
  const chipPos = await evalJS(`(() => { const b = [...document.querySelectorAll('[data-inspector] button')].find(x => x.textContent.includes('5cortex')); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!chipPos) { log('✗ 没有 chip 可点'); }
  else {
    await click(chipPos.x, chipPos.y);
    await sleep(4000);
    const status = await evalJS(`(() => {
      const modal = document.querySelector('.fixed.inset-0');
      if (!modal) return 'NO-MODAL';
      const texts = modal.textContent.slice(0, 300);
      const term = !!modal.querySelector('.xterm-helper-textarea, .terminal');
      return { texts, term, pre: modal.querySelector('pre')?.textContent?.slice(0, 120) ?? null };
    })()`);
    log('③ 点击 chip 后 4s:', JSON.stringify(status));
    await sleep(3000);
    const status2 = await evalJS(`(() => {
      const modal = document.querySelector('.fixed.inset-0');
      if (!modal) return 'MODAL-CLOSED';
      return { texts: modal.textContent.slice(0, 300), termRows: modal.querySelectorAll('.xterm-rows div').length };
    })()`);
    log('③ 再等 3s:', JSON.stringify(status2));
  }

  // ---------- ④ 编辑态点击文本:光标 vs 退出 ----------
  await evalJS(`document.querySelector('.fixed.inset-0') && (document.querySelector('.fixed.inset-0 .react-flow') || document.body); (() => { const xs = [...document.querySelectorAll('button')]; const x = xs.find(b => b.textContent.trim() === '✕' || b.title.includes('关闭')); x?.click(); return 'closed'; })()`);
  await sleep(300);
  await nav(`${APP}/tasks?view=mindmap`);
  await sleep(1500);
  const c = await evalJS(`(() => { const o = {}; for (const n of document.querySelectorAll('.react-flow__node')) { if (n.textContent.includes('全部任务')) continue; const r = n.getBoundingClientRect(); o[n.textContent.trim().slice(0, 8)] = { x: r.x + r.width / 2, y: r.y + r.height / 2, left: r.x, top: r.y }; } return o; })()`);
  const tk = Object.keys(c).find((k) => k.includes('tmux任务'));
  if (!tk) { log('④ 任务节点未找到:', JSON.stringify(Object.keys(c))); ws.close(); return; }
  await dblClick(c[tk].x, c[tk].y); await sleep(400);
  const edit1 = await evalJS(`(() => { const i = [...document.querySelectorAll('.react-flow__node input')].filter(i => i.offsetParent)[0]; return i ? 'editing' : 'not-editing'; })()`);
  // 点击输入框文本中部(应移动光标,保持编辑态)
  const inp = await evalJS(`(() => { const i = [...document.querySelectorAll('.react-flow__node input')].find(i => i.offsetParent); if (!i) return null; const r = i.getBoundingClientRect(); return { x: r.x + Math.min(60, r.width / 2), y: r.y + r.height / 2 }; })()`);
  if (inp) { await click(inp.x, inp.y); } else { await click(c[tk].left + 60, c[tk].y); }
  await sleep(400);
  const edit2 = await evalJS(`(() => { const i = [...document.querySelectorAll('.react-flow__node input')].filter(i => i.offsetParent)[0]; return i ? 'still-editing(focused=' + (document.activeElement === i) + ')' : 'EXITED-EDITING'; })()`);
  log('④ 双击进入编辑:', edit1, '| 点击文本后:', edit2);
  ws.close();
}
main().catch((e) => { console.error('[ui] FAILED:', e.message); process.exit(1); });
