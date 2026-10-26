/**
 * R14 验证(时间链式选择 + 导图结构节点标签化):
 *  ① 详情抽屉:点「开始」选完 → 「截止」自动弹出输入框(无需再点一下)
 *  ② 截止选完 → 两个字段都有时间(无「—」);之后「截止」已有值时再改「开始」不自动弹
 *  ③ 自动弹出的「截止」按 Esc = 关掉且保持空
 *  ④ 右栏 Inspector:同样的链式行为
 *  ⑤ 导图:结构节点 = 无边框文字标签悬在连线上方(R15 起不压线不遮线)
 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('.', import.meta.url));
const WebSocket = require('ws');
const APP = 'http://127.0.0.1:30090';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[r14]', ...a);
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`); };

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

const clickPt = async (x, y, gap = 60) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(gap);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
};
const rightClickPt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
  await sleep(50);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
  await sleep(350);
};

// ---------- 清场 + 种子 ----------
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
  for (const name of ['链测A', '链测B']) {
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
  if (card) await clickPt(Math.max(8, card.l - 140), Math.min(300, card.t + 40), 40);
  await sleep(400);
};
/** 抽屉内:字段状态(按钮在不在/输入框可不可见/字段文本) */
const sheetFields = () => evalJS(`(() => {
  const card = [...document.body.querySelectorAll('[data-state="open"]')][0];
  if (!card) return null;
  const fieldText = (label) => {
    const s = [...card.querySelectorAll('span')].find(x => x.textContent.trim() === label);
    return s ? (s.parentElement.textContent || '').replace(label, '').trim() : null;
  };
  return {
    startBtn: card.querySelectorAll('button[title="开始时间"]').length,
    dueBtn: card.querySelectorAll('button[title="截止时间"]').length,
    inputs: [...card.querySelectorAll('input[type="datetime-local"]')].filter(i => i.offsetParent !== null).length,
    start: fieldText('开始时间'), due: fieldText('截止时间'),
  };
})()`);

// ---------- ①② 抽屉:开始 → 截止自动弹出 ----------
await openSheet('链测A');
const f0 = await sheetFields();
check('种子就绪:两字段都是「—」', f0 && f0.start === '—' && f0.due === '—' && f0.inputs === 0, JSON.stringify(f0));
// 点「开始」→ 输入框出现
await evalJS(`(() => { [...document.querySelectorAll('[data-state="open"]')][0].querySelector('button[title="开始时间"]').click(); return 1; })()`);
await sleep(250);
const f1 = await sheetFields();
check('① 点「开始」出现原生输入框', f1 && f1.inputs === 1, JSON.stringify(f1));
// 选完开始(此刻截止仍空)→ 截止应自动进入编辑态
await evalJS(`(() => {
  const card = [...document.querySelectorAll('[data-state="open"]')][0];
  const pad = n => String(n).padStart(2, '0');
  const d = new Date(Date.now() + 30 * 60000);
  const local = d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
  const inp = [...card.querySelectorAll('input[type="datetime-local"]')].find(i => i.offsetParent !== null);
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, local);
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return 1;
})()`);
await sleep(900); // 等链式 effect
const f2 = await sheetFields();
check('① 选完开始 → 「截止」自动弹出输入(没再点它)', f2 && f2.inputs === 1 && f2.dueBtn === 0 && f2.startBtn === 1, JSON.stringify(f2));
check('① 开始已显示时间', f2 && f2.start != null && f2.start !== '—', f2?.start);
// 接着把截止也选了
await evalJS(`(() => {
  const card = [...document.querySelectorAll('[data-state="open"]')][0];
  const pad = n => String(n).padStart(2, '0');
  const d = new Date(Date.now() + 150 * 60000);
  const local = d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
  const inp = [...card.querySelectorAll('input[type="datetime-local"]')].find(i => i.offsetParent !== null);
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, local);
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return 1;
})()`);
await sleep(700);
const f3 = await sheetFields();
check('② 选完截止:两字段都显示时间(无「—」)', f3 && f3.start !== '—' && f3.due !== '—' && f3.inputs === 0 && f3.startBtn === 1 && f3.dueBtn === 1, JSON.stringify(f3));
// 截止已有值 → 再改开始,不应自动弹截止
await evalJS(`(() => { [...document.querySelectorAll('[data-state="open"]')][0].querySelector('button[title="开始时间"]').click(); return 1; })()`);
await sleep(250);
await evalJS(`(() => {
  const card = [...document.querySelectorAll('[data-state="open"]')][0];
  const pad = n => String(n).padStart(2, '0');
  const d = new Date(Date.now() - 90 * 60000);
  const local = d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
  const inp = [...card.querySelectorAll('input[type="datetime-local"]')].find(i => i.offsetParent !== null);
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, local);
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return 1;
})()`);
await sleep(900);
const f4 = await sheetFields();
check('② 截止已有值时改开始 → 不再自动弹截止', f4 && f4.inputs === 0 && f4.dueBtn === 1 && f4.due !== '—', JSON.stringify(f4));
await closeSheet();

// ---------- ③ Esc 关掉自动弹出的截止 ----------
await openSheet('链测B');
await evalJS(`(() => {
  const card = [...document.querySelectorAll('[data-state="open"]')][0];
  card.querySelector('button[title="开始时间"]').click();
  return 1;
})()`);
await sleep(250);
await evalJS(`(() => {
  const card = [...document.querySelectorAll('[data-state="open"]')][0];
  const pad = n => String(n).padStart(2, '0');
  const d = new Date(Date.now() + 20 * 60000);
  const local = d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
  const inp = [...card.querySelectorAll('input[type="datetime-local"]')].find(i => i.offsetParent !== null);
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, local);
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return 1;
})()`);
await sleep(900);
const e0 = await sheetFields();
check('③ Esc 前置:截止已自动弹出', e0 && e0.inputs === 1 && e0.dueBtn === 0, JSON.stringify(e0));
await evalJS(`(() => {
  const card = [...document.querySelectorAll('[data-state="open"]')][0];
  const inp = [...card.querySelectorAll('input[type="datetime-local"]')].find(i => i.offsetParent !== null);
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true }));
  return 1;
})()`);
await sleep(500);
const e1 = await sheetFields();
check('③ Esc 关掉弹出的截止(值保持空「—」)', e1 && e1.inputs === 0 && e1.dueBtn === 1 && e1.due === '—' && e1.start !== '—', JSON.stringify(e1));
await closeSheet();

// ---------- ④ 右栏 Inspector 同样的链 ----------
// 选中 链测B(docked Inspector 打开、抽屉关闭);Inspector 的字段按钮带 title
await evalJS(`(() => { [...document.querySelectorAll('[data-row]')].find(r => r.textContent.includes('链测B'))?.click(); return 1; })()`);
await sleep(700);
const i0 = await evalJS(`(() => {
  const sb = [...document.querySelectorAll('button[title="开始时间"]')].filter(b => b.offsetParent !== null && !b.closest('[data-state="open"]'));
  const db = [...document.querySelectorAll('button[title="截止时间"]')].filter(b => b.offsetParent !== null && !b.closest('[data-state="open"]'));
  const inputs = [...document.querySelectorAll('input[type="datetime-local"]')].filter(i => i.offsetParent !== null && !i.closest('[data-state="open"]'));
  return { sb: sb.length, db: db.length, inputs: inputs.length };
})()`);
check('④ Inspector 打开且字段可点', i0 && i0.sb === 1 && i0.db === 1, JSON.stringify(i0));
await evalJS(`(() => {
  const b = [...document.querySelectorAll('button[title="开始时间"]')].find(x => x.offsetParent !== null && !x.closest('[data-state="open"]'));
  b.click();
  return 1;
})()`);
await sleep(250);
await evalJS(`(() => {
  const pad = n => String(n).padStart(2, '0');
  const d = new Date(Date.now() + 45 * 60000);
  const local = d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
  const inp = [...document.querySelectorAll('input[type="datetime-local"]')].find(i => i.offsetParent !== null && !i.closest('[data-state="open"]'));
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, local);
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return 1;
})()`);
await sleep(900);
const i1 = await evalJS(`(() => {
  const db = [...document.querySelectorAll('button[title="截止时间"]')].filter(b => b.offsetParent !== null && !b.closest('[data-state="open"]'));
  const inputs = [...document.querySelectorAll('input[type="datetime-local"]')].filter(i => i.offsetParent !== null && !i.closest('[data-state="open"]'));
  return { db: db.length, inputs: inputs.length };
})()`);
check('④ Inspector:选完开始 → 截止同样自动弹出', i1 && i1.inputs === 1 && i1.db === 0, JSON.stringify(i1));
// 收尾:把 链测B 截止也填上(顺便清理编辑态)
await evalJS(`(() => {
  const pad = n => String(n).padStart(2, '0');
  const d = new Date(Date.now() + 120 * 60000);
  const local = d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
  const inp = [...document.querySelectorAll('input[type="datetime-local"]')].find(i => i.offsetParent !== null && !i.closest('[data-state="open"]'));
  if (inp) {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, local);
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return 1;
})()`);
await sleep(600);

// ---------- ⑤ 导图:结构节点 = 压线文字标签 ----------
await evalJS(`(() => { [...document.querySelectorAll('button')].find(b => b.textContent.includes('新任务')).click(); return 1; })()`);
await sleep(150);
await evalJS(`(() => {
  const edit = [...document.querySelectorAll('input')].filter(i => i.offsetParent !== null && i.closest('[data-row]'))[0];
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(edit, '结构S');
  edit.dispatchEvent(new Event('input', { bubbles: true }));
  edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return 1;
})()`);
await sleep(300);
await openSheet('结构S');
await evalJS(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const card = [...document.body.querySelectorAll('[data-state="open"]')][0];
  const inp = [...card.querySelectorAll('input')].find(i => i.placeholder && i.placeholder.includes('添加子任务'));
  if (!inp) return 'NO-SUB-INPUT';
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, '子K');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(400);
  return 'sub-added';
})()`);
await closeSheet();
{
  const pt = await evalJS(`(() => {
    const row = [...document.querySelectorAll('[data-row]')].find(r => [...r.querySelectorAll('button')].some(b => b.textContent.trim() === '结构S'));
    const r = row.getBoundingClientRect();
    return { x: Math.round(r.left + r.width * 0.5), y: Math.round(r.top + r.height / 2) };
  })()`);
  await rightClickPt(pt.x, pt.y);
  await evalJS(`(() => { [...document.querySelectorAll('button')].find(b => b.textContent.includes('转为结构节点'))?.click(); return 1; })()`);
  await sleep(500);
}
await nav(`${APP}/tasks?view=mindmap`);
await sleep(2400);
const mm = await evalJS(`(() => {
  const nodes = [...document.querySelectorAll('.react-flow__node')];
  const find = (t) => nodes.find(n => (n.textContent || '').includes(t));
  const g = find('结构S'), k = find('子K');
  const inner = (n) => n ? n.querySelector('div.group') || n.firstElementChild : null;
  const gi = inner(g), ki = inner(k);
  const title = gi ? [...gi.querySelectorAll('span')].find(s => (s.textContent || '').trim() === '结构S') : null;
  const label = title ? title.parentElement : null;
  const gs = gi ? getComputedStyle(gi) : null;
  const ks = ki ? getComputedStyle(ki) : null;
  const gr = gi ? gi.getBoundingClientRect() : null;
  const lr = label ? label.getBoundingClientRect() : null;
  const mid = gr ? gr.top + gr.height / 2 : null; // 连线锚在节点竖直中线
  return {
    gBorder: gs ? gs.borderTopWidth + ' ' + gs.borderTopStyle : null,
    gBg: gs ? gs.backgroundColor : null,
    gH: gr ? Math.round(gr.height) : null,
    gFolder: g ? !!g.querySelector('svg.lucide-folder') : null,
    gCheckbox: g ? !!g.querySelector('button[aria-label="完成"]') : null,
    labelBottom: lr ? Math.round(lr.bottom) : null, midline: mid != null ? Math.round(mid) : null,
    labelBg: label ? getComputedStyle(label).backgroundColor : null,
    kBorderW: ks ? ks.borderTopWidth : null,
    kRadius: ki ? getComputedStyle(ki).borderRadius : null,
    kCheckbox: k ? !!k.querySelector('button[aria-label="完成"]') : null,
  };
})()`);
check('⑤ 导图:结构节点无 Folder/无边框/无勾选(标签形态)',
  String(mm.gBorder).startsWith('0px') && mm.gBg === 'rgba(0, 0, 0, 0)' && mm.gFolder === false && mm.gCheckbox === false, JSON.stringify(mm));
check('⑤ 导图:标签悬在连线上方(标签底高于节点中线,且不遮线)', mm.labelBottom != null && mm.midline != null && mm.labelBottom <= mm.midline - 2, `labelBottom=${mm.labelBottom} midline=${mm.midline}`);
check('⑤ 导图:标签无底色(连线从文字下方完整穿过)', mm.labelBg === 'rgba(0, 0, 0, 0)', String(mm.labelBg));
check('⑤ 导图:子任务仍是卡片(有边框 + 勾选框)', parseFloat(mm.kBorderW) >= 1 && parseFloat(mm.kRadius) < 24 && mm.kCheckbox === true, JSON.stringify(mm));

log(`结果: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
