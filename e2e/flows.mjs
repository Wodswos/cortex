/**
 * 浏览器验证(短会话版):每个断言点用全新 context ——
 * 规避 Playwright↔headless-shell 长会话 CDP 通道劣化(每会话前几步必过、之后必挂)。
 * 断言全部走 AxTree(waitFor/isVisible);会话由服务端预注册 + cookie 注入。
 */
import { chromium } from '@playwright/test';

const BASE = process.env.DEBUG_BASE ?? 'http://localhost:30090';
const CDP = process.env.CDP_URL ?? 'http://localhost:9222';

let passed = 0;
let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  ok ? passed++ : failed++;
};

// 服务端预注册 + cookie
const username = `web_${Date.now() % 1e6}`;
const reg = await fetch(`${BASE}/api/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password: 'web12345' }),
});
if (!reg.ok) {
  console.error('✗ 无法注册(要求空库,先重置数据卷)');
  process.exit(1);
}
const cookie = (reg.headers.get('set-cookie') ?? '').split(';')[0];
const [ckName, ckValue] = cookie.split('=');
console.log(`✓ 服务端预注册 ${username}`);

const browser = await chromium.connectOverCDP(CDP);
const pageErrors = [];

/** 短会话:新 context → 断言 → 关闭 */
async function visit(path, assert, { authed = true, wait = 1500 } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (authed) await context.addCookies([{ name: ckName, value: ckValue, url: BASE }]);
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${path}: ${e.message}`));
  try {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(wait);
    return await assert(page);
  } catch (e) {
    console.log(`  [visit ${path} 异常] ${e.message.split('\n')[0]}`);
    return false;
  } finally {
    await context.close().catch(() => {});
  }
}

const waitText = (page, text, timeout = 8000) =>
  page.getByText(text).first().waitFor({ timeout }).then(() => true).catch(() => false);

// --- 每页独立短会话 ---
check('Dashboard', await visit('/', (p) => waitText(p, '今天也要支棱起来')));
check('同步状态在线', await visit('/', (p) => waitText(p, '已同步')));
check('QuickCapture 弹窗', await visit('/', async (p) => {
  await p.keyboard.press('n');
  return p.getByPlaceholder(/想到什么写什么/).waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
}, { wait: 2000 }));
check('任务·列表(空状态)', await visit('/tasks', (p) => waitText(p, '还没有任务')));
check('任务·四象限', await visit('/tasks?view=matrix', (p) => waitText(p, '立即做')));
check('任务·导图(画布)', await visit('/tasks?view=mindmap', (p) =>
  p.locator('#root').innerHTML().then((h) => h.includes('react-flow')), { wait: 3000 }));
check('任务·时间线(时刻刻度)', await visit('/tasks?view=timeline', (p) => waitText(p, '00:00')));
check('专注页', await visit('/focus', (p) => waitText(p, '开始专注')));
check('习惯页(空状态)', await visit('/habits', (p) => waitText(p, '种下第一个习惯')));
check('收集箱(空状态)', await visit('/inbox', (p) => waitText(p, '收集箱是空的')));
check('设置页(账号名)', await visit('/settings', (p) => waitText(p, username)));
check('登录页(未登录)', await visit('/login', (p) => waitText(p, 'local-first'), { authed: false }));

check('全程无 pageerror', pageErrors.length === 0);
if (pageErrors.length) console.log('pageerrors:', pageErrors.slice(0, 5));
console.log(`\n=== ${passed} passed / ${failed} failed ===`);
await browser.close();
process.exit(failed ? 1 : 0);
