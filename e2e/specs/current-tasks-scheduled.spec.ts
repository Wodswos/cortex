import { expect, test, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const task = (id: string, patch = {}) => ({ id, title: id, parentId: null, ownerId: 'fixture', status: 'todo', order: 0, tags: [], important: false, urgent: false, createdAt: 1, updatedAt: 1, ...patch });
async function seed(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+08:00'));
  await page.goto('/settings');
  const tasks = [task('project', { kind: 'node', project: true }), task('group', { kind: 'node', parentId: 'project' }), task('scheduled', { parentId: 'group', dueAt: new Date('2026-11-04T18:00:00+08:00').getTime() }), task('backlog', { parentId: 'project' }), task('loose_backlog')];
  await page.locator('input[type=file]').setInputFiles({ name: 'scheduled.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ tasks })) });
  await expect(page.getByText(/已合并备份/)).toBeVisible();
}

test('every current task view excludes undated work while preserving dated-task ancestry', async ({ page }) => {
  await seed(page);
  await page.goto('/tasks?scope=all&view=list');
  await expect(page.locator('[data-row]').getByText('scheduled', { exact: true })).toBeVisible();
  await expect(page.locator('[data-row]').getByText('group', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '任务时间范围', exact: true }).locator('option[value="undated"]')).toHaveCount(0);
  for (const title of ['backlog', 'loose_backlog']) await expect(page.locator('[data-row]').getByText(title, { exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: '导图', exact: true }).click();
  await expect(page.locator('.react-flow__node[data-id="scheduled"]')).toBeVisible();
  for (const id of ['backlog', 'loose_backlog']) await expect(page.locator(`.react-flow__node[data-id="${id}"]`)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^重要未排期/ })).toHaveCount(0);
  await page.getByRole('tab', { name: '四象限', exact: true }).click();
  await expect(page.getByText('scheduled', { exact: true })).toBeVisible();
  for (const title of ['backlog', 'loose_backlog']) await expect(page.getByText(title, { exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: '甘特图', exact: true }).click();
  await expect(page.locator('[data-gantt-bar="scheduled"]')).toBeVisible();
  await expect(page.locator('[data-gantt-unscheduled]')).toHaveCount(0);
  await page.getByRole('tab', { name: '日历', exact: true }).click();
  await expect(page.getByText('scheduled', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: '任务时间范围', exact: true }).selectOption('today');
  await expect(page.getByText('scheduled', { exact: true }).first()).toBeVisible();
  for (const title of ['backlog', 'loose_backlog']) await expect(page.getByText(title, { exact: true })).toHaveCount(0);
});

test('project backlog remains available and legacy current undated links return to scheduled work', async ({ page }) => {
  await seed(page);
  await page.goto('/tasks?view=list&scope=undated');
  await expect(page).toHaveURL(/scope=week/);
  await expect(page.locator('[data-row]').getByText('scheduled', { exact: true })).toBeVisible();
  await page.goto('/tasks?saved=removed_view&view=list&scope=all');
  await expect(page.getByRole('heading', { name: '当前任务', exact: true })).toBeVisible();
  await expect(page.locator('[data-row]').getByText('backlog', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '任务时间范围', exact: true }).locator('option[value="undated"]')).toHaveCount(0);
  await page.goto('/tasks?project=project&view=list&scope=undated');
  await expect(page.locator('[data-row]').getByText('backlog', { exact: true })).toBeVisible();
  await expect(page.locator('[data-row]').getByText('scheduled', { exact: true })).toHaveCount(0);
  await page.goto('/tasks?project=project&view=gantt');
  await expect(page.locator('[data-gantt-unscheduled]').getByRole('button', { name: 'backlog', exact: true })).toBeVisible();
});

test('adding a task in the current all-time list keeps it visible by giving it today as its date', async ({ page }) => {
  await seed(page);
  await page.goto('/tasks?view=list&scope=all');
  await page.getByRole('textbox', { name: '添加任务', exact: true }).fill('new scheduled task');
  await page.getByRole('textbox', { name: '添加任务', exact: true }).press('Enter');
  await expect(page.locator('[data-row]').getByText('new scheduled task', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-row]').getByText('new scheduled task', { exact: true })).toBeVisible();
});
