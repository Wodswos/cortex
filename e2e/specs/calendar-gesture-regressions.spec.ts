import { expect, test, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function seed(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+08:00'));
  await page.goto('/settings');
  const task = (id: string, title: string, patch = {}) => ({ id, title, parentId: null, ownerId: 'fixture', status: 'todo', order: 0, tags: [], createdAt: 1, updatedAt: 1, ...patch });
  const tasks = [task('linked-undated', '只有时间块的任务'), task('backlog', '未排期任务'), task('dated', '已排期任务', { dueAt: new Date('2026-11-04T18:00:00+08:00').getTime() })];
  const events = [{ id: 'linked-block', title: '时间块关联任务', ownerId: 'fixture', taskId: 'linked-undated', kind: 'focus', start: new Date('2026-11-04T12:00:00+08:00').getTime(), end: new Date('2026-11-04T13:00:00+08:00').getTime(), createdAt: 1, updatedAt: 1 }];
  await page.locator('input[type=file]').setInputFiles({ name: 'calendar-links.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ tasks, events })) });
  await expect(page.getByText(/已合并备份/)).toBeVisible();
  await page.goto('/tasks?view=timeline&scope=today');
}

test('dated calendar blocks retain task links when undated work is hidden from current tasks', async ({ page }) => {
  await seed(page);
  const block = page.getByTestId('event-linked-block');
  await expect(block).toBeVisible();
  await expect(block.getByText('任务', { exact: true })).toBeVisible();
  await block.dblclick();
  await expect(page.locator('[data-task-sheet]').getByLabel('任务标题', { exact: true })).toHaveValue('只有时间块的任务');
  await page.goto('/tasks?view=list&scope=all');
  await expect(page.locator('[data-row]').getByText('已排期任务', { exact: true })).toBeVisible();
  for (const title of ['只有时间块的任务', '未排期任务']) await expect(page.locator('[data-row]').getByText(title, { exact: true })).toHaveCount(0);
});

test('the day time grid retains its creation gesture without opening navigation', async ({ page }) => {
  await seed(page);
  const grid = page.locator('[data-sidebar-swipe-ignore]');
  await expect(grid).toBeVisible();
  const prevented = await grid.evaluate(element => {
    const contact = (x: number) => ({ identifier: 1, target: element, clientX: x, clientY: 300 });
    const dispatch = (type: string, x: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { touches: { value: type === 'touchend' ? [] : [contact(x)] }, changedTouches: { value: [contact(x)] } });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    };
    dispatch('touchstart', 100);
    const movePrevented = dispatch('touchmove', 210);
    dispatch('touchend', 210);
    return movePrevented;
  });
  expect(prevented).toBe(false);
  await expect(page.locator('.workspace-sidebar')).toBeHidden();
  // The same surface still supports its calendar action after exclusion from
  // sidebar recognition; no task is created unless the draft is submitted.
  const point = await grid.evaluate(element => {
    const box = element.getBoundingClientRect();
    const viewport = element.closest('[data-testid="day-scroll"]')!.getBoundingClientRect();
    return { x: box.left + 40, y: Math.max(box.top, viewport.top) + 40 };
  });
  await page.mouse.click(point.x, point.y);
  await expect(page.getByRole('dialog', { name: '新建日历任务' })).toBeVisible();
});
