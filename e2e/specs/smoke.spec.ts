import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const password = 'fixture-password';
let sequence = 0;
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  (page as any).__pageErrors = errors;
});
test.afterEach(async ({ page }) => { expect((page as any).__pageErrors).toEqual([]); });
async function account(context: BrowserContext, label: string) {
  const invited = await context.request.post('/api/invites', { headers: { Cookie: process.env.E2E_ADMIN_COOKIE! }, data: {} });
  expect(invited.ok()).toBeTruthy();
  const { code } = await invited.json();
  const username = `${label}_${Date.now()}_${++sequence}`;
  const response = await context.request.post('/api/auth/register', { data: { username, password, inviteCode: code } });
  expect(response.ok()).toBeTruthy();
  return { ...await response.json(), username } as { id: string; username: string };
}
async function ready(page: Page) {
  await expect(page.getByRole('button', { name: /搜索或执行命令/ })).toBeVisible({ timeout: 15000 });
}
async function capture(page: Page, title: string) {
  await page.keyboard.press('n');
  const input = page.getByPlaceholder(/想到什么写什么/);
  await expect(input).toBeVisible();
  await input.fill(title);
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(page.getByText(/已收集 1 条/)).toBeVisible();
  await page.keyboard.press('Escape');
}
async function seed(page: Page, data: unknown) {
  await page.goto('/settings');
  await ready(page);
  await page.locator('input[type=file]').setInputFiles({ name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await expect(page.getByText(/已合并备份/)).toBeVisible();
}
async function exported(page: Page) {
  await page.goto('/settings');
  await ready(page);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
  const file = await (await downloading).path();
  return JSON.parse(await readFile(file!, 'utf8'));
}
async function login(page: Page, username: string) {
  await page.goto('/login');
  await page.getByPlaceholder('用户名', { exact: true }).fill(username);
  await page.getByPlaceholder('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).last().click();
  await ready(page);
}
const task = (id: string, title = id) => ({ id, title, ownerId: 'fixture', status: 'todo', priority: 'P3', important: false, urgent: false, tags: [], order: 0, createdAt: 1, updatedAt: 1 });

test('health + keyboard and native quick capture', async ({ page, request }) => {
  expect((await request.get('/healthz')).ok()).toBeTruthy();
  await page.goto('/');
  await ready(page);
  await expect(page).toHaveTitle(/Cortex/);
  await capture(page, 'keyboard capture');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('cortex:quick-capture')));
  await expect(page.getByPlaceholder(/想到什么写什么/)).toBeVisible();
});

test('first offline reload retains account and unvisited lazy views', async ({ context, page }) => {
  await account(context, 'offline');
  await page.goto('/');
  await ready(page);
  await capture(page, 'offline account task');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
  });
  await context.setOffline(true);
  await page.reload();
  await ready(page);
  await page.goto('/inbox');
  await expect(page.getByText('offline account task', { exact: true }).first()).toBeVisible();
  await page.goto('/tasks?view=mindmap');
  await expect(page.locator('.react-flow')).toBeVisible();
  await page.goto('/tasks?view=timeline');
  await expect(page.getByTestId('day-scroll')).toBeVisible();
});

test('stale account tab cannot upload its documents under a new cookie', async ({ context, page }) => {
  await context.addInitScript(() => {
    const Native = window.WebSocket;
    (window as any).__testSockets = [];
    window.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols); (window as any).__testSockets.push(this); }
    };
  });
  const a = await account(context, 'old_tab_a');
  await page.goto('/'); await ready(page);
  await capture(page, 'A private task');
  await expect.poll(() => page.evaluate(() => (window as any).__testSockets.some((ws: WebSocket) => ws.readyState === 1))).toBe(true);
  await account(context, 'new_cookie_b');
  await page.evaluate(() => (window as any).__testSockets.forEach((ws: WebSocket) => ws.close()));
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('cortex-active-user') ?? '{}').id), { timeout: 15000 }).not.toBe(a.id);
  const data = await exported(page);
  expect(data.data.tasks.some((t: any) => t.title === 'A private task')).toBe(false);
  await login(page, a.username);
  const original = await exported(page);
  expect(original.data.tasks.some((t: any) => t.title === 'A private task')).toBe(true);
});

test('anonymous tagged data migrates once across subsequent account logins', async ({ context, page }) => {
  const a = await account(context, 'migrate_a');
  const b = await account(context, 'migrate_b');
  await context.clearCookies();
  await page.goto('/'); await ready(page);
  await capture(page, 'anonymous task #migrated');
  await login(page, a.username);
  const first = await exported(page);
  expect(first.data.tasks.some((t: any) => t.title === 'anonymous task')).toBe(true);
  expect(first.data.tags.some((t: any) => t.name === 'migrated')).toBe(true);
  await page.getByRole('button', { name: '登出' }).click();
  await ready(page);
  await login(page, b.username);
  const second = await exported(page);
  expect(second.data.tasks.some((t: any) => t.title === 'anonymous task')).toBe(false);
});

test('P2 capture and search beyond the first forty tasks', async ({ page }) => {
  await page.goto('/'); await ready(page);
  await capture(page, 'P2 capture !P2');
  expect((await exported(page)).data.tasks.find((t: any) => t.title === 'P2 capture')).toMatchObject({ priority: 'P2', important: false, urgent: true });
  await seed(page, { tasks: Array.from({ length: 45 }, (_, i) => task(`task_${i}`, `search fixture ${i}`)) });
  await page.getByRole('button', { name: /搜索或执行命令/ }).click();
  await page.getByPlaceholder('搜索任务、执行命令…').fill('search fixture 44');
  await expect(page.getByRole('option', { name: 'search fixture 44' })).toBeVisible();
});

test('clicking a cross-midnight event preserves the complete interval', async ({ page }) => {
  await page.goto('/'); await ready(page);
  const start = await page.evaluate(() => { const d = new Date(); d.setHours(-1, 0, 0, 0); return d.getTime(); });
  const end = start + 3 * 3600000;
  await seed(page, { events: [{ id: 'cross_midnight', title: 'overnight', kind: 'personal', start, end, ownerId: 'fixture', completed: false, createdAt: 1, updatedAt: 1 }] });
  await page.goto('/tasks?view=timeline');
  await page.getByTestId('day-scroll').evaluate((node) => { node.scrollTop = 0; });
  await page.getByTestId('event-cross_midnight').click({ position: { x: 100, y: 10 } });
  const event = (await exported(page)).data.events.find((e: any) => e.id === 'cross_midnight');
  expect(event).toMatchObject({ start, end });
});

test('an untouched focused inspector never overwrites a remote edit', async ({ browser, context, page, baseURL }) => {
  await account(context, 'inspector');
  await seed(page, { tasks: [task('inspector_task', 'original title')] });
  await page.goto('/tasks'); await ready(page);
  await page.getByText('original title', { exact: true }).first().click();
  const title = page.getByLabel('任务标题', { exact: true });
  await expect(title).toBeVisible();
  await title.focus();
  const other = await browser.newContext({ storageState: await context.storageState(), baseURL, timezoneId: 'Asia/Shanghai' });
  try {
    const remote = await other.newPage();
    await remote.goto('/tasks'); await ready(remote);
    await remote.getByText('original title', { exact: true }).first().click();
    const edit = remote.getByLabel('任务标题', { exact: true });
    await edit.fill('remote changed title');
    await edit.press('Tab');
    await expect(title).toHaveValue('remote changed title');
    await title.press('Tab');
    await expect(edit).toHaveValue('remote changed title');
    expect((await exported(page)).data.tasks.find((t: any) => t.id === 'inspector_task').title).toBe('remote changed title');
  } finally { await other.close(); }
});
