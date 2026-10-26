/**
 * 验证:① 设了时间的任务在 日视图(⏰ 标记)/周视图/矩阵(子任务)可见
 *      ② 甘特图渲染(条 + 今日线)③ tmux 会话下拉数据源通
 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('.', import.meta.url));
const WebSocket = require('ws');
const APP = 'http://127.0.0.1:30090';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[v]', ...a);

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
const evalJS = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || '').slice(0, 250)); return r.result?.value; };
const nav = async (url) => { await send('Page.navigate', { url }); await sleep(2600); };
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });

// 清场 + 建带日期任务(根 + 子,截止设为今天稍晚)
await nav(`${APP}/tasks`);
await evalJS(`(async () => {
  await (async () => { if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); if (window.caches) for (const k of await caches.keys()) await caches.delete(k); })();
  await indexedDB.databases().then(dbs => Promise.all(dbs.filter(d => d.name && d.name.startsWith('cortex:')).map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = r; }))));
  return 1;
})()`);
await nav(`${APP}/tasks`);
await sleep(900);
await evalJS(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const setInput = (el, v) => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  for (const name of ['G父', '无日期任务']) {
    [...document.querySelectorAll('button')].find(b => b.textContent.includes('新任务')).click();
    await sleep(160);
    const edit = [...document.querySelectorAll('input')].filter(i => i.offsetParent !== null && i.closest('[data-row]'))[0];
    setInput(edit, name);
    edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(220);
  }
  return 'seeded';
})()`);
// 给 G父 设今天稍晚的截止:经"编辑详情"抽屉(TaskSheet 里的 datetime-local)
await evalJS(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const row = [...document.querySelectorAll('[data-row]')].find(r => r.textContent.includes('G父'));
  row?.click();
  await sleep(500);
  const insp = document.querySelector('[data-inspector]');
  if (!insp) return 'NO-INSPECTOR';
  [...insp.querySelectorAll('button')].find(b => b.textContent.includes('编辑详情'))?.click();
  await sleep(700);
  const card = [...document.body.querySelectorAll('[data-state="open"]')][0];
  if (!card) return 'NO-CARD';
  // 时间字段现在是「—」按钮,点一下才出现原生输入(R11 起)
  const lbl = [...card.querySelectorAll('span')].find(x => x.textContent.trim() === '截止时间');
  const fbtn = lbl ? lbl.parentElement.querySelector('button') : null;
  if (!fbtn) return 'NO-FIELD-BTN';
  fbtn.click();
  await sleep(200);
  const dt = [...card.querySelectorAll('input')].find(i => i.type === 'datetime-local' && i.offsetParent !== null);
  if (!dt) return 'NO-DT-INPUT';
  const d = new Date(Date.now() + 3 * 3600e3);
  const pad = n => String(n).padStart(2, '0');
  const val = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(dt, val); dt.dispatchEvent(new Event('input', { bubbles: true }));
  dt.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(400);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(300);
  return 'dated';
})()`);

// ① 日视图 ⏰ 标记
await nav(`${APP}/tasks?view=timeline`);
await sleep(1200);
const dueInDay = await evalJS(`!![...document.querySelectorAll('[title^="截止:"]')].length`);
log('① 日视图显示到期任务(G父):', dueInDay ? '✓' : '✗');
// 周视图
await evalJS(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '周')?.click(); 'week'`);
await sleep(800);
const dueInWeek = await evalJS(`!![...document.querySelectorAll('button')].some(b => (b.title || '').includes('截止') && b.textContent.includes('G父'))`);
log('① 周视图 ⏰ 块(G父):', dueInWeek ? '✓' : '✗');
// 矩阵含子任务
await nav(`${APP}/tasks?view=matrix`);
await sleep(1000);
const matrixRoot = await evalJS(`document.body.textContent.includes('G父')`);
const matrixNoDate = await evalJS(`document.body.textContent.includes('无日期任务')`);
log('① 矩阵: 有日期任务', matrixRoot ? '✓' : '✗', '| 无日期任务', matrixNoDate ? '✓' : '✗');

// ② 甘特图:默认本周窗口 + 重叠过滤(G父截止+3h 在本周 → 可见;无日期任务默认隐藏,只在「未排期」坞出现)
await nav(`${APP}/tasks?view=gantt`);
await sleep(1400);
const gantt = await evalJS(`(() => {
  const bars = [...document.querySelectorAll('div[title][class*="top-1/2"]')].length;
  const fullRounded = [...document.querySelectorAll('div[title].rounded-full[class*="top-1/2"]')].length;
  const hasG = [...document.querySelectorAll('button')].some(b => b.textContent.includes('G父'));
  const tray = document.body.textContent.includes('未排期');
  const trayChip = [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '无日期任务');
  // 表头第一天是否本周周一
  const mon = new Date(); const day = (mon.getDay() + 6) % 7; mon.setDate(mon.getDate() - day);
  const firstDay = (mon.getMonth()+1) + '/' + mon.getDate();
  const headerOk = document.body.textContent.includes(firstDay);
  // 窗口天数 = 7(表头格数)
  const dayCells = [...document.querySelectorAll('.sticky.top-0 > div:nth-child(2) > div')].length;
  return { bars, fullRounded, hasG, tray, trayChip, headerOk, dayCells };
})()`);
const ganttOk = gantt.bars >= 1 && gantt.fullRounded === 0 && gantt.hasG && gantt.tray && gantt.trayChip && gantt.headerOk && gantt.dayCells === 7;
log('② 甘特(默认本周;无日期隐藏进未排期坞;圆角非全圆):', JSON.stringify(gantt), ganttOk ? '✓' : '✗');
// 切到下周 → 本周任务应消失
await evalJS(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '下周')?.click(); 'next'`);
await sleep(700);
const nextWeek = await evalJS(`(() => {
  const hasG = [...document.querySelectorAll('button')].some(b => b.textContent.includes('G父'));
  const empt = document.body.textContent.includes('没有排期任务');
  return { hasG, empt };
})()`);
log('② 切下周(本周任务应消失):', JSON.stringify(nextWeek), (!nextWeek.hasG || nextWeek.empt) ? '✓' : '✗');
// 回本周
await evalJS(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '本周')?.click(); 'back'`);
await sleep(700);

// ③ tmux 下拉数据源(从页面 fetch,验证同源可达)
const tmuxApi = await evalJS(`fetch('/api/tmux/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host: 'wuzh@172.19.0.1' }) }).then(r => r.json()).then(b => (b.sessions || []).length + ' 个')`);
log('③ tmux 会话列表接口(页面内):', tmuxApi);
ws.close();
