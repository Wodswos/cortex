import { expect, test, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, contextOptions: { reducedMotion: 'no-preference' } });

async function swipe(page: Page, selector: string, dx: number, dy = 0, points = 1, duration = 400) {
  return page.locator(selector).evaluate((element, gesture) => {
    const box = element.getBoundingClientRect();
    const x = box.left + Math.min(90, box.width / 4), y = box.bottom - Math.min(35, box.height / 2);
    const touch = (offset: number, vertical: number, identifier = 1) => ({ identifier, target: element, clientX: x + offset, clientY: y + vertical });
    const dispatch = (type: string, touches: ReturnType<typeof touch>[], changedTouches = touches) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { touches: { value: touches }, changedTouches: { value: changedTouches }, timeStamp: { value: type === 'touchstart' ? 0 : type === 'touchmove' ? gesture.duration * 0.8 : gesture.duration } });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    };
    dispatch('touchstart', Array.from({ length: gesture.points }, (_, index) => touch(0, index * 5, index + 1)));
    const prevented = dispatch('touchmove', Array.from({ length: gesture.points }, (_, index) => touch(gesture.dx, gesture.dy + index * 5, index + 1)));
    dispatch('touchend', [], [touch(gesture.dx, gesture.dy)]);
    return prevented;
  }, { dx, dy, points, duration });
}

test('sidebar slides horizontally in and out while its surface keeps the full safe-area height', async ({ page }) => {
  await page.goto('/tasks?view=list');
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--app-safe-area-top', '59px');
    document.documentElement.style.setProperty('--app-safe-area-bottom', '34px');
  });
  const drawer = page.locator('.workspace-sidebar');
  await expect(drawer).toBeHidden();
  const opened = await drawer.evaluate(async element => {
    const positions: number[] = [];
    (document.querySelector('[aria-label="打开导航"]') as HTMLElement).click();
    const until = performance.now() + 240;
    while (performance.now() < until) {
      await new Promise(requestAnimationFrame);
      positions.push(element.getBoundingClientRect().x);
    }
    return positions;
  });
  expect(opened.some(x => x < -1)).toBe(true);
  await expect.poll(async () => (await drawer.boundingBox())?.x).toBe(0);
  expect((await drawer.boundingBox())!.height).toBe(844);
  expect((await drawer.boundingBox())!.y).toBe(0);
  await expect(page.getByRole('button', { name: '打开导航', exact: true })).toHaveAttribute('aria-expanded', 'true');
  const closed = await drawer.evaluate(async element => {
    const positions: number[] = [];
    (document.querySelector('[aria-label="关闭导航"]') as HTMLElement).click();
    const until = performance.now() + 240;
    while (performance.now() < until) {
      await new Promise(requestAnimationFrame);
      positions.push(element.getBoundingClientRect().x);
    }
    return positions;
  });
  expect(closed.some(x => x < -1 && x > -223)).toBe(true);
  await expect(drawer).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(drawer).toBeVisible();
  expect((await drawer.boundingBox())!.x).toBe(0);
});

test('a right swipe opens navigation only from blank content with clear single-finger intent', async ({ page }) => {
  await page.goto('/tasks?view=list');
  const drawer = page.locator('.workspace-sidebar');
  await expect(page.locator('[data-task-list]')).toBeVisible();
  expect(await swipe(page, '[data-task-list]', 30)).toBe(true);
  await expect(drawer).toBeHidden();
  expect(await swipe(page, '[data-task-list]', 20, 90)).toBe(false);
  await expect(drawer).toBeHidden();
  expect(await swipe(page, '[data-task-list]', -90)).toBe(false);
  await expect(drawer).toBeHidden();
  expect(await swipe(page, '[data-task-list]', 110, 0, 2)).toBe(false);
  await expect(drawer).toBeHidden();
  expect(await swipe(page, '[data-task-list]', 110, 8)).toBe(true);
  await expect(drawer).toBeVisible();
  await expect(page.getByRole('button', { name: '打开导航', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
});

test('task rows, controls and horizontal work surfaces retain their gestures without opening navigation', async ({ page }) => {
  await page.goto('/settings');
  await page.locator('input[type=file]').setInputFiles({
    name: 'sidebar-swipe.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ tasks: [{ id: 'swipe-task', title: 'Keep this task', status: 'todo', parentId: null, order: 0, dueAt: Date.now(), ownerId: 'fixture', tags: [], createdAt: 1, updatedAt: 1 }] })),
  });
  await expect(page.getByText(/已合并备份/)).toBeVisible();
  await page.goto('/tasks?view=list');
  const drawer = page.locator('.workspace-sidebar');
  expect(await swipe(page, '[data-row]', 110)).toBe(false);
  await expect(drawer).toBeHidden();
  expect(await swipe(page, 'input[placeholder="添加任务，按 Enter 保存"]', 110)).toBe(false);
  await expect(drawer).toBeHidden();
  await expect(page.locator('[data-row]')).toHaveCount(1);
  await expect(page.locator('[data-row]')).toContainText('Keep this task');
  // A genuine overflowing descendant must keep horizontal scrolling, even
  // outside the known gantt/mind-map implementations.
  await page.locator('main').evaluate(element => {
    const scroller = document.createElement('div');
    scroller.id = 'sidebar-horizontal-fixture';
    scroller.style.cssText = 'width:200px;height:60px;overflow-x:auto';
    scroller.innerHTML = '<div style="width:600px;height:40px"></div>';
    element.append(scroller);
  });
  expect(await swipe(page, '#sidebar-horizontal-fixture', 110)).toBe(false);
  await expect(drawer).toBeHidden();
  await page.goto('/tasks?view=gantt&scope=week');
  await expect(page.locator('[data-gantt-scroll]')).toBeVisible();
  // Gantt owns horizontal touch paging and may suppress native scrolling.
  await swipe(page, '[data-gantt-scroll]', 110);
  await expect(drawer).toBeHidden();
  await page.goto('/tasks?view=mindmap');
  await expect(page.locator('.react-flow')).toBeVisible();
  expect(await swipe(page, '.react-flow', 110)).toBe(false);
  await expect(drawer).toBeHidden();
});

test('the drawer follows the finger, rebounds a short pull and accepts natural diagonal swipes and quick flicks', async ({ page }) => {
  await page.goto('/tasks?view=list');
  await expect(page.locator('[data-task-list]')).toBeVisible();
  const drawer = page.locator('.workspace-sidebar');
  const preview = await page.locator('[data-task-list]').evaluate(async element => {
    const contact = (x: number) => ({ identifier: 1, target: element, clientX: x, clientY: 400 });
    const dispatch = (type: string, x: number, time: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { touches: { value: type === 'touchend' ? [] : [contact(x)] }, changedTouches: { value: [contact(x)] }, timeStamp: { value: time } });
      element.dispatchEvent(event);
    };
    dispatch('touchstart', 80, 0);
    dispatch('touchmove', 115, 250);
    await new Promise(requestAnimationFrame);
    const sidebar = document.querySelector<HTMLElement>('.workspace-sidebar')!;
    const box = sidebar.getBoundingClientRect();
    const result = { x: box.x, width: box.width, dragging: sidebar.hasAttribute('data-sidebar-dragging'), expanded: document.querySelector('[aria-label="打开导航"]')?.getAttribute('aria-expanded') };
    dispatch('touchend', 115, 400);
    return result;
  });
  expect(preview.dragging).toBe(true);
  expect(preview.x).toBeGreaterThan(-preview.width);
  expect(preview.x).toBeLessThan(-1);
  expect(preview.expanded).toBe('false');
  await expect(drawer).toBeHidden();
  expect(await swipe(page, '[data-task-list]', 85, 40, 1, 1000)).toBe(true);
  await expect(drawer).toBeVisible();
  expect(await swipe(page, '.workspace-navigation-backdrop', -85, 20)).toBe(true);
  await expect(drawer).toBeHidden();
  expect(await swipe(page, '[data-task-list]', 28, 4, 1, 60)).toBe(true);
  await expect(drawer).toBeVisible();
});

test('reduced motion opens and closes the same drawer immediately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/tasks?view=list');
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  const drawer = page.locator('.workspace-sidebar');
  await expect(drawer).toBeVisible();
  expect(await drawer.evaluate(element => getComputedStyle(element).transitionProperty)).toBe('none');
  expect((await drawer.boundingBox())!.x).toBe(0);
  await page.getByRole('button', { name: '关闭导航', exact: true }).click({ position: { x: 380, y: 300 } });
  await expect(drawer).toBeHidden();
});

test('real touch input on blank content opens the drawer without scrolling the app frame', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native touch injection uses Chromium CDP. Intent and exclusions are covered in both engines.');
  await page.goto('/tasks?view=list');
  await expect(page.locator('[data-task-list]')).toBeVisible();
  const box = (await page.locator('[data-task-list]').boundingBox())!;
  const x = box.x + 70, y = box.y + box.height - 35;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (const [offset, vertical] of [[8, 3], [18, 10], [35, 18], [70, 30], [110, 45]]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + offset!, y: y + vertical! }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.workspace-sidebar')).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});
