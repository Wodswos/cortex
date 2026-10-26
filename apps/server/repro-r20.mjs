/**
 * R20 验证(tmux 终端复制/粘贴):
 *  ① 拖选 + Ctrl+Shift+C → 系统剪贴板拿到终端内容,底部提示行闪「已复制」
 *  ② 重新选区后右键 → 复制(原生菜单不弹)
 *  ③ 无选区右键点在文字上 → rightClickSelectsWord 选中单词并复制
 *  ④ OSC 52:注入伪远端帧验证 xterm→处理器→剪贴板链路(宿主 tmux 3.2a external 实测不转发)
 *  ⑤ Ctrl+Shift+V 粘贴:剪贴板命令进 pane 并执行(远端落文件)
 *  ⑥ tmux 鼠标模式:Shift+拖拽强制浏览器本地选区 → Ctrl+Shift+C 复制成功
 * 全程只用自建测试会话 r20test,不动真实会话(跑前后在宿主机侧比对会话清单)。
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(new URL('.', import.meta.url));
const WebSocket = require('ws');
const CDP = 'http://127.0.0.1:9222';
const APP = 'http://127.0.0.1:30090';
const HOST = 'wuzh@172.19.0.1';
const SESS = 'r20test';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[r20]', ...a);
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`); };
const hostSSH = (cmd) => { try { return execSync(`docker exec cortex ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no ${HOST} ${JSON.stringify(cmd)}`, { encoding: 'utf8' }).trim(); } catch (e) { return `ERR:${(e.stdout || e.stderr || e.message).toString().trim().slice(0, 80)}`; } };

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
const waitFor = async (expr, timeout = 10000, every = 400) => {
  for (const dead = Date.now() + timeout; ; ) {
    const v = await evalJS(expr);
    if (v) return v;
    if (Date.now() > dead) return null;
    await sleep(every);
  }
};

// headless-shell 不实现剪贴板权限授权(grantPermissions 无效),在页面里打桩:
// 组件运行时访问的就是 navigator.clipboard 同一实例 → 完整验证「选区→处理器→剪贴板调用」链路,
// 只桩掉浏览器侧真实剪贴板存储(环境限制,非被测代码)。导航换文档后需重打。
const patchClipboard = () => evalJS(`(() => {
  window.__clip = window.__clip ?? '';
  navigator.clipboard.writeText = (t) => { window.__clip = String(t); return Promise.resolve(); };
  navigator.clipboard.readText = () => Promise.resolve(window.__clip);
  return 'patched';
})()`);
/** 记住 attach WS 实例(④ 注入伪远端帧用) */
const patchWebSocket = () => evalJS(`(() => {
  const NativeWS = window.WebSocket;
  window.__attachWS = null;
  window.WebSocket = class extends NativeWS {
    constructor(url, protos) {
      super(url, protos);
      if (String(url).includes('/api/tmux/attach')) window.__attachWS = this;
    }
  };
  return 'patched';
})()`);
const setClipboard = (t) => evalJS(`navigator.clipboard.writeText(${JSON.stringify(t)})`);
const readClipboard = () => evalJS(`navigator.clipboard.readText()`);

// ---------- 清场 + 设置服务器档案 ----------
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

// ---------- 自建测试会话(残留先清) ----------
const api = (path, body) => evalJS(`fetch('/api/tmux/${path}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then(r => r.json())`);
{
  const leftover = await api('windows', { host: HOST, session: SESS });
  for (const w of leftover.windows ?? []) await api('kill-window', { host: HOST, session: SESS, windowId: w.id });
  const made = await api('new-session', { host: HOST, session: SESS });
  check('前置:测试会话 r20test 就绪', made.ok === true, JSON.stringify(made));
}
hostSSH('rm -f /tmp/r20-pasted');

// ---------- 建任务关联会话 → 打开终端 ----------
await nav(`${APP}/tasks`);
await sleep(900);
await patchClipboard();
await patchWebSocket();
await evalJS(`(async () => {
  [...document.querySelectorAll('button')].find(b => b.textContent.includes('新任务')).click();
  await new Promise(r => setTimeout(r, 180));
  const edit = [...document.querySelectorAll('input')].filter(i => i.offsetParent !== null && i.closest('[data-row]'))[0];
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(edit, 'R20复制任务');
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
await waitFor(`(() => {
  const sel = [...document.querySelectorAll('[data-inspector] select')].find(x => [...x.options].some(o => o.value === '__new__'));
  if (!sel || ![...sel.options].some(o => o.value === ${JSON.stringify(SESS)})) return false;
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(sel, ${JSON.stringify(SESS)});
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`, 12000);
await evalJS(`[...document.querySelectorAll('[data-inspector] button')].find(b => b.textContent.includes('关联'))?.click(); 1`);
await sleep(400);
const chipPos = await evalJS(`(() => { const b = [...document.querySelectorAll('[data-inspector] button')].find(x => x.textContent.includes(${JSON.stringify(SESS)})); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
await clickPt(chipPos.x, chipPos.y);
const connected = await waitFor(`!![...document.querySelectorAll('.fixed.inset-0 span')].find(s => s.textContent.trim() === '已连接')`, 20000);
check('前置:终端弹窗连接成功', !!connected);

// ---------- 键盘/鼠标工具 ----------
const typeLine = async (s) => {
  for (const ch of s) {
    const code = /[a-z]/i.test(ch) ? `Key${ch.toUpperCase()}` : /\d/.test(ch) ? `Digit${ch}` : ch === ' ' ? 'Space' : ch === '-' ? 'Minus' : undefined;
    const down = { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch };
    if (code) down.code = code;
    await send('Input.dispatchKeyEvent', down);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, ...(code ? { code } : {}) });
    await sleep(15);
  }
};
const pressEnter = async () => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
};
const ctrlShift = async (key, code) => {
  // modifiers: Ctrl=2 | Shift=8
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers: 10 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers: 10 });
};
/** 终端屏幕区 rect(.xterm 容器) */
const termRect = () => evalJS(`(() => {
  const modal = document.querySelector('.fixed.inset-0');
  const xt = modal?.querySelector('.xterm');
  if (!xt) return null;
  const r = xt.getBoundingClientRect();
  return { l: Math.round(r.left), t: Math.round(r.top), rgt: Math.round(r.right), b: Math.round(r.bottom) };
})()`);
/** 从屏幕区顶部拖到底部 = 全选(可选 Shift 修饰强制本地选区) */
const dragSelectAll = async (modifiers = 0) => {
  const r = await termRect();
  const x1 = r.l + 30, y1 = r.t + 12, x2 = r.rgt - 12, y2 = r.b - 12;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', buttons: 1, clickCount: 1, modifiers });
  for (let i = 1; i <= 6; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + ((x2 - x1) * i) / 6, y: y1 + ((y2 - y1) * i) / 6, button: 'left', buttons: 1, modifiers });
    await sleep(30);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', buttons: 0, clickCount: 1, modifiers });
  await sleep(250);
};
const rightClickPt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
};
const footerText = () => evalJS(`(() => { const modal = document.querySelector('.fixed.inset-0'); const rows = [...modal.querySelectorAll('div')].filter(d => d.className.includes('border-t')); return rows.at(-1)?.textContent ?? ''; })()`);

await sleep(2200); // 等连接初期可能的重连落定
// 宿主机 tmux 全局配置 mouse on(新会话继承)→ 浏览器拖选会被转发给 tmux。
// ①–⑤ 在 mouse off 下测(本测试会话自己的选项),⑥ 再显式开回 on 测真实场景。
await typeLine('tmux set mouse off');
await pressEnter();
await sleep(500);
// 打一行标记内容供建选区
await typeLine('echo r20-hello-COPY');
await pressEnter();
await sleep(900);

// ---------- ① 拖选 + Ctrl+Shift+C ----------
await setClipboard('SENTINEL');
await dragSelectAll();
await ctrlShift('c', 'KeyC');
await sleep(400);
let clip = await readClipboard();
check('① 拖选 + Ctrl+Shift+C → 剪贴板含终端内容', typeof clip === 'string' && clip.includes('r20-hello-COPY'), JSON.stringify(String(clip).slice(0, 60)));
const footer = await footerText();
check('① 底部提示行闪「已复制」', footer.includes('已复制'), footer.slice(-60));

// ---------- ② 选区后右键 = 复制(原生菜单不弹) ----------
await setClipboard('SENTINEL');
await dragSelectAll();
const r2 = await termRect();
await rightClickPt(r2.l + 100, r2.t + 60);
await sleep(400);
clip = await readClipboard();
check('② 重新选区后右键 → 复制', clip !== 'SENTINEL' && clip.includes('r20-hello-COPY'), JSON.stringify(String(clip).slice(0, 60)));

// ---------- ③ 无选区右键点在文字上 → 选中单词并复制 ----------
// 坐标必须真落在文字格上:tmux pane 行列反算(猜 dy 会点进空行,曾致假失败)
{
  const geom = hostSSH(`tmux display -pt ${SESS} '#{pane_width} #{pane_height}'`).split(/\s+/).map(Number);
  const lines = hostSSH(`tmux capture-pane -pt ${SESS} -S -12`).split('\n');
  const tr3 = await termRect();
  const cellW = (tr3.rgt - tr3.l) / geom[0], cellH = (tr3.b - tr3.t) / geom[1];
  let idx = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].trim()) { idx = i; break; }
  const screenRow = geom[1] - (lines.length - 1 - idx); // 屏幕自顶第几行(1 基)
  const wx = Math.round(tr3.l + 6 * cellW);
  // 行中心 = b - (rows - screenRow + 0.5) * cellH;写成 +cellH/2 会把末行点到终端下方页脚上(曾致假失败)
  const wy = Math.round(tr3.b - (geom[1] - screenRow + 0.5) * cellH);
  await clickPt(tr3.l + 60, tr3.t + 20, 40); // 先单击清选区
  await sleep(200);
  await setClipboard('SENTINEL');
  await rightClickPt(wx, wy);
  await sleep(350);
  clip = await readClipboard();
  check('③ 无选区右键点在文字上 → 复制单词', clip !== 'SENTINEL' && clip.length > 0 && !clip.includes('\n'), `(${wx},${wy}) ${JSON.stringify(String(clip).slice(0, 40))}`);
}

// ---------- ④ OSC 52(注入帧验证我们这端的链路) ----------
// 实测宿主 tmux 3.2a:set-clipboard=external + terminfo 无 Ms → 应用发的 OSC52 不转发。
// 把一帧伪远端输出注入 attach WS,验证 xterm 解析 → OSC52 处理器 → 剪贴板 全链路;
// 真实环境端到端触发需服务端 tmux 配 set-clipboard on / terminfo Ms(terminal-features clipboard)。
{
  await setClipboard('SENTINEL');
  const b64 = Buffer.from('r20osc52').toString('base64');
  await evalJS(`(() => {
    const ws = window.__attachWS;
    if (!ws) return 'NO-WS';
    ws.dispatchEvent(new MessageEvent('message', { data: '\\x1b]52;c;${b64}\\x1b\\\\' }));
    return 'sent';
  })()`);
  await sleep(400);
  clip = await readClipboard();
  check('④ 注入 OSC52 帧 → 处理器写剪贴板', clip === 'r20osc52', JSON.stringify(String(clip).slice(0, 40)));
}

// ---------- ⑤ Ctrl+Shift+V 粘贴执行 ----------
await clickPt(r2.l + Math.round((r2.rgt - r2.l) / 2), r2.b - 30, 40); // 终端聚焦
await setClipboard('touch /tmp/r20-pasted');
await ctrlShift('v', 'KeyV');
await sleep(500);
await pressEnter();
await sleep(700);
const pasted = hostSSH('test -f /tmp/r20-pasted && echo YES');
check('⑤ Ctrl+Shift+V 粘贴命令 → pane 执行(远端落文件)', pasted === 'YES', pasted);

// ---------- ⑥ tmux 鼠标模式(用户真实环境):Shift 拖选强制本地选区 ----------
await typeLine('tmux set mouse on');
await pressEnter();
await sleep(600);
await setClipboard('SENTINEL');
await dragSelectAll(); // 不带 Shift:事件被转发给 tmux,浏览器不产生选区
await ctrlShift('c', 'KeyC');
await sleep(400);
clip = await readClipboard();
check('⑥ 鼠标模式:普通拖选不产生浏览器复制(事件已转发 tmux)', clip === 'SENTINEL', JSON.stringify(String(clip).slice(0, 50)));
await setClipboard('SENTINEL');
await dragSelectAll(8); // Shift 修饰 = xterm 强制本地选区
await ctrlShift('c', 'KeyC');
await sleep(400);
clip = await readClipboard();
check('⑥ 鼠标模式 Shift+拖选 → 复制成功', clip !== 'SENTINEL' && clip.includes('r20-hello-COPY'), JSON.stringify(String(clip).slice(0, 50)));
await typeLine('tmux set mouse off');
await pressEnter();
await sleep(400);

// ---------- 清场:杀掉自建会话 ----------
{
  const leftover = await api('windows', { host: HOST, session: SESS });
  for (const w of leftover.windows ?? []) await api('kill-window', { host: HOST, session: SESS, windowId: w.id });
  hostSSH('rm -f /tmp/r20-pasted');
  const gone = await api('windows', { host: HOST, session: SESS });
  check('清场:r20test 已结束', !gone.windows || gone.windows.length === 0, JSON.stringify(gone).slice(0, 60));
}

log(`结果: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
