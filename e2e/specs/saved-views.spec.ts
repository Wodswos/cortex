import { test, expect, type BrowserContext, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
const task = (id: string, patch = {}) => ({ id, title: id, parentId: null, status: 'todo', ownerId: 'fixture', order: 0, tags: [], important: false, urgent: false, createdAt: 1, updatedAt: 1, ...patch });
const shortcuts = (page: Page) => page.getByRole('navigation', { name: '快捷视图', exact: true });
const period = (page: Page) => page.getByRole('combobox', { name: '任务时间范围', exact: true });
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
async function seed(page: Page, tasks: unknown[]) {
  await page.goto('/settings');
  await page.locator('input[type=file]').setInputFiles({ name: 'views.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ tasks })) });
  await expect(page.getByText(/已合并备份/)).toBeVisible();
}
async function menu(page: Page, name: string) {
  await shortcuts(page).getByRole('link', { name, exact: true }).hover();
  await page.getByRole('button', { name: `快捷视图 ${name} 菜单`, exact: true }).click();
}

test('calendar replaces the timeline view and legacy route, retains monthly pagination, and relative shortcuts follow the current month', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-03T12:00:00+08:00'));
  await page.goto('/calendar');
  await expect(page).toHaveURL(/\/tasks\?.*scope=month/);
  await expect(tab(page, '日历')).toHaveAttribute('data-state', 'active');
  await expect(tab(page, '时间线')).toHaveCount(0);
  await expect(page.getByTestId('calendar-month')).toBeVisible();
  await shortcuts(page).getByRole('link', { name: '本月日历', exact: true }).click();
  await expect(page.getByRole('heading', { name: '本月日历', exact: true })).toBeVisible();
  await expect(page.getByLabel('区间开始日期', { exact: true })).toHaveValue('2026-11-01');
  await page.getByRole('button', { name: '下一个时间段', exact: true }).click();
  await expect(page.getByLabel('区间开始日期', { exact: true })).toHaveValue('2026-12-01');
  await expect(page.getByLabel('区间结束日期', { exact: true })).toHaveValue('2026-12-31');
  await expect(page.getByTestId('calendar-month')).toBeVisible();
  await page.getByRole('button', { name: '上一个时间段', exact: true }).click();
  await expect(page.getByLabel('区间结束日期', { exact: true })).toHaveValue('2026-11-30');
  await period(page).selectOption('today');
  await expect(page.getByTestId('day-scroll')).toBeVisible();
  await period(page).selectOption('week');
  await expect(page.locator('[data-calendar-week-date]')).toHaveCount(7);
  await page.clock.setFixedTime(new Date('2026-12-03T12:00:00+08:00'));
  await shortcuts(page).getByRole('link', { name: '本月日历', exact: true }).click();
  await expect(period(page)).toHaveValue('month');
  await expect(page.getByLabel('区间开始日期', { exact: true })).toHaveValue('2026-12-01');
  await expect(page.getByLabel('区间结束日期', { exact: true })).toHaveValue('2026-12-31');
  await page.goto('/tasks?view=calendar&scope=month');
  await expect(tab(page, '日历')).toHaveAttribute('data-state', 'active');
});

test('saved workspaces support global matrix, weekly Gantt, editing, reset-on-open, sorting, removal and reload', async ({ page }) => {
  await seed(page, [task('a', { kind: 'node', project: true }), task('b', { kind: 'node', project: true }), task('a_action', { parentId: 'a' }), task('b_action', { parentId: 'b' })]);
  await page.getByRole('button', { name: '添加快捷视图', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '保存快捷视图', exact: true });
  await dialog.getByRole('button', { name: '保存快捷视图', exact: true }).click();
  await expect(tab(page, '四象限')).toHaveAttribute('data-state', 'active');
  await expect(period(page)).toHaveValue('all');
  for (const name of ['a_action', 'b_action']) await expect(page.getByText(name, { exact: true })).toBeVisible();
  await expect(shortcuts(page).getByRole('link', { name: '全局四象限', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('navigation', { name: '工作导航', exact: true }).getByRole('link', { name: '当前任务', exact: true })).not.toHaveAttribute('aria-current', 'page');
  await page.getByRole('navigation', { name: '工作导航', exact: true }).getByRole('link', { name: '当前任务', exact: true }).click();
  await page.getByRole('button', { name: '保存为快捷视图', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '保存快捷视图', exact: true });
  await dialog.getByLabel('视图名称', { exact: true }).fill('本周甘特');
  await dialog.getByRole('button', { name: '保存快捷视图', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await period(page).selectOption('month');
  await shortcuts(page).getByRole('link', { name: '本周甘特', exact: true }).click();
  await expect(period(page)).toHaveValue('week');
  await expect(tab(page, '甘特图')).toHaveAttribute('data-state', 'active');
  const grip = page.getByRole('button', { name: '拖动快捷视图 全局四象限 排序', exact: true });
  await grip.focus(); await grip.press('Space');
  await expect(grip).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0))); // keyboard sensor attaches on the next task
  await grip.press('ArrowUp');
  await expect(page.getByRole('status').filter({ hasText: '移到 本月日历 位置' })).toHaveCount(1);
  await grip.press('Space');
  await expect(shortcuts(page).getByRole('link')).toHaveText(['全局四象限', '本月日历', '本周甘特']);
  await page.reload();
  await expect(shortcuts(page).getByRole('link')).toHaveText(['全局四象限', '本月日历', '本周甘特']);
  await menu(page, '本周甘特');
  await page.getByRole('menuitem', { name: '编辑快捷视图', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '编辑快捷视图', exact: true });
  await dialog.getByLabel('视图名称', { exact: true }).fill('本月甘特');
  await dialog.getByLabel('默认时间范围', { exact: true }).selectOption('month');
  await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(period(page)).toHaveValue('month');
  await expect(shortcuts(page).getByRole('link', { name: '本周甘特', exact: true })).toHaveCount(0);
  await menu(page, '本月甘特');
  await page.getByRole('menuitem', { name: '移除快捷视图', exact: true }).click();
  await expect(shortcuts(page).getByRole('link', { name: '本月甘特', exact: true })).toHaveCount(0);
  await shortcuts(page).getByRole('link', { name: '全局四象限', exact: true }).click();
  for (const name of ['a_action', 'b_action']) await expect(page.getByText(name, { exact: true })).toBeVisible();
});

test('a project shortcut preserves its boundary, date interval and the project independent view preference', async ({ page }) => {
  await seed(page, [task('a', { kind: 'node', project: true }), task('b', { kind: 'node', project: true }), task('a_action', { parentId: 'a' }), task('b_action', { parentId: 'b' })]);
  await page.goto('/tasks?project=a&view=list');
  await page.getByRole('button', { name: '保存为快捷视图', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '保存快捷视图', exact: true });
  await dialog.getByLabel('视图名称', { exact: true }).fill('A 导图');
  await dialog.getByLabel('展示方式', { exact: true }).selectOption('mindmap');
  await dialog.getByRole('button', { name: '保存快捷视图', exact: true }).click();
  await expect(page.locator('.react-flow__node[data-id="a_action"]')).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="b_action"]')).toHaveCount(0);
  await expect(period(page)).toHaveValue('all');
  const projects = page.getByRole('navigation', { name: '项目', exact: true });
  await expect(projects.getByRole('link', { name: 'a', exact: true })).not.toHaveAttribute('aria-current', 'page');
  await projects.getByRole('link', { name: 'b', exact: true }).click();
  await projects.getByRole('link', { name: 'a', exact: true }).click();
  await expect(tab(page, '列表')).toHaveAttribute('data-state', 'active');
  await shortcuts(page).getByRole('link', { name: 'A 导图', exact: true }).click();
  await expect(tab(page, '导图')).toHaveAttribute('data-state', 'active');
});

test('native dropdowns reserve a consistent arrow gutter and saved-view configuration fits a narrow screen', async ({ page }) => {
  await page.goto('/tasks?view=list&scope=all');
  await expect(page.getByRole('combobox', { name: '筛选任务', exact: true })).toBeVisible();
  const styles = await page.locator('select').evaluateAll((items) => items.map((item) => { const css = getComputedStyle(item); return { appearance: css.appearance, padding: parseFloat(css.paddingRight), image: css.backgroundImage }; }));
  expect(styles.length).toBeGreaterThan(1);
  for (const style of styles) { expect(style.appearance).toBe('none'); expect(style.padding).toBeGreaterThanOrEqual(32); expect(style.image).toContain('svg'); }
  await page.getByRole('button', { name: '添加快捷视图', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '保存快捷视图', exact: true });
  await dialog.getByLabel('默认时间范围', { exact: true }).selectOption('custom');
  await expect(dialog).toHaveCSS('opacity', '1');
  await page.screenshot({ path: '../.preview.local/saved-views-desktop.png' });
  await page.setViewportSize({ width: 320, height: 640 });
  await dialog.getByRole('button', { name: '保存快捷视图', exact: true }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole('button', { name: '保存快捷视图', exact: true })).toBeInViewport();
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../.preview.local/saved-views-mobile.png' });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  await expect(shortcuts(page).getByRole('link')).toHaveCount(1); // cancelling writes no preset
});

async function account(context: BrowserContext, prefix: string) {
  const response = await context.request.post('/api/invites', { headers: { Cookie: process.env.E2E_ADMIN_COOKIE! }, data: {} });
  expect(response.ok()).toBe(true);
  const { code } = await response.json();
  const username = `${prefix}_${Date.now()}`;
  expect((await context.request.post('/api/auth/register', { data: { username, password: 'fixture-password', inviteCode: code } })).ok()).toBe(true);
  return username;
}
test('shortcut configuration syncs between devices and remains isolated from another account', async ({ page, context, browser, baseURL }) => {
  const username = await account(context, 'views_a');
  await page.goto('/tasks');
  await page.getByRole('button', { name: '添加快捷视图', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '保存快捷视图', exact: true });
  await dialog.getByLabel('视图名称', { exact: true }).fill('Private matrix');
  await dialog.getByRole('button', { name: '保存快捷视图', exact: true }).click();
  const peer = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  const outsider = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  try {
    expect((await peer.request.post('/api/auth/login', { data: { username, password: 'fixture-password' } })).ok()).toBe(true);
    const second = await peer.newPage(); await second.goto('/tasks');
    await expect(shortcuts(second).getByRole('link', { name: 'Private matrix', exact: true })).toBeVisible({ timeout: 15000 });
    await account(outsider, 'views_b');
    const third = await outsider.newPage(); await third.goto('/tasks');
    await expect(shortcuts(third).getByRole('link', { name: '本月日历', exact: true })).toBeVisible();
    await expect(shortcuts(third).getByRole('link', { name: 'Private matrix', exact: true })).toHaveCount(0);
  } finally { await peer.close(); await outsider.close(); }
});
