import { test, expect, type Page, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.use({ serviceWorkers: 'block' });
const fixedNow = new Date('2026-11-05T12:00:00+08:00');
const date = (day: string, hour = 18) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00+08:00`).getTime();
const task = (id: string, patch = {}) => ({ id, title: id, parentId: null, status: 'todo', ownerId: 'fixture', order: 0, tags: [], important: false, urgent: false, createdAt: 1, updatedAt: 1, ...patch });
async function seed(page: Page, crowdedDay = '2026-11-05') {
  await page.clock.setFixedTime(fixedNow);
  await page.goto('/settings');
  const tasks = Array.from({ length: 30 }, (_, index) => task(`task${index}`, { title: `工作项 ${String(index).padStart(2, '0')}`, dueAt: date(crowdedDay), ...(index === 29 ? { status: 'done' } : {}) }));
  const events = [0, 1, 2].map(index => ({ id: `event${index}`, taskId: null, title: `日程 ${index}`, start: date(crowdedDay, 9 + index), end: date(crowdedDay, 10 + index), kind: 'meeting', ownerId: 'fixture', createdAt: 1, updatedAt: 1 }));
  await page.locator('input[type=file]').setInputFiles({ name: 'calendar.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ tasks, events })) });
  await expect(page.getByText(/已合并备份/)).toBeVisible();
  await page.goto('/tasks?view=timeline&scope=month');
}
const dayMenu = (page: Page, day = '2026-11-05') => page.getByRole('menu', { name: `${day} 的全部项目`, exact: true });
const draft = (page: Page) => page.getByRole('dialog', { name: '新建日历任务', exact: true });

async function assertCellFits(cell: Locator) {
  const fits = await cell.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return [...element.querySelectorAll('button')].every(button => button.getBoundingClientRect().bottom <= bounds.bottom + 1);
  });
  expect(fits).toBe(true);
}

test('overflow opens a scrollable list of every task and event without changing the month, and items remain actionable', async ({ page }, testInfo) => {
  await seed(page);
  const cell = page.locator('[data-calendar-date="2026-11-05"]');
  const more = cell.getByRole('button', { name: /还有/ });
  await expect(more).toBeVisible();
  const shown = await cell.locator('.calendar-item').count();
  expect(shown).toBeGreaterThanOrEqual(3);
  expect(shown).toBeLessThanOrEqual(5);
  await expect(more).toHaveText(`还有 ${33 - shown} 项`);
  await assertCellFits(cell);
  await more.click();
  const menu = dayMenu(page);
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveCount(33);
  const rowHeight = (await menu.getByRole('menuitem').first().boundingBox())!.height;
  expect(rowHeight).toBeLessThanOrEqual(34);
  await expect(page).toHaveURL(/scope=month/);
  await expect(draft(page)).toHaveCount(0);
  const list = menu.locator('[data-calendar-day-items]');
  expect(await list.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await list.hover(); await page.mouse.wheel(0, 250);
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(menu.getByRole('button', { name: '关闭当日项目列表', exact: true })).toBeInViewport();
  const menuBox = (await menu.boundingBox())!;
  expect(menuBox.y).toBeGreaterThanOrEqual(0);
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.screenshot({ path: testInfo.outputPath('calendar-day-list-desktop.png') });
  const last = menu.getByRole('menuitem', { name: '工作项 29 任务 · 已完成', exact: true });
  await last.scrollIntoViewIfNeeded(); await last.click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '任务详情', exact: true })).toBeVisible();
  await expect(draft(page)).toHaveCount(0);
});

test('overflow list respects completion filtering and keyboard navigation, restores focus on Escape, and opens event days', async ({ page }) => {
  await seed(page);
  await page.getByRole('checkbox', { name: '隐藏已完成', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '隐藏已完成', exact: true })).toBeChecked();
  const cell = page.locator('[data-calendar-date="2026-11-05"]');
  const more = cell.getByRole('button', { name: /还有/ });
  await more.focus(); await more.press('Enter');
  const menu = dayMenu(page);
  await expect(menu.getByRole('menuitem')).toHaveCount(32);
  await expect(menu.getByText('工作项 29', { exact: true })).toHaveCount(0);
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem').last()).toBeFocused();
  await expect(menu.getByRole('menuitem').last()).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0); await expect(more).toBeFocused();
  await more.press('Enter');
  await menu.getByRole('menuitem', { name: '日程 0 日程', exact: true }).click();
  await expect(page.getByTestId('day-scroll')).toBeVisible();
  await expect(page.getByLabel('区间开始日期', { exact: true })).toHaveValue('2026-11-05');
  await expect(draft(page)).toHaveCount(0);
});

async function blankPoint(page: Page, cells: Locator, outside?: { x: number; y: number; width: number; height: number }) {
  const bounds = await cells.evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));
  const viewport = page.viewportSize()!;
  const toolbar = (await page.getByLabel('任务筛选与强调', { exact: true }).boundingBox())!;
  for (let index = 0; index < bounds.length; index++) {
    const box = bounds[index];
    for (const y of [box.y + 42, box.y + 36, box.y + box.height - 10, 260, 240, 450, 580]) {
      const x = box.x + box.width * .7;
      if (x < 8 || x > viewport.width - 8 || y < Math.max(toolbar.y + toolbar.height + 42, box.y + 30) || y >= Math.min(box.y + box.height - 4, viewport.height - 70)) continue;
      if (outside && x >= outside.x && x <= outside.x + outside.width && y >= outside.y && y <= outside.y + outside.height) continue;
      return { x, y, index };
    }
  }
  throw new Error('No visible blank calendar point outside the draft');
}

for (const scope of ['month', 'week', 'today']) test(`${scope} draft dismissals consume the whole click and never open a replacement draft`, async ({ page }) => {
  await page.clock.setFixedTime(fixedNow);
  await page.goto(`/tasks?view=timeline&scope=${scope}`);
  const cells = scope === 'month' ? page.locator('[data-calendar-date]') : scope === 'week' ? page.locator('[data-calendar-week-date]') : page.locator('[data-calendar-day-date]');
  await expect(cells.first()).toBeAttached();
  const first = await blankPoint(page, scope === 'month' ? cells.nth(15) : cells.last());
  await page.mouse.click(first.x, first.y);
  await expect(draft(page)).toBeVisible();
  await draft(page).getByRole('textbox', { name: '新任务标题', exact: true }).fill('取消的草稿');
  const next = await blankPoint(page, cells, (await draft(page).boundingBox())!);
  await page.mouse.click(next.x, next.y);
  await expect(draft(page)).toHaveCount(0);
  await page.mouse.click(next.x, next.y);
  await expect(draft(page)).toBeVisible();
  const sameCell = await blankPoint(page, cells.nth(next.index), (await draft(page).boundingBox())!);
  await page.mouse.click(sameCell.x, sameCell.y);
  await expect(draft(page)).toHaveCount(0);
  // A non-calendar blank also dismisses without creating any record.
  await page.mouse.click(next.x, next.y);
  await expect(draft(page)).toBeVisible();
  await page.mouse.click(250, 20);
  await expect(draft(page)).toHaveCount(0);
  await page.locator('a[href="/settings"]').first().click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
  const data = JSON.parse(await readFile((await (await downloading).path())!, 'utf8')).data;
  expect(data.tasks).toHaveLength(0);
});

test.describe('touch calendar', () => {
  test.use({ viewport: { width: 320, height: 740 }, hasTouch: true });
  test('last-column overflow stays inside the viewport, scrolls, and a second blank tap only cancels a draft', async ({ page }, testInfo) => {
    await seed(page, '2026-11-29');
    const cell = page.locator('[data-calendar-date="2026-11-29"]');
    const more = cell.getByRole('button', { name: /还有/ });
    await more.scrollIntoViewIfNeeded();
    expect(await cell.locator('.calendar-item').count()).toBeGreaterThanOrEqual(2);
    await assertCellFits(cell);
    await more.tap();
    const menu = dayMenu(page, '2026-11-29');
    await expect(menu.getByRole('menuitem')).toHaveCount(33);
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(320);
    expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(740);
    await menu.getByRole('menuitem').last().scrollIntoViewIfNeeded();
    await expect(menu.getByRole('menuitem').last()).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('calendar-day-list-mobile.png') });
    await menu.getByRole('button', { name: '关闭当日项目列表', exact: true }).tap();
    await expect(menu).toHaveCount(0);
    const empty = page.locator('[data-calendar-date="2026-11-09"]');
    await empty.scrollIntoViewIfNeeded();
    const initial = await blankPoint(page, empty);
    await page.touchscreen.tap(initial.x, initial.y);
    await expect(draft(page)).toBeVisible();
    const next = await blankPoint(page, page.locator('[data-calendar-date]'), (await draft(page).boundingBox())!);
    await page.touchscreen.tap(next.x, next.y);
    await expect(draft(page)).toHaveCount(0);
    await page.touchscreen.tap(next.x, next.y);
    await expect(draft(page)).toBeVisible();
    await draft(page).getByRole('textbox', { name: '新任务标题', exact: true }).fill('触屏确认创建');
    await draft(page).getByRole('button', { name: '创建任务', exact: true }).tap();
    await expect(draft(page)).toHaveCount(0);
  });
});
