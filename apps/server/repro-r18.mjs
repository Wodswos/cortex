/**
 * R18 验证(session 级管理 + 详情界面细节):
 *  ① 状态/优先级下方的说明注释已移除
 *  ② 标签、备注区块移到「链接(tmux)」之后
 *  ③ 详情界面关联已有 session(chip 出现)
 *  ④ chip 上 ⏻ 结束会话:两步红色确认;取消不误杀;确认后服务器上 session 消失、chip 关联保留
 *  ⑤ 详情界面「新建…」手输新名 = 在服务器上创建 session 并关联
 *  ⑥ Inspector 面板同款结束会话(两步确认、取消安全、确认生效、关联保留)
 * 全程只用自建 r18a / r18b 会话,不动真实会话。
 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('.', import.meta.url));
const WebSocket = require('ws');
const CDP = 'http://127.0.0.1:9222';
const APP = 'http://127.0.0.1:30090';
const HOST = 'wuzh@172.19.0.1';
const SESS_A = 'r18a';
const SESS_B = 'r18b';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[r18]', ...a);
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`); };

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
const nav = async (url) => { await send('Page.navigate', { url }); await sleep(2800); };
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const clickPt = async (x, y, gap = 60) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(gap);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
};
const setInputValue = (el, v) => evalJS(`(() => {
  const el = ${el};
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(v)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`);
/** 轮询直到表达式真值或超时 */
const waitFor = async (expr, timeout = 10000, every = 400) => {
  for (const dead = Date.now() + timeout; ; ) {
    const v = await evalJS(expr);
    if (v) return v;
    if (Date.now() > dead) return null;
    await sleep(every);
  }
};

// ---------- 清场 + 服务器档案 ----------
await nav(`${APP}/tasks`);
await evalJS(`(async () => {
  if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
  await indexedDB.databases().then(dbs => Promise.all(dbs.filter(d => d.name && d.name.startsWith('cortex:')).map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = r; }))));
  return 1;
})()`);
await nav(`${APP}/settings`);
await sleep(800);
await setInputValue(`[...document.querySelectorAll('input')].find(i => i.placeholder.includes('名称'))`, '本机网关');
await setInputValue(`[...document.querySelectorAll('input')].find(i => i.placeholder.includes('user@ip'))`, HOST);
await evalJS(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '添加')?.click(); 1`);
await sleep(600);

// ---------- API 辅助(页面内 fetch,同源) ----------
const api = (path, body) => evalJS(`fetch('/api/tmux/${path}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then(r => r.json())`);
const sessionAlive = async (name) => {
  const r = await api('sessions', { host: HOST });
  return (r.sessions ?? []).includes(name);
};
for (const s of [SESS_A, SESS_B]) await api('kill-session', { host: HOST, session: s }); // 残留先清
const made = await api('new-session', { host: HOST, session: SESS_A });
check('前置:测试会话 r18a 就绪', made.ok === true, JSON.stringify(made));

// ---------- 建任务 → 打开详情(TaskSheet 浮窗) ----------
await nav(`${APP}/tasks`);
await sleep(900);
await evalJS(`(async () => {
  [...document.querySelectorAll('button')].find(b => b.textContent.includes('新任务')).click();
  await new Promise(r => setTimeout(r, 180));
  const edit = [...document.querySelectorAll('input')].filter(i => i.offsetParent !== null && i.closest('[data-row]'))[0];
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(edit, 'R18会话任务');
  edit.dispatchEvent(new Event('input', { bubbles: true }));
  edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise(r => setTimeout(r, 250));
})()`);
await evalJS(`[...document.querySelectorAll('[data-row]')][0]?.click(); 1`);
await sleep(500);
await evalJS(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '编辑详情')?.click(); 'open'`);
const sheetOpen = await waitFor(`!!document.querySelectorAll('[data-state="open"]')[0]`, 8000);
check('前置:任务详情浮窗打开', !!sheetOpen);

// ---------- ① 状态/优先级注释已移除 ----------
{
  const t = await evalJS(`document.querySelectorAll('[data-state="open"]')[0].textContent`);
  const noStatusHint = !t.includes('按开始/截止时间自动判断');
  const noPriHint = !t.includes('P0 立即做');
  check('① 状态下方注释已去掉', noStatusHint);
  check('① 优先级下方注释已去掉', noPriHint);
}

// ---------- ② 标签/备注移到链接之后 ----------
{
  const order = await evalJS(`(() => {
    const card = document.querySelectorAll('[data-state="open"]')[0];
    const top = (txt) => { const s = [...card.querySelectorAll('span')].find(x => x.textContent.trim() === txt); return s ? Math.round(s.getBoundingClientRect().top) : null; };
    return { link: top('链接 · Note / Agent / tmux'), tag: top('标签'), note: top('备注(Markdown)') };
  })()`);
  check('② 顺序:链接 → 标签 → 备注', order.link != null && order.tag != null && order.note != null && order.link < order.tag && order.tag < order.note, JSON.stringify(order));
}

// ---------- ③ 详情里关联已有 session ----------
{
  const ok = await evalJS(`(() => {
    const card = document.querySelectorAll('[data-state="open"]')[0];
    const srv = [...card.querySelectorAll('select')].find(s => [...s.options].some(o => o.textContent.trim() === '选服务器…'));
    if (!srv) return 'NO-SRV-SELECT';
    const opt = [...srv.options].find(o => o.textContent.trim() === '本机网关');
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(srv, opt.value);
    srv.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  })()`);
  check('③ 选中服务器档案', ok === 'ok', String(ok));
  const listed = await waitFor(`(() => { const card = document.querySelectorAll('[data-state="open"]')[0]; const sel = [...card.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === '__new__')); return sel && [...sel.options].some(o => o.value === ${JSON.stringify(SESS_A)}); })()`, 10000);
  check('③ 会话列表拉到 r18a', !!listed);
  await evalJS(`(() => {
    const card = document.querySelectorAll('[data-state="open"]')[0];
    const sel = [...card.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === '__new__'));
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(sel, ${JSON.stringify(SESS_A)});
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await evalJS(`(() => { const card = document.querySelectorAll('[data-state="open"]')[0]; [...card.querySelectorAll('button')].find(b => b.textContent.trim() === '关联')?.click(); })()`);
  await sleep(600);
  const chip = await evalJS(`(() => { const card = document.querySelectorAll('[data-state="open"]')[0]; return [...card.querySelectorAll('button')].some(b => b.textContent.includes(${JSON.stringify(SESS_A + '@')})); })()`);
  check('③ 关联 → chip r18a@本机网关 出现', !!chip);
}

// ---------- ④ ⏻ 结束会话:两步确认 ----------
{
  await evalJS(`(() => { const card = document.querySelectorAll('[data-state="open"]')[0]; [...card.querySelectorAll('button')].find(b => (b.title || '').includes('结束该 tmux'))?.click(); })()`);
  await sleep(400);
  const strip = await evalJS(`(() => {
    const t = document.querySelectorAll('[data-state="open"]')[0].textContent;
    return { warn: t.includes('结束会话 ${SESS_A}') && t.includes('不可恢复'), cancel: t.includes('取消'), confirm: t.includes('确认结束') };
  })()`);
  check('④ 确认条:结束会话 r18a + 不可恢复 + 取消/确认结束', strip.warn && strip.cancel && strip.confirm, JSON.stringify(strip));
  await evalJS(`(() => { const card = document.querySelectorAll('[data-state="open"]')[0]; [...card.querySelectorAll('button')].find(b => b.textContent.trim() === '取消')?.click(); })()`);
  await sleep(400);
  const gone = await evalJS(`!document.querySelectorAll('[data-state="open"]')[0].textContent.includes('不可恢复')`);
  check('④ 取消 → 确认条消失,r18a 仍活着', gone && (await sessionAlive(SESS_A)));
  await evalJS(`(() => { const card = document.querySelectorAll('[data-state="open"]')[0]; [...card.querySelectorAll('button')].find(b => (b.title || '').includes('结束该 tmux'))?.click(); })()`);
  await sleep(300);
  await evalJS(`(() => { const card = document.querySelectorAll('[data-state="open"]')[0]; [...card.querySelectorAll('button')].find(b => b.textContent.trim() === '确认结束')?.click(); })()`);
  const dead = await waitFor(`(async () => { for (let i = 0; i < 20; i++) { const r = await fetch('/api/tmux/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify({ host: HOST }))} }).then(x => x.json()); if (!(r.sessions ?? []).includes(${JSON.stringify(SESS_A)})) return true; await new Promise(s2 => setTimeout(s2, 300)); } return false; })()`, 10000);
  check('④ 确认结束 → 服务器上 r18a 消失', !!dead);
  const chipKept = await evalJS(`(() => { const card = document.querySelectorAll('[data-state="open"]')[0]; return [...card.querySelectorAll('button')].some(b => b.textContent.includes(${JSON.stringify(SESS_A + '@')})); })()`);
  check('④ 关联保留(chip 未被误删)', !!chipKept);
}

// ---------- ⑤ 「新建…」= 在服务器上创建 session 并关联 ----------
{
  await evalJS(`(() => { const card = document.querySelectorAll('[data-state="open"]')[0]; [...card.querySelectorAll('button')].find(b => b.textContent.trim() === '新建…')?.click(); })()`);
  await sleep(300);
  const typing = await evalJS(`(() => { const card = document.querySelectorAll('[data-state="open"]')[0]; return !![...card.querySelectorAll('input')].find(i => i.placeholder.includes('新 session 名')); })()`);
  check('⑤ 「新建…」进入手输', !!typing);
  await setInputValue(`[...document.querySelectorAll('[data-state="open"]')[0].querySelectorAll('input')].find(i => i.placeholder.includes('新 session 名'))`, SESS_B);
  await evalJS(`(() => { const card = document.querySelectorAll('[data-state="open"]')[0]; [...card.querySelectorAll('button')].find(b => (b.title || '').includes('创建同名'))?.click(); })()`);
  const created = await waitFor(`(async () => { for (let i = 0; i < 20; i++) { const r = await fetch('/api/tmux/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify({ host: HOST }))} }).then(x => x.json()); if ((r.sessions ?? []).includes(${JSON.stringify(SESS_B)})) return true; await new Promise(s2 => setTimeout(s2, 300)); } return false; })()`, 10000);
  check('⑤ 服务器上 r18b 被创建', !!created);
  await sleep(600);
  const chip = await evalJS(`(() => { const card = document.querySelectorAll('[data-state="open"]')[0]; return [...card.querySelectorAll('button')].some(b => b.textContent.includes(${JSON.stringify(SESS_B + '@')})); })()`);
  check('⑤ 创建后自动关联(chip r18b@本机网关)', !!chip);
}

// ---------- ⑥ Inspector 同款结束会话 ----------
{
  // 点外部关浮窗 → 重新选行打开 dock Inspector
  const cardRect = await evalJS(`(() => { const r = document.querySelectorAll('[data-state="open"]')[0].getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top) }; })()`);
  await clickPt(Math.max(8, cardRect.x - 160), 300, 40);
  await sleep(500);
  await evalJS(`[...document.querySelectorAll('[data-row]')][0]?.click(); 1`);
  await sleep(500);
  const chip = await waitFor(`(() => { const insp = document.querySelector('[data-inspector]'); return insp && [...insp.querySelectorAll('button')].some(b => b.textContent.includes(${JSON.stringify(SESS_B + '@')})); })()`, 8000);
  check('⑥ Inspector 显示 r18b chip', !!chip);
  // 任务此时挂着 r18a+r18b 两条链接,Power 必须定位到 r18b 那个 chip 行,别抓第一个
  const powerB = `(() => { const insp = document.querySelector('[data-inspector]'); const chip = [...insp.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(SESS_B + '@')})); return chip?.closest('span')?.querySelector('button[title*="结束该 tmux"]'); })()`;
  const p1 = await evalJS(`(${powerB})?.click(); 'clicked'`);
  await sleep(400);
  const strip = await evalJS(`(() => { const t = document.querySelector('[data-inspector]').textContent; return t.includes('结束会话 ${SESS_B}') && t.includes('不可恢复') && t.includes('确认结束'); })()`);
  check('⑥ Inspector 确认条(两步)', !!strip, p1);
  await evalJS(`(() => { const insp = document.querySelector('[data-inspector]'); [...insp.querySelectorAll('button')].find(b => b.textContent.trim() === '取消')?.click(); })()`);
  await sleep(300);
  check('⑥ 取消 → r18b 仍活着', await sessionAlive(SESS_B));
  await evalJS(`(${powerB})?.click(); 'clicked2'`);
  await sleep(300);
  await evalJS(`(() => { const insp = document.querySelector('[data-inspector]'); [...insp.querySelectorAll('button')].find(b => b.textContent.trim() === '确认结束')?.click(); })()`);
  const dead = await waitFor(`(async () => { for (let i = 0; i < 20; i++) { const r = await fetch('/api/tmux/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify({ host: HOST }))} }).then(x => x.json()); if (!(r.sessions ?? []).includes(${JSON.stringify(SESS_B)})) return true; await new Promise(s2 => setTimeout(s2, 300)); } return false; })()`, 10000);
  check('⑥ 确认结束 → r18b 消失', !!dead);
  const chipKept = await evalJS(`(() => { const insp = document.querySelector('[data-inspector]'); return [...insp.querySelectorAll('button')].some(b => b.textContent.includes(${JSON.stringify(SESS_B + '@')})); })()`);
  check('⑥ 关联保留', !!chipKept);
}

log(`结果: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
