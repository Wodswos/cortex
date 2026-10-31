import { test, expect, type Page, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const fixedNow = new Date('2026-10-21T12:00:00+08:00');
const stamp = (day: number, hour = 0) => new Date(`2026-10-${day}T${String(hour).padStart(2, '0')}:00:00+08:00`).getTime();
const task = (id: string, patch: Record<string, unknown> = {}) => ({
  id, title: id, parentId: null, status: 'todo', order: 0, ownerId: 'fixture', tags: [],
  important: false, urgent: false, priority: 'P3', createdAt: stamp(19), updatedAt: stamp(19), ...patch,
});
async function seed(page: Page, data: unknown) {
  await page.goto('/settings');
  await page.locator('input[type=file]').setInputFiles({ name: 'interactions.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await expect(page.getByText(/已合并备份/)).toBeVisible();
}
async function exported(page: Page) {
  await page.locator('a[href="/settings"]').first().click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
  const path = await (await downloading).path();
  return JSON.parse(await readFile(path!, 'utf8')).data;
}
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  (page as any).__interactionErrors = errors;
});
test.afterEach(async ({ page }) => { expect((page as any).__interactionErrors).toEqual([]); });

test('legacy global view preference never changes a different project, and explicit project choices survive', async ({ page }) => {
  await seed(page, { tasks: [task('a', { kind: 'node', title: 'Project A' }), task('b', { kind: 'node', title: 'Project B' })] });
  await page.evaluate(() => localStorage.setItem('cortex:project-views:local', JSON.stringify({ last: 'mindmap', projects: { b: 'mindmap' } })));
  await page.goto('/tasks?project=a');
  const view = (name: string) => page.getByRole('tablist', { name: '任务视图' }).getByRole('tab', { name, exact: true });
  await expect(view('列表')).toHaveAttribute('data-state', 'active');
  const nav = page.getByRole('navigation', { name: '项目', exact: true });
  await nav.getByRole('link', { name: 'Project B', exact: true }).click();
  await expect(view('导图')).toHaveAttribute('data-state', 'active');
  await nav.getByRole('link', { name: 'Project A', exact: true }).click();
  await expect(view('列表')).toHaveAttribute('data-state', 'active');
  await page.reload();
  await expect(view('列表')).toHaveAttribute('data-state', 'active');
  await nav.getByRole('link', { name: 'Project B', exact: true }).click();
  await expect(view('导图')).toHaveAttribute('data-state', 'active');
});

test('one click hides or shows completed tasks in all five views and persists the checkbox', async ({ page }) => {
  await page.clock.install({ time: fixedNow });
  await seed(page, { tasks: [task('project', { kind: 'node', project: true }),
    task('complete', { title: 'Completed example', parentId: 'project', status: 'done', completedAt: stamp(21, 11), dueAt: stamp(21, 18) }),
    task('pending', { title: 'Pending example', parentId: 'project', dueAt: stamp(21, 17) })] });
  await page.goto('/tasks?project=project');
  const checkbox = page.getByRole('checkbox', { name: '隐藏已完成', exact: true });
  const target = (view: string, id: string): Locator => {
    if (view === '导图') return page.locator(`.react-flow__node[data-id="${id}"]`);
    if (view === '甘特图') return page.locator(`[data-gantt-bar="${id}"]`);
    return page.getByText(id === 'complete' ? 'Completed example' : 'Pending example', { exact: true });
  };
  for (const name of ['列表', '导图', '四象限', '甘特图', '时间线']) {
    await page.getByRole('tablist', { name: '任务视图' }).getByRole('tab', { name, exact: true }).click();
    await expect(checkbox).not.toBeChecked();
    await expect(target(name, 'complete')).toHaveCount(1);
    await checkbox.click();
    await expect(checkbox).toBeChecked();
    await expect(target(name, 'complete')).toHaveCount(0);
    await expect(target(name, 'pending')).toHaveCount(1);
    await checkbox.click();
    await expect(target(name, 'complete')).toHaveCount(1);
  }
  await checkbox.click();
  await expect(page.getByText('Completed example', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(checkbox).toBeChecked();
  await expect(page.getByText('Completed example', { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(checkbox).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Gantt handles keep the opposite endpoint stable across midnight, and moving one-sided tasks keeps their duration', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.clock.install({ time: fixedNow });
  await seed(page, { tasks: [task('due_only', { dueAt: stamp(21, 18) }), task('start_only', { startAt: stamp(21, 10) }), task('move_only', { dueAt: stamp(21, 20) })] });
  const open = async () => {
    await page.goto('/tasks?view=gantt');
    await expect(page.locator('[data-gantt-bar="due_only"]')).toBeVisible();
  };
  const drag = async (id: string, mode: 'start' | 'end' | 'move', dayDelta: number) => {
    const bar = page.locator(`[data-gantt-bar="${id}"]`);
    const original = (await bar.boundingBox())!;
    const handle = mode === 'move' ? bar : bar.getByTitle(mode === 'start' ? '拖动调整开始时间(5 分钟粒度)' : '拖动调整截止时间(5 分钟粒度)', { exact: true });
    const bounds = (await handle.boundingBox())!;
    const dayWidth = (await page.locator('[data-gantt-track]').first().boundingBox())!.width / 7;
    const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dayWidth * dayDelta, y, { steps: 12 });
    await expect.poll(async () => {
      const box = (await bar.boundingBox())!;
      return Math.abs(mode === 'end' ? box.width - original.width : box.x - original.x);
    }).toBeGreaterThan(10);
    const preview = (await bar.boundingBox())!;
    if (mode === 'end') expect(preview.x).toBeCloseTo(original.x, 1);
    if (mode === 'start') expect(preview.x + preview.width).toBeCloseTo(original.x + original.width, 1);
    await page.mouse.up();
    const final = (await bar.boundingBox())!;
    expect(final.x).toBeCloseTo(preview.x, 1); expect(final.width).toBeCloseTo(preview.width, 1);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    return exported(page);
  };
  await open();
  let data = await drag('due_only', 'end', 1);
  expect(data.tasks.find((value: any) => value.id === 'due_only')).toMatchObject({ startAt: stamp(21), dueAt: stamp(22, 18) });
  await open();
  data = await drag('start_only', 'start', -1);
  expect(data.tasks.find((value: any) => value.id === 'start_only')).toMatchObject({ startAt: stamp(20, 10), dueAt: stamp(22) - 1 });
  await open();
  data = await drag('move_only', 'move', 0.25);
  expect(data.tasks.find((value: any) => value.id === 'move_only')).toMatchObject({ startAt: stamp(21, 6), dueAt: stamp(22, 2) });
});
