/**
 * R17 验证(tmux 终端体验):
 *  ① canvas 渲染器生效(制表符自绘,分屏竖线连续对齐 —— DOM 渲染靠字形会错位成虚线)
 *  ② 分屏竖线像素级连续:最长竖向连贯段 ≥ 70% 高度(错位时 ≈ 单行高 ~3%)
 *  ③ 最大化/还原切换  ④ 新标签页按钮产出 /tmux 独立页 URL 且该页全屏渲染、无侧栏
 *  ⑤ 新建窗口:1 窗口 → 2 窗口  ⑥ 关窗口两步确认:红条警示、取消不误杀、确认才关
 *  ⑦ 最后一个窗口:警示"会话随之结束",确认后会话真的没了
 * 全程只用自建测试会话 r17test,不动真实会话。
 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('.', import.meta.url));
const WebSocket = require('ws');
const CDP = 'http://127.0.0.1:9222';
const APP = 'http://127.0.0.1:30090';
const HOST = 'wuzh@172.19.0.1';
const SESS = 'r17test';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[r17tmux]', ...a);
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

// ---------- 清场 + 设置服务器档案(密钥登录本机网关) ----------
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

// ---------- 自建测试会话(残留先清:列窗口逐个杀=会话结束) ----------
const api = (path, body) => evalJS(`fetch('/api/tmux/${path}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then(r => r.json())`);
{
  const leftover = await api('windows', { host: HOST, session: SESS });
  for (const w of leftover.windows ?? []) await api('kill-window', { host: HOST, session: SESS, windowId: w.id });
  const made = await api('new-session', { host: HOST, session: SESS });
  check('前置:测试会话 r17test 就绪', made.ok === true, JSON.stringify(made));
}

// ---------- 建任务并关联 r17test → 点 chip 打开终端 ----------
await nav(`${APP}/tasks`);
await sleep(900);
await evalJS(`(async () => {
  [...document.querySelectorAll('button')].find(b => b.textContent.includes('新任务')).click();
  await new Promise(r => setTimeout(r, 180));
  const edit = [...document.querySelectorAll('input')].filter(i => i.offsetParent !== null && i.closest('[data-row]'))[0];
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(edit, 'R17终端任务');
  edit.dispatchEvent(new Event('input', { bubbles: true }));
  edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise(r => setTimeout(r, 250));
})()`);
await evalJS(`[...document.querySelectorAll('[data-row]')][0]?.click(); 1`);
await sleep(500);
await evalJS(`(() => {
  const sel = document.querySelector('[data-inspector] select');
  const opt = [...sel.options].find(o => o.textContent.includes('本机网关'));
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(sel, opt.value);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
const picked = await waitFor(`(() => {
  const sel = [...document.querySelectorAll('[data-inspector] select')].find(x => [...x.options].some(o => o.value === '__new__'));
  if (!sel || ![...sel.options].some(o => o.value === ${JSON.stringify(SESS)})) return false;
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(sel, ${JSON.stringify(SESS)});
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`, 12000);
check('前置:任务关联 r17test', !!picked);
await evalJS(`[...document.querySelectorAll('[data-inspector] button')].find(b => b.textContent.includes('关联'))?.click(); 1`);
await sleep(400);
const chipPos = await evalJS(`(() => { const b = [...document.querySelectorAll('[data-inspector] button')].find(x => x.textContent.includes(${JSON.stringify(SESS)})); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
await clickPt(chipPos.x, chipPos.y);
const connected = await waitFor(`!![...document.querySelectorAll('.fixed.inset-0 span')].find(s => s.textContent.trim() === '已连接')`, 20000);
check('前置:点击 chip → 终端弹窗连接成功', !!connected);
await waitFor(`document.body.textContent.includes('1 窗口')`, 8000);

// ---------- ① canvas 渲染器生效 ----------
const canvasInfo = await evalJS(`(() => {
  const modal = document.querySelector('.fixed.inset-0');
  const cvs = [...modal.querySelectorAll('canvas')].filter(c => c.width > 200 && c.height > 100);
  return { count: cvs.length, w: cvs[0]?.width ?? 0, h: cvs[0]?.height ?? 0 };
})()`);
check('① canvas 渲染器生效(终端区有渲染 canvas)', canvasInfo.count >= 1, JSON.stringify(canvasInfo));

// ---------- ② 分屏竖线像素级连续(canvas 自绘制表符) ----------
// 键盘走 dispatchKeyEvent(带 text + code,debug2 验证可达 xterm→WS→ssh→tmux);
// 连接初期可能撞上 ResizeObserver 重连(发送被静默丢弃),断言不过就重试一轮
const typeLine = async (s) => {
  for (const ch of s) {
    // 可打印字符绝不带 windowsVirtualKeyCode:小写 charCode(112-123)会撞 xterm
    // 键位表的 F1-F12、'-'(45)撞 Insert,字母变转义序列;不带 keyCode 走 ev.key 回退
    const code = /[a-z]/i.test(ch) ? `Key${ch.toUpperCase()}` : /\d/.test(ch) ? `Digit${ch}` : ch === ' ' ? 'Space' : ch === '-' ? 'Minus' : undefined;
    const down = { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch };
    if (code) down.code = code;
    await send('Input.dispatchKeyEvent', down);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, ...(code ? { code } : {}) });
    await sleep(20);
  }
};
const pressEnter = async () => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
};
const splitRatio = () => evalJS(`(() => {
  const modal = document.querySelector('.fixed.inset-0');
  const cv = [...modal.querySelectorAll('canvas')].filter(c => c.width > 200 && c.height > 100)[0];
  if (!cv) return { err: 'NO-CANVAS' };
  const ctx = cv.getContext('2d');
  const { width: w, height: h } = cv;
  const img = ctx.getImageData(0, 0, w, h).data;
  const bg = [11, 11, 18]; // 主题背景 #0b0b12
  const isLine = (x, y) => { const i = (y * w + x) * 4; return Math.abs(img[i] - bg[0]) + Math.abs(img[i + 1] - bg[1]) + Math.abs(img[i + 2] - bg[2]) > 150; };
  let best = { x: -1, run: 0 };
  // 步进必须 1:canvas+customGlyphs 画的边框恰 1px 宽,步进 2 会整列采空
  for (let x = Math.floor(w * 0.35); x < w * 0.65; x += 1) {
    let run = 0, mx = 0;
    for (let y = 0; y < h; y++) { run = isLine(x, y) ? run + 1 : 0; if (run > mx) mx = run; }
    if (mx > best.run) best = { x, run: mx };
  }
  return { w, h, x: best.x, ratio: +(best.run / h).toFixed(3) };
})()`);
await sleep(2200); // 等连接初期可能的重连彻底落定
let cont = null;
for (let attempt = 1; attempt <= 3; attempt++) {
  await typeLine('tmux split-window -h');
  await pressEnter();
  await sleep(2400);
  cont = await splitRatio();
  if (!cont.err && cont.ratio >= 0.7) break;
  log(`分屏未检出(第 ${attempt} 次,${JSON.stringify(cont)}),重试`);
  await sleep(2500);
}
check('② 分屏竖线连续(最长连贯段 ≥ 70% 高)', !!cont && !cont.err && cont.ratio >= 0.7, JSON.stringify(cont));
await send('Page.captureScreenshot', { format: 'png' }).then((r) => { require('node:fs').writeFileSync('/tmp/r17-tmux-split.png', Buffer.from(r.data, 'base64')); log('分屏截图 → /tmp/r17-tmux-split.png'); });

// ---------- ③ 最大化 / 还原 ----------
const btnByTitle = (title) => evalJS(`(() => { const b = [...document.querySelectorAll('.fixed.inset-0 button')].find(x => x.title === ${JSON.stringify(title)}); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
{
  const max = await btnByTitle('最大化');
  await clickPt(max.x, max.y);
  await sleep(500);
  const maximized = await evalJS(`(() => { const box = [...document.querySelectorAll('.fixed.inset-0 > div')].find(d => d.classList.contains('glass-raised')); const r = box.getBoundingClientRect(); return { full: r.width > innerWidth - 20 && r.height > innerHeight - 20, restore: !![...document.querySelectorAll('button')].find(b => b.title === '还原窗口') }; })()`);
  check('③ 最大化铺满视口 + 按钮变还原', maximized.full && maximized.restore, JSON.stringify(maximized));
  const restore = await btnByTitle('还原窗口');
  await clickPt(restore.x, restore.y);
  await sleep(500);
  const back = await evalJS(`(() => { const box = [...document.querySelectorAll('.fixed.inset-0 > div')].find(d => d.classList.contains('glass-raised')); const r = box.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })()`);
  check('③ 还原回 85vh 弹窗', back.h < innerHeightCompat() - 20 && back.w < 1100, JSON.stringify(back));
}
function innerHeightCompat() { return 900; }

// ---------- ④ 新标签页按钮:产出 /tmux URL;独立页全屏渲染无侧栏 ----------
{
  await evalJS(`(() => { window.__openArgs = null; window.open = (url, target) => { window.__openArgs = { url, target }; return null; }; return 1; })()`);
  const ext = await btnByTitle('在新标签页打开(当前弹窗关闭,独立页里继续)');
  await clickPt(ext.x, ext.y);
  await sleep(500);
  const args = await evalJS(`window.__openArgs`);
  const okUrl = !!args && args.target === '_blank' && args.url.startsWith('/tmux?') && args.url.includes(`session=${SESS}`) && args.url.includes('server=');
  check('④ 新标签页按钮产出 /tmux?server&session URL', okUrl, JSON.stringify(args));
  const modalClosed = await evalJS(`![...document.querySelectorAll('.fixed.inset-0 span')].find(s => s.textContent.trim() === '已连接')`);
  check('④ 点击后原弹窗关闭', modalClosed);
  await nav(`${APP}${args.url}`);
  const page = await waitFor(`(() => {
    const term = document.querySelector('.xterm-screen');
    const connected = [...document.querySelectorAll('span')].some(s => s.textContent.trim() === '已连接');
    const noSidebar = !document.querySelector('nav, aside');
    const fs = document.body.getBoundingClientRect().height >= innerHeight - 2;
    return term && connected && noSidebar && fs ? { term: true, connected, noSidebar, fs } : null;
  })()`, 20000);
  check('④ /tmux 独立页:全屏终端 + 已连接 + 无侧栏', !!page, JSON.stringify(page));
}

// ---------- ⑤ 新建窗口 ----------
const clickHeaderBtn = async (label) => {
  const p = await evalJS(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().includes(${JSON.stringify(label)}) || x.title.includes(${JSON.stringify(label)})); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
  if (!p) throw new Error('按钮不存在: ' + label);
  await clickPt(p.x, p.y);
};
await clickHeaderBtn('新窗口');
const two = await waitFor(`document.body.textContent.includes('2 窗口')`, 10000);
check('⑤ 新窗口:计数变 2 窗口', !!two);

// ---------- ⑥ 关窗口两步确认 ----------
await clickHeaderBtn('关窗口');
await sleep(600);
{
  const strip = await evalJS(`(() => {
    const t = document.body.textContent;
    return { warn: t.includes('不可恢复'), cancel: t.includes('取消'), confirm: t.includes('确认关闭'), name: (t.match(/\\d+:[\\w-]+\\?/) || [])[0] ?? '' };
  })()`);
  check('⑥ 确认条出现:警示 + 当前窗口名 + 取消/确认', strip.warn && strip.cancel && strip.confirm && strip.name, JSON.stringify(strip));
  await clickHeaderBtn('取消');
  await sleep(400);
  const gone = await evalJS(`!document.body.textContent.includes('不可恢复')`);
  check('⑥ 取消 → 不误杀(计数仍 2)', gone && (await evalJS(`document.body.textContent.includes('2 窗口')`)));
  await clickHeaderBtn('关窗口');
  await sleep(500);
  await clickHeaderBtn('确认关闭');
  const one = await waitFor(`document.body.textContent.includes('1 窗口')`, 10000);
  check('⑥ 确认 → 窗口关闭(回到 1 窗口)', !!one);
}

// ---------- ⑦ 最后一个窗口:警示会话结束,确认后会话消失 ----------
await clickHeaderBtn('关窗口');
const lastWarn = await waitFor(`document.body.textContent.includes('最后一个窗口')`, 8000);
check('⑦ 最后窗口警示"会话随之结束"', !!lastWarn);
await clickHeaderBtn('确认关闭');
await waitFor(`[...document.querySelectorAll('span')].some(s => s.textContent.trim() === '已断开')`, 15000);
await sleep(1500);
{
  const list = await api('sessions', { host: HOST });
  check('⑦ 会话已消失(list-sessions 无 r17test)', !(list.sessions ?? []).includes(SESS), JSON.stringify(list.sessions ?? []).slice(0, 120));
}
log(`结果: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
