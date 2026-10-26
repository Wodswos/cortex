/**
 * R11 验证(甘特 + 详情):
 *  ① 拖条按「分」而不是整天(5 分钟吸附;1px ≈ 10 分钟,放大档位后更细)
 *  ② 优先级填满整条、无边框;P0 红 / P1 橙 / P2 蓝 / P3 灰
 *     (未开始 = 浅色透明;已完成 = 绿色,无角标;已逾期 = 实色,无角标)
 *  ③ 没有时间的任务不再画"子树聚合细条"(无日期父级只作分组行)
 *  ④ 同深度的名字左沿对齐(无子级的行也留折叠钮位置),子任务不会看着比父任务靠前
 *  ⑤ 任务详情:未设时间显示「—」,不出现 yyyy/mm/dd 占位;预估(分钟)字段已删除
 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('.', import.meta.url));
const WebSocket = require('ws');
const APP = 'http://127.0.0.1:30090';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[r11]', ...a);
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
ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } });
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
const dragPt = async (x0, y0, x1, y1, steps = 8) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(60);
  for (let i = 1; i <= steps; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps, button: 'left', buttons: 1 });
    await sleep(20);
  }
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(500);
};

// ---------- 清场 ----------
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
  for (const name of ['甲分', '乙聚合', '丙P0', '丁P1', '戊P2', '己P3', '辛未开始', '壬完成']) {
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

/** 打开某任务的完整详情抽屉 */
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

// ---------- ⑤ 详情:时间字段显示「—」、无 yyyy/mm/dd 占位、无预估字段 ----------
await openSheet('甲分');
const detail = await evalJS(`(() => {
  const card = [...document.body.querySelectorAll('[data-state="open"]')][0];
  if (!card) return { err: 'NO-CARD' };
  const text = card.textContent || '';
  const dashes = [...card.querySelectorAll('button')].filter(b => b.textContent.trim() === '—').length;
  const dtInputs = [...card.querySelectorAll('input[type="datetime-local"]')].filter(i => i.offsetParent !== null).length;
  const fieldText = (label) => {
    const s = [...card.querySelectorAll('span')].find(x => x.textContent.trim() === label);
    return s ? (s.parentElement.textContent || '').replace(label, '').trim() : null;
  };
  return { dashes, dtInputs, start: fieldText('开始时间'), due: fieldText('截止时间'),
           hasEstimate: text.includes('预估'), hasDurationHint: text.includes('预估') };
})()`);
check('⑤ 未设时间显示两个「—」', detail.dashes === 2, JSON.stringify(detail));
check('⑤ 无 datetime-local 占位输入框', detail.dtInputs === 0);
check('⑤ 时间字段文本就是「—」(无 yyyy/mm/dd 占位)', detail.start === '—' && detail.due === '—', `start=${JSON.stringify(detail.start)} due=${JSON.stringify(detail.due)}`);
check('⑤ 预估(分钟)字段已删除', detail.hasEstimate === false);

/** 在详情里设开始/截止/优先级(点「—」→ 原生输入 → change) */
const setDetail = async (title, { startMin, dueMin, priority }) => {
  await openSheet(title);
  const r = await evalJS(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const card = [...document.body.querySelectorAll('[data-state="open"]')][0];
    if (!card) return 'NO-CARD';
    const pad = n => String(n).padStart(2, '0');
    const local = (ms) => { const d = new Date(ms); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes()); };
    // R14 起「开始」选完会自动弹出「截止」输入:先找已可见的输入,没有再点字段的按钮
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
    if (${startMin} != null) { const s = await fillByLabel('开始时间', Date.now() + ${startMin} * 60000); if (s !== 'ok') return 'START:' + s; }
    if (${dueMin} != null) { const d = await fillByLabel('截止时间', Date.now() + ${dueMin} * 60000); if (d !== 'ok') return 'DUE:' + d; }
    if (${JSON.stringify(priority ?? null)} != null) {
      const pb = [...card.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(priority ?? '')});
      if (!pb) return 'NO-PRIORITY-BTN';
      pb.click();
      await sleep(200);
    }
    const f = (l) => { const s = [...card.querySelectorAll('span')].find(x => x.textContent.trim() === l); return s ? s.parentElement.textContent.replace(l, '').trim() : null; };
    return 'start=' + f('开始时间') + ' due=' + f('截止时间');
  })()`);
  await closeSheet();
  return r;
};
log('设时间 甲分:', await setDetail('甲分', { startMin: -90, dueMin: 270, priority: 'P2' }));
log('设时间 丙P0:', await setDetail('丙P0', { startMin: -120, dueMin: -30, priority: 'P0' }));
log('设时间 丁P1:', await setDetail('丁P1', { startMin: -120, dueMin: 60, priority: 'P1' }));
log('设时间 戊P2:', await setDetail('戊P2', { startMin: -60, dueMin: 90, priority: 'P2' }));
log('设时间 己P3:', await setDetail('己P3', { startMin: -60, dueMin: 120, priority: 'P3' }));
log('设时间 辛未开始:', await setDetail('辛未开始', { startMin: 120, dueMin: 300, priority: 'P1' }));
log('设时间 壬完成:', await setDetail('壬完成', { startMin: -60, dueMin: 60, priority: 'P2' }));
await evalJS(`(() => {
  const row = [...document.querySelectorAll('[data-row]')].find(r => r.textContent.includes('壬完成'));
  row?.querySelector('button[aria-label="完成"]')?.click();
  return 1;
})()`);
await sleep(400);

// 乙聚合:无日期父级 + 一个有日期的子任务
await openSheet('乙聚合');
await evalJS(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const card = [...document.body.querySelectorAll('[data-state="open"]')][0];
  const inp = [...card.querySelectorAll('input')].find(i => i.placeholder && i.placeholder.includes('添加子任务'));
  if (!inp) return 'NO-SUB-INPUT';
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, '乙子');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(400);
  return 'sub-added';
})()`);
await closeSheet();
log('设时间 乙子:', await setDetail('乙子', { startMin: -30, dueMin: 60 }));

// ---------- 甘特 ----------
await nav(`${APP}/tasks?view=gantt`);
await sleep(1600);

const barInfo = (name) => evalJS(`(() => {
  const el = [...document.querySelectorAll('div[title]')].find(x => (x.getAttribute('title')||'').startsWith(${JSON.stringify(name)} + ' · '));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return { x: r.x, y: r.y, w: r.width, h: r.height, title: el.getAttribute('title'),
           bg: cs.backgroundColor, cls: el.className, radius: cs.borderRadius, bw: cs.borderTopWidth };
})()`);
const nameLeft = (name) => evalJS(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(name)});
  return b ? Math.round(b.getBoundingClientRect().left) : null;
})()`);

// ② 优先级填满整条 + 调色板
const bars = {
  P0: await barInfo('丙P0'), P1: await barInfo('丁P1'), P2: await barInfo('戊P2'), P3: await barInfo('己P3'),
};
const rgb = (s) => {
  if (!s) return null;
  if (s.startsWith('color(')) { const n = (s.match(/[\d.]+/g) || []).map(Number); return [n[0] * 255, n[1] * 255, n[2] * 255, n[3] ?? 1]; }
  const n = (s.match(/[\d.]+/g) || []).map(Number);
  return [n[0], n[1], n[2], n[3] ?? 1];
};
log('② 条色:', JSON.stringify(Object.fromEntries(Object.entries(bars).map(([k, v]) => [k, v && v.bg]))));
const c = Object.fromEntries(Object.entries(bars).map(([k, v]) => [k, v ? rgb(v.bg) : null]));
const opaque = Object.values(c).every((x) => x && x[3] >= 0.99 && x[0] + x[1] + x[2] > 0);
check('② 条被优先级色填满(不透明实色)', opaque, JSON.stringify(c));
const redish = c.P0 && c.P0[0] > c.P0[1] + 40 && c.P0[0] > c.P0[2] + 40;
const orange = c.P1 && c.P1[0] > c.P1[1] && c.P1[1] > c.P1[2] + 40;
const blue = c.P2 && c.P2[2] > c.P2[0] + 40;
const gray = c.P3 && Math.abs(c.P3[0] - c.P3[1]) < 12 && Math.abs(c.P3[1] - c.P3[2]) < 12;
check('② P0 红 / P1 橙 / P2 蓝 / P3 灰', redish && orange && blue && gray,
  `red=${redish} orange=${orange} blue=${blue} gray=${gray}`);
const noRedRing = Object.values(bars).every((b) => b && !/ring-2/.test(b.cls) && !/ring-\[var\(--danger\)\]/.test(b.cls));
check('② 不再用红框表达优先级(无 ring)', noRedRing);
check('① 条圆角仍是小圆角(rounded-md)', bars.P0 && bars.P0.radius !== '9999px' && parseFloat(bars.P0.radius) <= 8, bars.P0?.radius);

// ③ 无日期父级不画聚合细条
const 乙聚合Bar = await barInfo('乙聚合');
const 乙子Bar = await barInfo('乙子');
check('③ 无时间父级「乙聚合」没有条', 乙聚合Bar === null);
check('③ 其子任务「乙子」照常有条', !!乙子Bar);

// ④ 名字左沿对齐:子任务比父任务更靠右
const lRoot = await nameLeft('乙聚合');
const lChild = await nameLeft('乙子');
check('④ 子任务名字比父任务靠右(深度缩进可见)', lRoot != null && lChild != null && lChild > lRoot + 8, `root=${lRoot} child=${lChild}`);

// 放大时间轴(2 档)再拖,验证"分"粒度
await evalJS(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.title === '时间轴放大(拖条可按 5 分钟微调)'); b.click(); b.click(); return 1; })()`);
await sleep(500);
const zoomNow = await evalJS(`[...document.querySelectorAll('span')].map(s => s.textContent).find(t => /^\\d+×$/.test(t))`);
log('① 缩放档位:', zoomNow);

/** 条锚定在「当前时刻」上,下午跑脚本时右端会滑出 1440 视口(Input.dispatchMouseEvent 打在窗外 = 无效)。
 *  拖前先把横向滚动容器滚到条完整可见。 */
const scrollBarIntoView = async (name) => {
  await evalJS(`(() => {
    const sc = [...document.querySelectorAll('div')].find(d => String(d.className).includes('overflow-auto'));
    const el = [...document.querySelectorAll('div[title]')].find(x => (x.getAttribute('title')||'').startsWith(${JSON.stringify(name)} + ' · '));
    if (!sc || !el) return 'MISS';
    const r = el.getBoundingClientRect();
    const over = r.right - (window.innerWidth - 60);
    if (over > 0) sc.scrollLeft += over + 40;
    return Math.round(sc.scrollLeft);
  })()`);
  await sleep(300);
};

// ① 拖条 = 按分钟(不是整天)
const a1 = await barInfo('甲分');
if (a1 && a1.w >= 36) {
  const parse = (title) => { const m = title.match(/(\d+)\/(\d+) (\d+):(\d+) ~ (\d+)\/(\d+) (\d+):(\d+)/); return m ? { endMin: Number(m[6]) * 1440 + Number(m[7]) * 60 + Number(m[8]) } : null; };
  await scrollBarIntoView('甲分');
  const a1s = await barInfo('甲分');
  const before = parse(a1s.title);
  await dragPt(a1s.x + a1s.w - 3, a1s.y + a1s.h / 2, a1s.x + a1s.w + 4, a1s.y + a1s.h / 2);
  const a2 = await barInfo('甲分');
  const after = a2 ? parse(a2.title) : null;
  const dMin = before && after ? after.endMin - before.endMin : null;
  log('① 拖右端 4px:', a1.title, '→', a2?.title, `Δ=${dMin} 分钟`);
  check('① 位移不是整天、且是 5 分钟的倍数', dMin != null && dMin !== 0 && dMin % 5 === 0 && dMin % 1440 !== 0, `Δ=${dMin}`);
} else {
  check('① 甲分的条够宽可拖', false, JSON.stringify(a1));
}

const planned = await barInfo('辛未开始');
const pBg = rgb(planned?.bg);
check('② 未开始 = 浅色透明、无边框(底色仍是优先级色)',
  !!planned && !/border-dashed/.test(planned?.cls) && pBg && pBg[3] > 0.1 && pBg[3] < 0.5 && pBg[0] > pBg[1] && pBg[1] > pBg[2] + 40,
  `bg=${planned?.bg} title=${planned?.title} cls=${planned?.cls}`);

const doneBar = await barInfo('壬完成');
const dBg = rgb(doneBar?.bg);
// 图标角标:完成条不放 ✓;逾期条右上角放红色「!」(R12b 恢复)
const badgeCount = await evalJS(`(() => {
  const el = [...document.querySelectorAll('div[title]')].find(x => (x.getAttribute('title')||'').startsWith('壬完成 · '));
  return el ? [...el.querySelectorAll('span')].filter(s => String(s.className).includes('right-0.5')).length : -1;
})()`);
const overdueBadge = await evalJS(`(() => {
  const el = [...document.querySelectorAll('div[title]')].find(x => (x.getAttribute('title')||'').startsWith('丙P0 · '));
  if (!el) return -1;
  const b = [...el.querySelectorAll('span')].find(s => String(s.className).includes('right-0.5'));
  if (!b) return 0;
  const st = getComputedStyle(b);
  return st.backgroundColor.includes('rgb') && b.textContent.trim() === '!' ? 1 : 0;
})()`);
check('② 已完成 = 绿色(不再是半透明优先级色)',
  !!doneBar && dBg && dBg[1] > dBg[0] + 40 && dBg[1] > dBg[2] + 40,
  `bg=${doneBar?.bg}`);
check('② 角标:完成无 ✓、逾期有红底「!」', badgeCount === 0 && overdueBadge === 1, `done=${badgeCount} overdue=${overdueBadge}`);

// 整体平移也按分钟
await scrollBarIntoView('丁P1');
const b1 = await barInfo('丁P1');
if (b1) {
  const parse = (title) => { const m = title.match(/(\d+)\/(\d+) (\d+):(\d+) ~ (\d+)\/(\d+) (\d+):(\d+)/); return m ? Number(m[6]) * 1440 + Number(m[7]) * 60 + Number(m[8]) : null; };
  const before = parse(b1.title);
  await dragPt(b1.x + b1.w / 2, b1.y + b1.h / 2, b1.x + b1.w / 2 + 3, b1.y + b1.h / 2);
  const b2 = await barInfo('丁P1');
  const after = b2 ? parse(b2.title) : null;
  const dMin = before != null && after != null ? after - before : null;
  log('① 平移 3px:', b1.title, '→', b2?.title, `Δ=${dMin} 分钟`);
  check('① 平移也按分钟(非整天)', dMin != null && dMin !== 0 && dMin % 5 === 0 && dMin % 1440 !== 0, `Δ=${dMin}`);
}

// 缩放档位存在
const zoomUI = await evalJS(`document.body.textContent.includes('1×') || document.body.textContent.includes('2×')`);
check('① 时间轴缩放档位可见', !!zoomUI);

console.log(`\n[r11] 合计 ${pass} 通过 / ${fail} 失败`);
ws.close();
