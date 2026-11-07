import { test, expect, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
const date = (day: string) => new Date(`${day}T12:00:00+08:00`).getTime();
const task = (id: string, patch = {}) => ({ id, title: id, parentId: 'project', status: 'todo', ownerId: 'fixture', order: 0, tags: [], important: false, urgent: false, createdAt: 1, updatedAt: 1, ...patch });
const overview = (page: Page) => page.getByRole('region', { name: '工作概览', exact: true });
const preset = (page: Page, name: string) => overview(page).getByRole('button', { name, exact: true });
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const period = (page: Page) => page.getByRole('combobox', { name: '任务时间范围', exact: true });
const rows = (page: Page) => page.locator('[data-row]');
async function seed(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+08:00'));
  await page.goto('/settings');
  const tasks = [task('project', { parentId: null, kind: 'node', project: true }), task('other_project', { parentId: null, kind: 'node', project: true }), task('old_overdue', { dueAt: date('2026-10-20'), priority: 'P1', tags: ['tag'] }), task('doing_dated', { status: 'doing', dueAt: date('2026-11-04'), priority: 'P1', tags: ['tag'] }), task('doing_undated', { status: 'doing' }), task('week_plan', { dueAt: date('2026-11-06') }), task('future', { dueAt: date('2026-12-01') }), task('finished', { status: 'done', dueAt: date('2026-10-20') }), task('foreign', { parentId: 'other_project', status: 'doing' }), task('start_only', { startAt: date('2026-11-05') })];
  await page.locator('input[type=file]').setInputFiles({ name: 'filters.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ tasks, tags: [{ id: 'tag', name: '重点', color: '#888888' }] })) });
  await expect(page.getByText(/已合并备份/)).toBeVisible();
  await page.goto('/tasks?project=project&view=list&scope=all');
}

test('shared presets distinguish current work from week plans, clear stale constraints, and persist through all five views', async ({ page }) => {
  await seed(page);
  await expect(overview(page).getByRole('button')).toHaveText(['全部', '当前工作', '本周', '逾期']);
  await preset(page, '当前工作').click();
  for (const id of ['old_overdue', 'doing_dated', 'doing_undated']) await expect(rows(page).getByText(id, { exact: true })).toBeVisible();
  for (const id of ['week_plan', 'future', 'finished', 'foreign']) await expect(rows(page).getByText(id, { exact: true })).toHaveCount(0);
  await tab(page, '导图').click();
  await expect(page.locator('.react-flow__edge-path')).toHaveCount(7);
  const positions = await page.locator('.react-flow__node').evaluateAll(nodes => nodes.map(node => ({ id: (node as HTMLElement).dataset.id, transform: (node as HTMLElement).style.transform })));
  await expect(page.locator('.react-flow__node[data-id="old_overdue"] [data-mind-muted]')).not.toHaveAttribute('data-mind-muted', 'true');
  await expect(page.locator('.react-flow__node[data-id="week_plan"] [data-mind-muted]')).toHaveAttribute('data-mind-muted', 'true');
  await preset(page, '全部').click();
  expect(await page.locator('.react-flow__node').evaluateAll(nodes => nodes.map(node => ({ id: (node as HTMLElement).dataset.id, transform: (node as HTMLElement).style.transform })))).toEqual(positions);
  await preset(page, '当前工作').click();
  await tab(page, '四象限').click();
  await expect(page.getByText('old_overdue', { exact: true })).toBeVisible();
  await expect(page.getByText('week_plan', { exact: true })).toHaveCount(0);
  await tab(page, '甘特图').click();
  await expect(page.locator('[data-gantt-bar]')).toHaveCount(2);
  await expect(page.locator('[data-gantt-bar="old_overdue"]')).toBeVisible();
  await expect(page.getByLabel('区间开始日期', { exact: true })).toHaveValue('2026-10-20');
  await expect(period(page)).toHaveValue('all');
  await tab(page, '日历').click();
  await expect(page.getByTestId('calendar-month')).toBeVisible();
  await expect(page.getByText('doing_dated', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '日历未排期任务', exact: true }).getByText('doing_undated', { exact: true })).toBeVisible();
  await expect(page.getByText('week_plan', { exact: true })).toHaveCount(0);
  await tab(page, '列表').click();
  await expect(preset(page, '当前工作')).toHaveAttribute('aria-pressed', 'true');
  await expect(period(page)).toHaveValue('all');
  await preset(page, '本周').click();
  await expect(page.getByLabel('区间开始日期', { exact: true })).toHaveValue('2026-11-02');
  await expect(page.getByLabel('区间结束日期', { exact: true })).toHaveValue('2026-11-08');
  for (const id of ['week_plan', 'doing_dated', 'start_only']) await expect(rows(page).getByText(id, { exact: true })).toBeVisible();
  for (const id of ['old_overdue', 'doing_undated']) await expect(rows(page).getByText(id, { exact: true })).toHaveCount(0);
  await preset(page, '逾期').click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).getByText('old_overdue', { exact: true })).toBeVisible();
  await preset(page, '全部').click();
  await expect(rows(page).getByText('finished', { exact: true })).toBeVisible();
});

test('advanced conditions are intersections, persist on view changes and saved shortcuts, and presets reset them', async ({ page }) => {
  await seed(page);
  await preset(page, '当前工作').click();
  const more = page.getByRole('button', { name: '更多任务筛选', exact: true });
  await more.click();
  await page.getByRole('combobox', { name: '筛选任务状态', exact: true }).selectOption('doing');
  await page.getByRole('combobox', { name: '筛选任务优先级', exact: true }).selectOption('high');
  await page.getByRole('combobox', { name: '筛选任务标签', exact: true }).selectOption('tag');
  await page.keyboard.press('Escape');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).getByText('doing_dated', { exact: true })).toBeVisible();
  for (const view of ['四象限', '甘特图', '日历', '列表']) { await tab(page, view).click(); await expect(page).toHaveURL(/taskStatus=doing/); await expect(page).toHaveURL(/taskPriority=high/); await expect(page).toHaveURL(/taskTag=tag/); }
  await page.getByRole('button', { name: '保存为快捷视图', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '保存快捷视图', exact: true });
  await dialog.getByLabel('视图名称', { exact: true }).fill('正在推进的重点');
  await dialog.getByLabel('展示方式', { exact: true }).selectOption('gantt');
  await expect(dialog.getByLabel('默认时间范围', { exact: true })).toHaveValue('all');
  await expect(dialog.getByLabel('快捷视图工作范围', { exact: true })).toHaveValue('current');
  await expect(dialog.getByLabel('快捷视图任务状态', { exact: true })).toHaveValue('doing');
  await expect(dialog.getByLabel('快捷视图任务标签', { exact: true })).toHaveValue('tag');
  await dialog.getByRole('button', { name: '保存快捷视图', exact: true }).click();
  await expect(page.locator('[data-gantt-bar]')).toHaveCount(1);
  await preset(page, '全部').click();
  await expect(page).not.toHaveURL(/taskStatus|taskPriority|taskTag/);
  await page.getByRole('navigation', { name: '快捷视图', exact: true }).getByRole('link', { name: '正在推进的重点', exact: true }).click();
  await expect(page).toHaveURL(/work=current/);
  await expect(page).toHaveURL(/taskTag=tag/);
  await expect(page.locator('[data-gantt-bar]')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('[data-gantt-bar]')).toHaveCount(1);
});

test('empty results stay empty; new tasks inherit filters; mobile controls and dropdown fit', async ({ page }) => {
  await seed(page);
  await preset(page, '当前工作').click();
  await page.getByRole('textbox', { name: '添加任务', exact: true }).fill('new_current');
  await page.getByRole('textbox', { name: '添加任务', exact: true }).press('Enter');
  await expect(rows(page).getByText('new_current', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '更多任务筛选', exact: true }).click();
  await page.getByRole('combobox', { name: '筛选任务优先级', exact: true }).selectOption('P0');
  await page.keyboard.press('Escape');
  for (const view of ['列表', '四象限', '甘特图', '日历']) {
    await tab(page, view).click();
    for (const id of ['doing_dated', 'week_plan', 'new_current']) await expect(page.getByText(id, { exact: true })).toHaveCount(0);
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('button', { name: '更多任务筛选', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '更多任务筛选', exact: true });
    await expect(dialog).toBeInViewport();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.press('Escape');
  }
});

test('calendar shows start-only tasks and undated work while respecting project boundaries', async ({ page }) => {
  await seed(page);
  await preset(page, '本周').click();
  await tab(page, '日历').click();
  await expect(page.getByText('start_only', { exact: true })).toBeVisible();
  await period(page).selectOption('month');
  await expect(page.getByTestId('calendar-month')).toBeVisible();
  await expect(page.getByText('start_only', { exact: true })).toBeVisible();
  await period(page).selectOption('undated');
  await expect(period(page)).toHaveValue('undated');
  await expect(page.getByRole('region', { name: '日历未排期任务', exact: true }).getByText('doing_undated', { exact: true })).toBeVisible();
  await expect(page.getByText('foreign', { exact: true })).toHaveCount(0);
});

test('current work refreshes when a deadline passes and the page regains focus', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+08:00'));
  await page.goto('/settings');
  await page.locator('input[type=file]').setInputFiles({ name: 'clock.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ tasks: [task('upcoming', { parentId: null, dueAt: date('2026-11-04') + 60000 })] })) });
  await expect(page.getByText(/已合并备份/)).toBeVisible();
  await page.goto('/tasks?view=list&scope=all&work=current');
  await expect(rows(page)).toHaveCount(0);
  await page.clock.setFixedTime(new Date('2026-11-04T12:02:00+08:00'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(rows(page).getByText('upcoming', { exact: true })).toBeVisible();
});
