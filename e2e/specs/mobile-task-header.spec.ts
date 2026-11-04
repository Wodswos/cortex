import { expect, test, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function seed(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+08:00'));
  await page.goto('/settings');
  const task = (id: string, patch = {}) => ({ id, title: id, parentId: null, ownerId: 'fixture', status: 'todo', order: 0, tags: [], createdAt: 1, updatedAt: 1, ...patch });
  await page.locator('input[type=file]').setInputFiles({ name: 'compact-header.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ tasks: [
    task('long-project', { title: '需要在狭窄手机屏幕中保持单行且不挤掉视图图标的项目', kind: 'node', project: true }),
    task('active-work', { title: '进行中的工作', parentId: 'long-project', startAt: new Date('2026-11-03T09:00:00+08:00').getTime(), dueAt: new Date('2026-11-06T18:00:00+08:00').getTime() }),
    task('finished-work', { title: '已完成的工作', parentId: 'long-project', status: 'done', completedAt: new Date('2026-11-04T10:00:00+08:00').getTime(), dueAt: new Date('2026-11-04T11:00:00+08:00').getTime() }),
  ] })) });
  await expect(page.getByText(/已合并备份/)).toBeVisible();
  await page.goto('/tasks?view=gantt&scope=week');
  await expect(page.locator('[data-gantt-bar]')).toHaveCount(2);
}

test('mobile task controls occupy two compact rows at 320, 360 and 390 pixels', async ({ page }, info) => {
  await seed(page);
  for (const width of [390, 360, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const toolbar = page.locator('[data-task-toolbar]');
    const period = page.locator('[data-task-period]');
    await expect(toolbar.getByRole('tab')).toHaveCount(5);
    const geometry = await toolbar.evaluate(element => {
      const box = element.getBoundingClientRect();
      const children = [...element.querySelectorAll('h1,[role="tablist"],button[aria-label="任务更多操作"]')].map(item => {
        const r = item.getBoundingClientRect(); return { x: r.x, right: r.right, midY: r.y + r.height / 2 };
      });
      return { height: box.height, children };
    });
    expect(geometry.height).toBeLessThanOrEqual(50);
    expect(geometry.children[1]!.x - geometry.children[0]!.right).toBeLessThanOrEqual(6);
    for (const child of geometry.children) {
      expect(child.x).toBeGreaterThanOrEqual(0);
      expect(child.right).toBeLessThanOrEqual(width);
      expect(Math.abs(child.midY - geometry.children[0]!.midY)).toBeLessThanOrEqual(2);
    }
    await expect(period.getByRole('button', { name: /^编辑日期区间/ })).toHaveText('11/02–11/08');
    expect((await period.boundingBox())!.height).toBeLessThanOrEqual(34);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width !== 360) await page.screenshot({ path: info.outputPath(`cortex-mobile-density-${width}.png`) });
  }
  await page.goto('/tasks?project=long-project&view=gantt&scope=week');
  await expect(page.getByRole('button', { name: '任务更多操作', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '日历', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '任务更多操作', exact: true }).click();
  await expect(page.getByRole('menu').getByText('项目进度 1/2', { exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '项目操作', exact: true })).toBeVisible();
});

test('secondary task actions live in More and hiding completed work remains persistent', async ({ page }) => {
  await seed(page);
  const more = page.getByRole('button', { name: '任务更多操作', exact: true });
  await expect(page.getByRole('checkbox', { name: '隐藏已完成', exact: true })).toBeHidden();
  await expect(page.getByRole('link', { name: '模板', exact: true })).toBeHidden();
  await more.click();
  const toggle = page.getByRole('menuitemcheckbox', { name: '隐藏已完成', exact: true });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('menuitem', { name: '模板', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '收集箱', exact: true })).toBeVisible();
  await toggle.click();
  await expect(page.locator('[data-gantt-bar]')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('[data-gantt-bar]')).toHaveCount(1);
  await more.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitem', { name: '保存为快捷视图', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '保存快捷视图', exact: true });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate(element => ({
    inside: element.contains(document.activeElement),
    tag: document.activeElement?.tagName,
    label: document.activeElement?.getAttribute('aria-label'),
  }))).toMatchObject({ inside: true });
  await dialog.getByLabel('视图名称', { exact: true }).fill('精简手机甘特');
  await dialog.getByRole('button', { name: '保存快捷视图', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '精简手机甘特', exact: true })).toBeVisible();
  await expect(more).toBeFocused();
  await more.click();
  await page.getByRole('menuitem', { name: '收集箱', exact: true }).click();
  await expect(page).toHaveURL(/\/inbox$/);
});

test('mobile date editing applies atomically and cancellation preserves the selected window', async ({ page }) => {
  await seed(page);
  const before = page.url();
  const period = page.getByRole('combobox', { name: '任务时间范围', exact: true });
  await period.selectOption('custom');
  const dialog = page.getByRole('dialog', { name: '选择日期区间', exact: true });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(before);
  await dialog.getByLabel('区间开始日期', { exact: true }).fill('2026-11-10');
  await dialog.getByLabel('区间结束日期', { exact: true }).fill('2026-11-12');
  await expect(page).toHaveURL(before);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page).toHaveURL(before);
  await expect(period).toHaveValue('week');
  await expect(period).toBeFocused();
  const dateButton = page.getByRole('button', { name: /^编辑日期区间/ });
  await dateButton.click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(dateButton).toBeFocused();
  await dateButton.click();
  await dialog.getByLabel('区间开始日期', { exact: true }).fill('2026-11-03');
  await dialog.getByLabel('区间结束日期', { exact: true }).fill('2026-11-05');
  const dateFont = await dialog.getByLabel('区间开始日期', { exact: true }).evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  expect(dateFont).toBeGreaterThanOrEqual(16);
  await dialog.getByRole('button', { name: '应用日期', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/scope=custom/);
  await expect(page).toHaveURL(/from=2026-11-03/);
  await expect(page).toHaveURL(/to=2026-11-05/);
  await expect(page.getByRole('button', { name: /^编辑日期区间/ })).toHaveText('11/03–11/05');
  await page.getByRole('button', { name: '下一个时间段', exact: true }).click();
  await expect(page.getByRole('button', { name: /^编辑日期区间/ })).toHaveText('11/06–11/08');
  await dateButton.click();
  await dialog.getByLabel('区间开始日期', { exact: true }).fill('2025-12-31');
  await dialog.getByLabel('区间结束日期', { exact: true }).fill('2026-01-02');
  await dialog.getByRole('button', { name: '应用日期', exact: true }).click();
  await expect(dateButton).toHaveText('25/12/31–26/01/02');
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await dateButton.locator('span').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dateButton.click();
  await dialog.getByLabel('区间开始日期', { exact: true }).fill('2025-11-03');
  await dialog.getByLabel('区间结束日期', { exact: true }).fill('2025-11-05');
  await dialog.getByRole('button', { name: '应用日期', exact: true }).click();
  await expect(dateButton).toHaveText('25/11/03–11/05');
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByLabel('区间开始日期', { exact: true })).toHaveValue('2025-11-03');
  await expect(page.getByLabel('区间结束日期', { exact: true })).toHaveValue('2025-11-05');
  await expect(page.getByRole('checkbox', { name: '隐藏已完成', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '任务更多操作', exact: true })).toBeHidden();
});
