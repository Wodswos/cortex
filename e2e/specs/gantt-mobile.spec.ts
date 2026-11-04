import { expect, test, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const route = '/tasks?view=gantt&scope=custom&from=2026-11-02&to=2026-11-08';
const task = (id: string, patch = {}) => ({ id, title: id, parentId: null, ownerId: 'fixture', status: 'todo', order: 0, tags: [], important: false, urgent: false, createdAt: 1, updatedAt: 1, ...patch });
async function seed(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+08:00'));
  await page.goto('/settings');
  const tasks = [task('short-task', { startAt: new Date('2026-11-03T09:00:00+08:00').getTime(), dueAt: new Date('2026-11-03T18:00:00+08:00').getTime() }),
    task('project', { kind: 'node', project: true, order: 1 }), task('group-1', { kind: 'node', parentId: 'project' }), task('group-2', { kind: 'node', parentId: 'group-1' }), task('group-3', { kind: 'node', parentId: 'group-2' }), task('deep-task', { parentId: 'group-3', dueAt: new Date('2026-11-04T18:00:00+08:00').getTime() })];
  await page.locator('input[type=file]').setInputFiles({ name: 'mobile-gantt.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ tasks })) });
  await expect(page.getByText(/已合并备份/)).toBeVisible();
  await page.goto(route);
  await expect(page.locator('[data-gantt-bar="short-task"]')).toBeVisible();
  return tasks;
}
async function swipe(page: Page, selector: string, dx: number, dy = 0, points = 1) {
  return page.locator(selector).first().evaluate((element, gesture) => {
    const rect = element.getBoundingClientRect();
    const x = gesture.dx < 0 ? Math.min(innerWidth - 35, rect.right - 20) : Math.max(150, rect.left + 20), y = rect.top + Math.min(rect.height / 2, 100);
    const contact = (offset: number, vertical: number, id = 1) => ({ identifier: id, target: element, clientX: x + offset, clientY: y + vertical });
    const send = (type: string, active: ReturnType<typeof contact>[], changed = active) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { touches: { value: active }, changedTouches: { value: changed } });
      element.dispatchEvent(event); return event.defaultPrevented;
    };
    send('touchstart', Array.from({ length: gesture.points }, (_, index) => contact(0, index * 5, index + 1)));
    const prevented = send('touchmove', Array.from({ length: gesture.points }, (_, index) => contact(gesture.dx, gesture.dy + index * 5, index + 1)));
    send('touchend', [], [contact(gesture.dx, gesture.dy)]);
    return prevented;
  }, { dx, dy, points });
}
async function exportedDates(page: Page) {
  await page.goto('/settings');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
  const stream = await (await downloading).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const data = JSON.parse(Buffer.concat(chunks).toString()).data;
  return data.tasks.map((item: { id: string; startAt?: number | null; dueAt?: number | null }) => ({ id: item.id, startAt: item.startAt ?? null, dueAt: item.dueAt ?? null }));
}

test('mobile Gantt fits a useful week beside a narrow adjustable task column and retains its width', async ({ page }) => {
  await seed(page);
  const heading = page.locator('[data-gantt-name-heading]');
  const handle = page.getByRole('separator', { name: '调整甘特图任务列宽度' });
  await expect(handle).toHaveAttribute('aria-valuenow', '128');
  expect((await heading.boundingBox())!.width).toBe(128);
  expect(await page.locator('[data-gantt-scroll]').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(2);
  expect((await page.locator('[data-gantt-name]').getByRole('button', { name: 'deep-task', exact: true }).boundingBox())!.width).toBeGreaterThan(24);
  for (const id of ['short-task', 'deep-task']) {
    const geometry = await page.locator(`[data-gantt-bar="${id}"]`).evaluate(bar => {
      const row = bar.closest('[data-gantt-track]')!.parentElement!;
      const name = row.querySelector('[data-gantt-name]')!;
      const title = name.querySelector('button[title]')!;
      const mark = name.querySelector('.task-check-mark')!;
      const check = name.querySelector('.task-check')!;
      const center = (element: Element) => { const box = element.getBoundingClientRect(); return box.y + box.height / 2; };
      return { rowHeight: row.getBoundingClientRect().height, nameHeight: name.getBoundingClientRect().height,
        titleDelta: Math.abs(center(title) - center(bar)), checkDelta: Math.abs(center(mark) - center(bar)),
        checkHeight: check.getBoundingClientRect().height, checkWidth: check.getBoundingClientRect().width };
    });
    await test.info().attach(`gantt-row-${id}-geometry`, { body: JSON.stringify(geometry), contentType: 'application/json' });
    expect(geometry.rowHeight).toBeLessThanOrEqual(35);
    expect(geometry.nameHeight).toBeLessThanOrEqual(35);
    expect(geometry.titleDelta).toBeLessThanOrEqual(1);
    expect(geometry.checkDelta).toBeLessThanOrEqual(1);
    expect(geometry.checkHeight).toBeGreaterThanOrEqual(32);
    expect(geometry.checkWidth).toBeGreaterThanOrEqual(28);
  }
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 36, box.y + box.height / 2); await page.mouse.up();
  await expect(handle).toHaveAttribute('aria-valuenow', '164');
  await page.reload();
  await expect(handle).toHaveAttribute('aria-valuenow', '164');
  await handle.focus(); await page.keyboard.press('Home');
  await expect(handle).toHaveAttribute('aria-valuenow', '104');
  await page.keyboard.press('ArrowRight');
  await expect(handle).toHaveAttribute('aria-valuenow', '112');
  await page.keyboard.press('End');
  await expect(handle).toHaveAttribute('aria-valuenow', '208');
  await handle.dblclick();
  await expect(handle).toHaveAttribute('aria-valuenow', '128');
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(async () => (await heading.boundingBox())!.width).toBe(208);
  await expect(handle).toHaveCount(0);
});

test('a mobile horizontal swipe changes time without opening navigation or changing task dates', async ({ page }) => {
  const tasks = await seed(page);
  expect(await swipe(page, '[data-gantt-track]', -100)).toBe(true);
  await expect(page).toHaveURL(/from=2026-11-09/);
  await expect(page.locator('.workspace-sidebar')).toBeHidden();
  expect(await swipe(page, '[data-gantt-scroll]', 100)).toBe(true);
  await expect(page).toHaveURL(/from=2026-11-02/);
  expect(await swipe(page, '[data-gantt-scroll]', 10, 100)).toBe(false);
  expect(await swipe(page, '[data-gantt-scroll]', -100, 90)).toBe(false);
  expect(await swipe(page, '[data-gantt-scroll]', -100, 0, 2)).toBe(false);
  expect(await swipe(page, '[data-gantt-bar="short-task"]', -100)).toBe(false);
  await expect(page).toHaveURL(/from=2026-11-02/);
  const expected = tasks.map(item => ({ id: item.id, startAt: 'startAt' in item ? item.startAt ?? null : null, dueAt: 'dueAt' in item ? item.dueAt ?? null : null }));
  expect(await exportedDates(page)).toEqual(expected);
});

test('zoomed mobile time pans within the interval before an edge pull changes the interval', async ({ page }) => {
  await seed(page);
  const pane = page.locator('[data-gantt-scroll]');
  await page.getByTitle('时间轴放大(拖条可按 5 分钟微调)').click();
  expect(await pane.evaluate(element => element.scrollWidth - element.clientWidth)).toBeGreaterThan(150);
  expect(await swipe(page, '[data-gantt-scroll]', -90)).toBe(true);
  await expect.poll(() => pane.evaluate(element => element.scrollLeft)).toBe(90);
  await expect(page).toHaveURL(/from=2026-11-02/);
  await pane.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  expect(await swipe(page, '[data-gantt-scroll]', -90)).toBe(true);
  await expect(page).toHaveURL(/from=2026-11-09/);
  await expect.poll(() => pane.evaluate(element => element.scrollLeft)).toBe(0);
  await expect(page.locator('.workspace-sidebar')).toBeHidden();
});

test('trusted mobile touch pages an empty task track without rescheduling the task', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Trusted touch uses CDP; WebKit covers the same event handling above.');
  const tasks = await seed(page);
  const track = (await page.locator('[data-gantt-track]').first().boundingBox())!;
  const x = Math.min(350, track.x + track.width - 20), y = track.y + track.height / 2;
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (const delta of [15, 35, 60, 90, 115]) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - delta, y: y + 3 }] });
    await page.waitForTimeout(20);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page).toHaveURL(/from=2026-11-09/);
  await expect(page.locator('.workspace-sidebar')).toBeHidden();
  const expected = tasks.map(item => ({ id: item.id, startAt: 'startAt' in item ? item.startAt ?? null : null, dueAt: 'dueAt' in item ? item.dueAt ?? null : null }));
  expect(await exportedDates(page)).toEqual(expected);
});

test.describe('desktop time navigation', () => {
test.use({ isMobile: false, hasTouch: false, viewport: { width: 1280, height: 900 } });
test('desktop horizontal wheel paging keeps its existing once-per-stream behavior', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seed(page);
  const pane = page.locator('[data-gantt-scroll]');
  await pane.hover(); await page.mouse.wheel(100, 0);
  await expect(page).toHaveURL(/from=2026-11-09/);
  for (let index = 0; index < 4; index++) await page.mouse.wheel(90, 0);
  await expect(page).toHaveURL(/from=2026-11-09/);
  await page.waitForTimeout(360);
  await page.mouse.wheel(-100, 0);
  await expect(page).toHaveURL(/from=2026-11-02/);
});
});
