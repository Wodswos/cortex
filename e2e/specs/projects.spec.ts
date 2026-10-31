import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const task = (id: string, title = id, patch: Record<string, unknown> = {}) => ({
  id, title, status: 'todo', parentId: null, order: 0, ownerId: 'fixture', tags: [],
  important: false, urgent: false, priority: 'P3', createdAt: 1, updatedAt: 1, ...patch,
});
async function seed(page: Page, data: unknown) {
  await page.goto('/settings');
  await page.locator('input[type=file]').setInputFiles({
    name: 'projects.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)),
  });
  await expect(page.getByText(/已合并备份/)).toBeVisible();
}
async function exported(page: Page) {
  await page.locator('a[href="/settings"]').first().click();
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
  const path = await (await waiting).path();
  return JSON.parse(await readFile(path!, 'utf8')).data;
}
const projectNav = (page: Page) => page.getByRole('navigation', { name: '项目', exact: true });
const views = (page: Page) => page.getByRole('tablist', { name: '任务视图', exact: true });

test('project creation confirms once, preserves Chinese composition, opens an empty root and supports rename and archive undo', async ({ page, browserName }) => {
  await page.goto('/tasks');
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '新建项目', exact: true });
  await dialog.getByRole('textbox', { name: '项目名称', exact: true }).fill('cancelled project');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(projectNav(page).getByRole('link')).toHaveCount(0);
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '新建项目', exact: true });
  const name = dialog.getByRole('textbox', { name: '项目名称', exact: true });
  if (browserName === 'chromium') {
    await name.focus();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: 'xiangmu', selectionStart: 7, selectionEnd: 7 });
    await name.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 });
    await expect(dialog).toBeVisible();
    await expect(projectNav(page).getByRole('link')).toHaveCount(0);
    await cdp.send('Input.insertText', { text: '体验改版' });
    await cdp.detach();
  } else await name.fill('体验改版');
  await dialog.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '体验改版', exact: true })).toBeVisible();
  await expect(page.locator('[data-row]')).toHaveCount(0);
  await expect(projectNav(page).getByRole('link', { name: '体验改版', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '添加任务', exact: true }).fill('first project action');
  await page.getByRole('textbox', { name: '添加任务', exact: true }).press('Enter');
  await expect(page.getByRole('status', { name: '保存状态', exact: true })).toHaveText('已保存');
  await expect(page.locator('[data-row]')).toHaveCount(1);
  await expect(page.getByLabel('项目进度', { exact: true })).toHaveText('0/1');
  await page.getByRole('button', { name: '编辑项目 体验改版', exact: true }).click();
  await expect(page.getByText('项目根节点', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'TODO 任务', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: '任务标题', exact: true }).fill('体验改版二期');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: '体验改版二期', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '项目菜单', exact: true }).click();
  await page.getByRole('button', { name: '归档项目', exact: true }).click();
  await expect(projectNav(page).getByRole('link')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('heading', { name: '体验改版二期', exact: true })).toBeVisible();
  const data = await exported(page);
  const root = data.tasks.find((value: any) => value.title === '体验改版二期');
  expect(root).toMatchObject({ project: true, kind: 'node', parentId: null, status: 'todo' });
  expect(data.tasks).toHaveLength(2);
  expect(data.tasks.find((value: any) => value.title === 'first project action').parentId).toBe(root.id);
});

test('project views remember each project after navigation and reload, and keep the ordered selector beside a fixed title', async ({ page }) => {
  const longTitle = 'Project A with a title much longer than the title slot allows';
  await seed(page, { tasks: [task('a', longTitle, { kind: 'node' }), task('b', 'Project B', { kind: 'node' })] });
  await page.goto('/tasks?project=a');
  await expect(views(page).getByRole('tab')).toHaveText(['列表', '导图', '四象限', '甘特图', '时间线']);
  const title = page.getByRole('heading', { name: longTitle, exact: true });
  const selector = (await views(page).boundingBox())!;
  const titleBox = (await title.boundingBox())!;
  expect(titleBox.width).toBeLessThanOrEqual(160);
  expect(selector.x - titleBox.x).toBeLessThan(200);
  await views(page).getByRole('tab', { name: '导图', exact: true }).click();
  await projectNav(page).getByRole('link', { name: 'Project B', exact: true }).click();
  // An unvisited project always starts in list, independently of other projects' views.
  await expect(views(page).getByRole('tab', { name: '列表', exact: true })).toHaveAttribute('data-state', 'active');
  await views(page).getByRole('tab', { name: '四象限', exact: true }).click();
  await projectNav(page).getByRole('link', { name: longTitle, exact: true }).click();
  await expect(views(page).getByRole('tab', { name: '导图', exact: true })).toHaveAttribute('data-state', 'active');
  await page.reload();
  await expect(views(page).getByRole('tab', { name: '导图', exact: true })).toHaveAttribute('data-state', 'active');
  await projectNav(page).getByRole('link', { name: 'Project B', exact: true }).click();
  await expect(views(page).getByRole('tab', { name: '四象限', exact: true })).toHaveAttribute('data-state', 'active');
  expect((await views(page).boundingBox())!.x).toBeCloseTo(selector.x, 0);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ['列表', '导图', '四象限', '甘特图', '时间线']) await expect(views(page).getByRole('tab', { name, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('all five project views stay in their project, show full task branches by default, and start time views in this week', async ({ page }) => {
  const now = await page.evaluate(() => { const value = new Date(); value.setHours(10, 0, 0, 0); return value.getTime(); });
  await seed(page, { settings: { weekStartsOn: 0 }, tasks: [
    task('scope_a', 'Scope A', { kind: 'node' }), task('scope_b', 'Scope B', { kind: 'node', project: true }),
    task('a_group', 'A phase', { parentId: 'scope_a', kind: 'node', project: false }),
    task('a_doing', 'A current action', { parentId: 'a_group', status: 'doing', dueAt: now + 6 * 3600000 }),
    task('a_future', 'A future action', { parentId: 'scope_a', dueAt: now + 30 * 86400000 }),
    task('a_unplanned', 'A important action', { parentId: 'scope_a', priority: 'P1', important: true }),
    task('a_done', 'A finished action', { parentId: 'scope_a', status: 'done', dueAt: now - 10 * 86400000 }),
    task('b_action', 'B foreign action', { parentId: 'scope_b', dueAt: now + 6 * 3600000 }),
  ], events: [
    { id: 'a_event', taskId: 'a_doing', title: 'A linked meeting', start: now, end: now + 3600000, kind: 'meeting', ownerId: 'fixture', createdAt: 1, updatedAt: 1 },
    { id: 'b_event', taskId: 'b_action', title: 'B linked meeting', start: now, end: now + 3600000, kind: 'meeting', ownerId: 'fixture', createdAt: 1, updatedAt: 1 },
    { id: 'personal', taskId: null, title: 'Unrelated personal meeting', start: now, end: now + 3600000, kind: 'personal', ownerId: 'fixture', createdAt: 1, updatedAt: 1 },
  ] });
  await page.goto('/tasks?project=scope_a');
  await expect(page.locator('[data-row][data-task-id="scope_a"]')).toHaveCount(0);
  for (const name of ['A future action', 'A important action', 'A finished action']) await expect(page.locator('[data-row]').getByText(name, { exact: true })).toBeVisible();
  await expect(page.getByText('B foreign action', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('项目进度', { exact: true })).toHaveText('1/4');
  await views(page).getByRole('tab', { name: '导图', exact: true }).click();
  await expect(page.getByRole('region', { name: '工作概览', exact: true }).getByRole('button', { name: '全图', exact: true })).toHaveAttribute('aria-pressed', 'true');
  for (const id of ['scope_a', 'a_future', 'a_unplanned', 'a_done']) await expect(page.locator(`.react-flow__node[data-id="${id}"]`)).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="scope_b"]')).toHaveCount(0);
  await views(page).getByRole('tab', { name: '四象限', exact: true }).click();
  await expect(page.getByText('A future action', { exact: true })).toBeVisible();
  await expect(page.getByText('A important action', { exact: true })).toBeVisible();
  await expect(page.getByText('B foreign action', { exact: true })).toHaveCount(0);
  await views(page).getByRole('tab', { name: '甘特图', exact: true }).click();
  const weekStart = await page.evaluate(() => { const date = new Date(); date.setDate(date.getDate() - date.getDay()); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; });
  await expect(page.locator('input[type="date"]').first()).toHaveValue(weekStart);
  await expect(page.getByRole('button', { name: 'A current action', exact: true })).toBeVisible();
  await expect(page.getByText('B foreign action', { exact: true })).toHaveCount(0);
  await expect(page.getByText('A future action', { exact: true })).toHaveCount(0);
  // The root is represented by the page heading, not duplicated as a Gantt row.
  await expect(page.getByText('Scope A', { exact: true })).toHaveCount(2); // sidebar + heading
  await views(page).getByRole('tab', { name: '时间线', exact: true }).click();
  await expect(page.getByRole('tab', { name: '周', exact: true })).toHaveAttribute('data-state', 'active');
  await expect(page.locator('[data-calendar-week-date]').first()).toHaveAttribute('data-calendar-week-date', weekStart);
  await expect(page.getByText('A linked meeting', { exact: true })).toBeVisible();
  for (const name of ['B foreign action', 'B linked meeting', 'Unrelated personal meeting']) await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  await page.locator('[data-calendar-week-date]').first().click({ position: { x: 20, y: 40 } });
  const draft = page.getByRole('dialog', { name: '新建日历任务', exact: true });
  await expect(draft.getByLabel('新任务所属项目', { exact: true })).toHaveValue('scope_a');
  await draft.getByRole('button', { name: '取消', exact: true }).click();
});

async function register(context: BrowserContext, label: string) {
  const invite = await context.request.post('/api/invites', { headers: { Cookie: process.env.E2E_ADMIN_COOKIE! }, data: {} });
  expect(invite.ok()).toBe(true);
  const { code } = await invite.json();
  const username = `project_${label}_${Date.now()}`;
  const response = await context.request.post('/api/auth/register', { data: { username, password: 'fixture-password', inviteCode: code } });
  expect(response.ok()).toBe(true);
  return username;
}

test('project view preferences survive reload and never leak between accounts using the same project ID', async ({ page, context }) => {
  const a = await register(context, 'a');
  await seed(page, { tasks: [task('shared_id', 'Same project', { kind: 'node' })] });
  await page.goto('/tasks?project=shared_id&view=mindmap');
  await expect(views(page).getByRole('tab', { name: '导图', exact: true })).toHaveAttribute('data-state', 'active');
  await context.request.post('/api/auth/logout', { data: {} });
  await register(context, 'b');
  await seed(page, { tasks: [task('shared_id', 'Same project', { kind: 'node' })] });
  await page.goto('/tasks?project=shared_id');
  await expect(views(page).getByRole('tab', { name: '列表', exact: true })).toHaveAttribute('data-state', 'active');
  await views(page).getByRole('tab', { name: '四象限', exact: true }).click();
  await context.request.post('/api/auth/logout', { data: {} });
  const response = await context.request.post('/api/auth/login', { data: { username: a, password: 'fixture-password' } });
  expect(response.ok()).toBe(true);
  await page.goto('/tasks?project=shared_id');
  await expect(views(page).getByRole('tab', { name: '导图', exact: true })).toHaveAttribute('data-state', 'active');
  await page.reload();
  await expect(views(page).getByRole('tab', { name: '导图', exact: true })).toHaveAttribute('data-state', 'active');
});
