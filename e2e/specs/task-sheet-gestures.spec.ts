import { test, expect, type Locator, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
const sheetOf = (page: Page) => page.locator('[data-task-sheet]');
async function seed(page: Page) {
  await page.goto('/settings');
  const task = (id: string, patch: Record<string, unknown> = {}) => ({ id, title: id, parentId: null, status: 'todo', ownerId: 'fixture', tags: [], order: 0, createdAt: 1, updatedAt: 1, ...patch });
  const tasks = [task('gesture-project', { title: '手势项目', kind: 'node', project: true }),
    task('pull-task', { title: '下拉详情任务', parentId: 'gesture-project', dueAt: new Date('2026-11-04T20:00:00+08:00').getTime(), notes: Array.from({ length: 60 }, (_, index) => `备注第 ${index + 1} 行`).join('\n') }),
    ...Array.from({ length: 25 }, (_, index) => task(`child-${index}`, { title: `子任务 ${index + 1}`, parentId: 'pull-task', order: index }))];
  await page.locator('input[type=file]').setInputFiles({ name: 'sheet-gestures.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ tasks })) });
  await expect(page.getByText(/已合并备份/)).toBeVisible();
  await page.goto('/tasks?project=gesture-project&view=list&scope=all');
}
async function open(page: Page) {
  await page.locator('[data-row][data-task-id="pull-task"]').getByText('下拉详情任务', { exact: true }).click();
  await expect(sheetOf(page)).toBeVisible();
  await expect(sheetOf(page).getByLabel('任务标题', { exact: true })).toBeVisible();
}
async function touch(target: Locator, type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel', x: number, y: number) {
  await target.evaluate((element, point) => {
    const contact = { identifier: 42, target: element, clientX: point.x, clientY: point.y };
    const touches = point.type === 'touchend' || point.type === 'touchcancel' ? [] : [contact];
    // Desktop WebKit cannot construct Touch. Supply the event's read-only touch
    // lists directly; the separate CDP case below exercises trusted scrolling.
    const event = new Event(point.type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, { touches: { value: touches }, targetTouches: { value: touches }, changedTouches: { value: [contact] } });
    element.dispatchEvent(event);
  }, { type, x, y });
}
async function pull(target: Locator, distance = 130) {
  await touch(target, 'touchstart', 12, 250);
  await touch(target, 'touchmove', 13, 280);
  await touch(target, 'touchmove', 13, 250 + distance);
  await touch(target, 'touchend', 13, 250 + distance);
}

test('top-boundary pull dismisses details and preserves immediate title and notes edits', async ({ page }) => {
  await seed(page); await open(page);
  const sheet = sheetOf(page), body = sheet.locator('[data-sheet-scroll]');
  const title = sheet.getByLabel('任务标题', { exact: true });
  await title.fill('下拉后保留标题');
  await sheet.getByLabel('任务备注', { exact: true }).fill('下拉后保留备注');
  await body.evaluate(element => { element.scrollTop = 0; });
  await pull(sheet.getByText('任务详情', { exact: true }));
  await expect(sheet).toHaveCount(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.reload();
  await page.locator('[data-row][data-task-id="pull-task"]').getByText('下拉后保留标题', { exact: true }).click();
  await expect(sheetOf(page).getByLabel('任务备注', { exact: true })).toHaveValue('下拉后保留备注');
});

test('scrolling in the middle stays open; the same finger can continue pulling after reaching the top', async ({ page }) => {
  await seed(page); await open(page);
  const sheet = sheetOf(page), body = sheet.locator('[data-sheet-scroll]');
  await body.evaluate(element => { element.scrollTop = 200; });
  await touch(body, 'touchstart', 12, 200);
  await touch(body, 'touchmove', 12, 360);
  await expect(sheet).not.toHaveAttribute('data-pull-state', 'dragging');
  await touch(body, 'touchend', 12, 360);
  await expect(sheet).toBeVisible();
  await pull(sheet.getByText('任务详情', { exact: true }));
  await expect(sheet).toBeVisible();
  expect(await body.evaluate(element => element.scrollTop)).toBe(200);
  await touch(body, 'touchstart', 12, 200);
  await touch(body, 'touchmove', 12, 300);
  await body.evaluate(element => { element.scrollTop = 0; });
  await touch(body, 'touchmove', 12, 340);
  await expect(sheet).not.toHaveAttribute('data-pull-state', 'dragging');
  await touch(body, 'touchmove', 12, 460);
  await expect(sheet).toHaveAttribute('data-pull-state', 'dragging');
  await touch(body, 'touchend', 12, 460);
  await expect(sheet).toHaveCount(0);
});

test('short pulls rebound and edits, text selection, controls, sideways movement and multitouch stay intact', async ({ page }) => {
  await seed(page); await open(page);
  const sheet = sheetOf(page), body = sheet.locator('[data-sheet-scroll]');
  await pull(body, 50);
  await expect(sheet).toBeVisible();
  await expect.poll(() => sheet.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m42)).toBe(0);
  const title = sheet.getByLabel('任务标题', { exact: true });
  await pull(title);
  await expect(title).toHaveValue('下拉详情任务');
  await pull(sheet.getByRole('button').first());
  await expect(sheet).toBeVisible();
  await body.evaluate(element => { element.scrollTop = 0; });
  await pull(sheet.getByLabel('任务备注', { exact: true }));
  await expect(sheet).toBeVisible();
  const heading = sheet.getByText('任务详情', { exact: true });
  await heading.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); });
  await pull(heading);
  await expect(sheet).toBeVisible();
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await touch(body, 'touchstart', 12, 250);
  await touch(body, 'touchmove', 150, 260);
  await touch(body, 'touchmove', 150, 430);
  await touch(body, 'touchend', 150, 430);
  await expect(sheet).toBeVisible();
  await touch(body, 'touchstart', 12, 250);
  await touch(body, 'touchmove', 12, 390);
  await touch(body, 'touchcancel', 12, 390);
  await expect(sheet).toBeVisible();
  await touch(body, 'touchstart', 12, 250);
  await touch(body, 'touchmove', 12, 390);
  await body.evaluate(element => {
    const contacts = [42, 43].map((identifier, index) => ({ identifier, target: element, clientX: 12 + index * 20, clientY: 390 }));
    const event = new Event('touchstart', { bubbles: true, cancelable: true });
    Object.defineProperties(event, { touches: { value: contacts }, targetTouches: { value: contacts }, changedTouches: { value: [contacts[1]!] } });
    element.dispatchEvent(event);
  });
  await touch(body, 'touchend', 12, 390);
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button').first().click();
  await expect(sheet).toHaveCount(0);
});

test('lift-off position completes or reverses a pull after the final move event', async ({ page }) => {
  await seed(page); await open(page);
  const sheet = sheetOf(page), body = sheet.locator('[data-sheet-scroll]');
  await touch(body, 'touchstart', 12, 250);
  await touch(body, 'touchmove', 12, 360);
  await touch(body, 'touchend', 12, 330);
  await expect(sheet).toBeVisible();
  await expect.poll(() => sheet.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m42)).toBe(0);
  await touch(body, 'touchstart', 12, 250);
  await touch(body, 'touchmove', 12, 340);
  await touch(body, 'touchend', 12, 360);
  await expect(sheet).toHaveCount(0);
});

test('trusted touch scroll hands off from native scrolling to dismissal at the top', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'The CDP touch injector is Chromium-only; the boundary logic also runs in WebKit above.');
  await seed(page); await open(page);
  const sheet = sheetOf(page), body = sheet.locator('[data-sheet-scroll]');
  await body.evaluate(element => { element.scrollTop = 90; });
  const box = (await body.boundingBox())!;
  const cdp = await context.newCDPSession(page);
  const x = box.x + 8, y = box.y + 90;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let delta = 12; delta <= 84; delta += 12) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + delta }] });
    await page.waitForTimeout(20);
  }
  await expect(sheet).toBeVisible();
  await expect(sheet).not.toHaveAttribute('data-pull-state', 'dragging');
  for (let delta = 96; delta <= 280; delta += 12) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + delta }] });
    await page.waitForTimeout(20);
  }
  await expect.poll(() => body.evaluate(element => element.scrollTop)).toBe(0);
  await expect(sheet).toHaveAttribute('data-pull-state', 'dragging');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(sheet).toHaveCount(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('desktop side drawers keep their existing close and scrolling behavior', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await seed(page);
  await page.getByRole('button', { name: '编辑项目 手势项目', exact: true }).click();
  const sheet = sheetOf(page);
  await expect(sheet).toBeVisible();
  const before = await sheet.boundingBox();
  await pull(sheet.locator('[data-sheet-scroll]'));
  await expect(sheet).toBeVisible();
  expect(await sheet.boundingBox()).toEqual(before);
  await expect(sheet).not.toHaveAttribute('data-pull-state');
  await sheet.getByRole('button').first().click();
  await expect(sheet).toHaveCount(0);
});
