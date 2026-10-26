/**
 * 跨端闭环验证:经 WS(SyncClient,模拟另一台设备)写入任务 →
 * 浏览器(短会话)在四象限实时显示。前置:空库 + server + cortex-chrome 在跑。
 */
import { chromium } from '@playwright/test';
import { CortexStore, SyncClient } from '../packages/crdt/src/index.ts';

const BASE = process.env.DEBUG_BASE ?? 'http://localhost:30090';
const WS = BASE.replace(/^http/, 'ws') + '/api/sync';

// 1. 注册 + 设备 A(WS 客户端)写入「重要不紧急」任务
const username = `mx_${Date.now() % 1e6}`;
const reg = await fetch(`${BASE}/api/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password: 'mx123456' }),
});
const cookie = (reg.headers.get('set-cookie') ?? '').split(';')[0];
const me = await (await fetch(`${BASE}/api/auth/me`, { headers: { cookie } })).json();
console.log(`✓ 注册 ${username} (${me.id})`);

const store = new CortexStore(me.id);
const client = new SyncClient(async () => {
  const r = await fetch(`${BASE}/api/auth/ticket`, { headers: { cookie } });
  return ((await r.json()).ticket) ?? null;
}, WS);
for (const id of ['root', 'tasks', 'events', 'links', 'sessions', 'habits', 'habitLogs']) {
  client.register(id, store.docs[id]);
}
client.start();
await new Promise((r) => setTimeout(r, 800));
if (client.status !== 'online') {
  console.error('✗ 设备 A 未上线:', client.status);
  process.exit(1);
}
store.createTask({ title: '跨端闭环任务', status: 'todo', important: true, urgent: false });
await new Promise((r) => setTimeout(r, 1000));
console.log(`✓ 设备 A 经 WS 写入(状态 ${client.status})`);
client.stop();

// 2. 浏览器(设备 B,短会话)验证四象限显示
const browser = await chromium.connectOverCDP(process.env.CDP_URL ?? 'http://localhost:9222');
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1], url: BASE }]);
const page = await context.newPage();
await page.goto(`${BASE}/tasks?view=matrix`, { waitUntil: 'domcontentloaded' });
const ok = await page
  .getByText('跨端闭环任务')
  .first()
  .waitFor({ timeout: 12000 })
  .then(() => true)
  .catch(() => false);
// 计划象限(重要不紧急)文本也应同屏
const planOk = await page.getByText('计划', { exact: false }).first().isVisible().catch(() => false);
console.log(ok ? '✓ 浏览器四象限显示 WS 写入的任务(跨端闭环成立)' : '✗ 浏览器未见任务');
console.log(planOk ? '✓ 「计划」象限标题渲染' : '(象限标题不可见)');
await context.close();
await browser.close();
process.exit(ok ? 0 : 1);
