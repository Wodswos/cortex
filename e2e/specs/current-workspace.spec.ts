import { test, expect, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const task = (id: string, patch = {}) => ({ id, title: id, parentId: null, ownerId: 'fixture', status: 'todo', order: 0, tags: [], important: false, urgent: false, createdAt: 1, updatedAt: 1, ...patch });
async function seed(page: Page, data: unknown) {
  await page.goto('/settings');
  await page.locator('input[type=file]').setInputFiles({ name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await expect(page.getByText(/已合并备份/)).toBeVisible();
}
const range = (page: Page) => page.getByRole('combobox', { name: '任务时间范围', exact: true });
const dateField = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const view = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });

test('sidebar contains workspaces, project directory collapse persists and creating a project expands it', async ({ page }) => {
  await seed(page, { tasks: [task('project_a', { kind: 'node', project: true }), task('project_b', { kind: 'node', project: true })] });
  await page.goto('/');
  const navigation = page.getByRole('navigation', { name: '工作导航', exact: true });
  await expect(navigation.getByRole('link')).toHaveText(['当前任务', '收集箱']);
  await expect(page.getByRole('navigation', { name: '快捷视图', exact: true }).getByRole('link')).toHaveText(['本月日历']);
  await expect(page.getByRole('heading', { name: '当前任务', exact: true })).toBeVisible();
  await expect(view(page, '甘特图')).toHaveAttribute('data-state', 'active');
  await expect(navigation.getByRole('link', { name: '当前任务', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('navigation', { name: '视图', exact: true })).toHaveCount(0);
  const projects = page.getByRole('navigation', { name: '项目', exact: true });
  await expect(projects.getByRole('link')).toHaveCount(2);
  await page.getByRole('button', { name: '收起项目', exact: true }).click();
  await expect(projects).toBeHidden();
  await page.reload();
  await expect(page.getByRole('button', { name: '展开项目', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建项目', exact: true });
  await dialog.getByLabel('项目名称', { exact: true }).fill('new expanded project');
  await dialog.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(projects).toBeVisible();
  await expect(projects.getByRole('link', { name: 'new expanded project', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.reload();
  await expect(page.getByRole('button', { name: '收起项目', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('navigation', { name: '移动导航', exact: true }).getByRole('link')).toHaveText(['当前任务', '本月日历']);
});

test('current workspace preserves the same custom window across its five views and keeps project backlog accessible', async ({ page }) => {
  const date = (day: number) => new Date(2026, 10, day, 12).getTime();
  await seed(page, { tasks: [task('project', { kind: 'node', project: true }), task('phase', { kind: 'node', parentId: 'project' }), task('matching', { parentId: 'phase', dueAt: date(3) }), task('overlap', { parentId: 'phase', startAt: date(1), dueAt: date(8) }), task('outside', { parentId: 'project', dueAt: date(20) }), task('undated', { parentId: 'project' }), task('finished', { status: 'done', parentId: 'project', dueAt: date(3) })] });
  await page.goto('/tasks?scope=custom&from=2026-11-03&to=2026-11-05&view=list');
  const rows = page.locator('[data-row]');
  for (const name of ['project', 'phase', 'matching', 'overlap', 'finished']) await expect(rows.getByText(name, { exact: true })).toBeVisible();
  for (const name of ['outside', 'undated']) await expect(rows.getByText(name, { exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: '隐藏已完成', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '隐藏已完成', exact: true })).toBeChecked();
  await expect(rows.getByText('finished', { exact: true })).toHaveCount(0);
  await view(page, '导图').click();
  for (const id of ['project', 'phase', 'matching', 'overlap']) await expect(page.locator(`.react-flow__node[data-id="${id}"]`)).toBeAttached();
  for (const id of ['outside', 'undated', 'finished']) await expect(page.locator(`.react-flow__node[data-id="${id}"]`)).toHaveCount(0);
  await view(page, '四象限').click();
  for (const name of ['matching', 'overlap']) await expect(page.getByText(name, { exact: true })).toBeVisible();
  for (const name of ['outside', 'undated']) await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  await view(page, '甘特图').click();
  await expect(page.locator('[data-gantt-bar]')).toHaveCount(2);
  await view(page, '日历').click();
  await expect(page.locator('[data-calendar-week-date]')).toHaveCount(3);
  await expect(page.locator('[data-calendar-week-date]').first()).toHaveAttribute('data-calendar-week-date', '2026-11-03');
  await expect(page.locator('[data-calendar-week-date]').last()).toHaveAttribute('data-calendar-week-date', '2026-11-05');
  await view(page, '列表').click();
  await expect(range(page)).toHaveValue('custom');
  await expect(dateField(page, '区间开始日期')).toHaveValue('2026-11-03');
  await expect(dateField(page, '区间结束日期')).toHaveValue('2026-11-05');
  await expect(range(page).locator('option[value="undated"]')).toHaveCount(0);
  await range(page).selectOption('all');
  await expect(rows.getByText('outside', { exact: true })).toBeVisible();
  await expect(rows.getByText('undated', { exact: true })).toHaveCount(0);
  await view(page, '甘特图').click();
  await expect(range(page)).toHaveValue('week');
  await view(page, '列表').click();
  await expect(range(page)).toHaveValue('week');
  await page.setViewportSize({ width: 390, height: 844 });
  await range(page).selectOption('custom');
  await expect(dateField(page, '区间结束日期')).toBeVisible();
  await page.getByRole('dialog', { name: '选择日期区间', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../.preview.local/navigation-mobile.png' });
});

test('changing the interval during a slow view switch never reverts the selected view or accepts gestures from the old canvas', async ({ page }) => {
  await page.goto('/settings');
  const dueAt = await page.evaluate(() => { const value = new Date(); value.setHours(18, 0, 0, 0); return value.getTime(); });
  await seed(page, { tasks: [task('quick_action', { dueAt })] });
  let release!: () => void;
  let requested = false;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/assets\/ListView-[^/]+\.js$/, async route => { requested = true; await waiting; await route.continue(); });
  try {
    await page.goto('/tasks?scope=week&view=gantt');
    await expect(page.locator('[data-gantt-scroll]')).toBeVisible();
    await view(page, '列表').click();
    await expect.poll(() => requested).toBe(true);
    await expect(page).toHaveURL(/view=list/);
    await range(page).selectOption('today');
    await expect(page).toHaveURL(/view=list/);
    await expect(page).toHaveURL(/scope=today/);
    await page.locator('[data-gantt-scroll]').hover();
    await page.mouse.wheel(100, 0);
    await expect(page).toHaveURL(/scope=today/);
    await expect(page).toHaveURL(/view=list/);
    release();
    await expect(view(page, '列表')).toHaveAttribute('data-state', 'active');
    await expect(range(page)).toHaveValue('today');
    await expect(page.locator('[data-row]').getByText('quick_action', { exact: true })).toBeVisible();
  } finally { release(); }
});

test('Gantt horizontal trackpad gestures page by the inclusive visible span, absorb momentum and ignore vertical, pinch and active drags', async ({ page }) => {
  await seed(page, { tasks: [task('bar', { startAt: new Date(2026, 10, 3, 9).getTime(), dueAt: new Date(2026, 10, 3, 18).getTime() }), ...Array.from({ length: 35 }, (_, i) => task(`filler_${i}`, { dueAt: new Date(2026, 10, 3, 20).getTime(), order: i + 1 }))] });
  await page.goto('/tasks?scope=custom&from=2026-11-01&to=2026-11-07&view=gantt');
  const pane = page.locator('[data-gantt-scroll]');
  const hover = async () => { const box = (await pane.boundingBox())!; await page.mouse.move(box.x + box.width * .7, box.y + 80); };
  const swipe = async (deltaX: number) => { await hover(); await page.mouse.wheel(deltaX, 0); };
  await swipe(100);
  await expect(dateField(page, '区间开始日期')).toHaveValue('2026-11-08');
  await expect(dateField(page, '区间结束日期')).toHaveValue('2026-11-14');
  for (let i = 0; i < 5; i++) await page.mouse.wheel(90, 0);
  await expect(dateField(page, '区间开始日期')).toHaveValue('2026-11-08');
  await page.waitForTimeout(360); // end the physical gesture, including its momentum
  await swipe(-100);
  await expect(dateField(page, '区间开始日期')).toHaveValue('2026-11-01');
  await page.waitForTimeout(360);
  await hover();
  await page.mouse.wheel(0, 180);
  await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await expect(dateField(page, '区间开始日期')).toHaveValue('2026-11-01');
  await page.waitForTimeout(360);
  const pinchHandled = await pane.evaluate((element) => { const event = new WheelEvent('wheel', { deltaX: 100, ctrlKey: true, bubbles: true, cancelable: true }); element.dispatchEvent(event); return event.defaultPrevented; });
  expect(pinchHandled).toBe(false);
  await expect(dateField(page, '区间开始日期')).toHaveValue('2026-11-01');
  await pane.evaluate((element) => { element.scrollTop = 0; });
  const bar = page.locator('[data-gantt-bar="bar"]');
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.wheel(100, 0);
  await expect(dateField(page, '区间开始日期')).toHaveValue('2026-11-01');
  await page.mouse.up();
  await dateField(page, '区间结束日期').fill('2026-11-01');
  await swipe(100);
  await expect(dateField(page, '区间开始日期')).toHaveValue('2026-11-02');
  await expect(dateField(page, '区间结束日期')).toHaveValue('2026-11-02');
  await page.waitForTimeout(360);
  await dateField(page, '区间结束日期').fill('2026-12-01'); // 30-day inclusive window
  await swipe(100);
  await expect(dateField(page, '区间开始日期')).toHaveValue('2026-12-02');
  await expect(dateField(page, '区间结束日期')).toHaveValue('2026-12-31');
  await range(page).selectOption('month');
  const days = await page.evaluate(() => new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate());
  const before = await dateField(page, '区间开始日期').inputValue();
  await page.waitForTimeout(360);
  await swipe(100);
  const next = new Date(`${before}T00:00:00`); next.setDate(next.getDate() + days);
  expect(await dateField(page, '区间开始日期').inputValue()).toBe(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`);
});
