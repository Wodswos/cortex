import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('mobile navigation stays compact, keeps the home-indicator inset and moves inbox out of primary navigation', async ({ page }) => {
  await page.goto('/tasks');
  const nav = page.getByRole('navigation', { name: '移动导航', exact: true });
  await expect(nav.getByRole('link', { name: '收集箱', exact: true })).toHaveCount(0);
  const bar = (await nav.boundingBox())!;
  expect(bar.height).toBeGreaterThanOrEqual(48);
  expect(bar.height).toBeLessThanOrEqual(49);
  expect((await page.locator('header').boundingBox())!.height).toBe(40);
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--app-safe-area-bottom', '34px');
  });
  await expect.poll(async () => {
    const box = (await nav.boundingBox())!;
    return box.y + box.height;
  }).toBe(810);
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  const inbox = page.locator('.workspace-sidebar').getByRole('link', { name: '收集箱', exact: true });
  await expect(inbox).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(inbox).toBeVisible();
  expect((await page.locator('header').boundingBox())!.height).toBe(48);
});

test('mobile drawer covers the app frame and keeps its contents inside safe areas', async ({ page }) => {
  // Desktop browser emulation has zero safe-area insets. Exercise the same
  // shared inset values that an iPhone supplies to both the frame and drawer.
  await page.goto('/tasks');
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--app-safe-area-top', '59px');
    document.documentElement.style.setProperty('--app-safe-area-bottom', '34px');
    document.documentElement.style.setProperty('--app-safe-area-left', '0px');
    document.documentElement.style.setProperty('--app-safe-area-right', '0px');
  });
  await page.getByRole('button', { name: '打开导航' }).click();
  const drawer = page.locator('.workspace-sidebar');
  const backdrop = page.getByRole('button', { name: '关闭导航' });
  await expect.poll(async () => (await drawer.boundingBox())?.x).toBe(0);
  for (const height of [844, 620]) {
    await page.setViewportSize({ width: 390, height });
    await expect.poll(async () => (await drawer.boundingBox())?.height).toBe(height);
    const panel = (await drawer.boundingBox())!;
    const overlay = (await backdrop.boundingBox())!;
    expect(panel.y).toBe(0);
    expect(panel.x).toBe(0);
    expect(overlay).toEqual({ x: 0, y: 0, width: 390, height });
    const brand = (await drawer.getByRole('link', { name: 'Cortex', exact: true }).boundingBox())!;
    const account = (await drawer.getByRole('link', { name: '设置与账号', exact: true }).boundingBox())!;
    expect(brand.y).toBeGreaterThanOrEqual(59);
    expect(account.y + account.height).toBeLessThanOrEqual(height - 34);
  }
  await backdrop.click({ position: { x: 380, y: 100 } });
  await expect(drawer).toBeHidden();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('mobile drawer follows the visible frame when browser chrome reduces the viewport', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window.visualViewport!, 'height', { get: () => 620 });
  });
  await page.goto('/tasks');
  await page.getByRole('button', { name: '打开导航' }).click();
  await expect.poll(async () => (await page.locator('.workspace-sidebar').boundingBox())?.x).toBe(0);
  const drawer = (await page.locator('.workspace-sidebar').boundingBox())!;
  const backdrop = (await page.getByRole('button', { name: '关闭导航' }).boundingBox())!;
  expect(await page.evaluate(() => window.innerHeight)).toBe(844);
  expect(drawer.y + drawer.height).toBe(620);
  expect(backdrop.y + backdrop.height).toBe(620);
});

test('mobile task panes scroll without moving the app frame or navigation', async ({ page }) => {
  await page.goto('/settings');
  const tasks = Array.from({ length: 45 }, (_, index) => ({
    id: `mobile-${index}`, title: `Mobile task ${index}`, status: 'todo',
    parentId: null, order: index, ownerId: 'fixture', tags: [], createdAt: 1, updatedAt: 1, dueAt: Date.now(),
  }));
  await page.locator('input[type=file]').setInputFiles({
    name: 'mobile-fixture.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ tasks })),
  });
  await expect(page.getByText(/已合并备份/)).toBeVisible();
  await page.goto('/tasks');
  const list = page.locator('[data-task-list]');
  await expect(list.locator('[data-row]')).toHaveCount(45);
  const nav = page.getByRole('navigation', { name: '移动导航' });
  const before = await nav.boundingBox();
  expect(before!.y + before!.height).toBeCloseTo(844, 0);
  await list.evaluate((element) => { element.scrollTop = 600; });
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page.evaluate(() => window.scrollTo(0, 500));
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await nav.boundingBox()).toEqual(before);
});

test('mobile login stays stable and its form remains reachable in a short viewport', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByText('服务器在线', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 360 });
  const user = page.getByPlaceholder('用户名', { exact: true });
  await user.fill('mobile-user');
  expect(await user.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  await page.getByPlaceholder('密码', { exact: true }).fill('fixture-password');
  const localMode = page.getByRole('button', { name: '先用本地模式' });
  await localMode.scrollIntoViewIfNeeded();
  await expect(localMode).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const positions = await localMode.evaluate(async (element) => {
    const values: number[] = [];
    for (let i = 0; i < 12; i++) {
      await new Promise(requestAnimationFrame);
      values.push(element.getBoundingClientRect().top);
    }
    return values;
  });
  expect(Math.max(...positions) - Math.min(...positions)).toBeLessThanOrEqual(1);
  await page.getByTestId('login-scroll').evaluate((element) => { element.scrollTop = 0; });
  await expect(page.getByRole('heading', { name: 'Cortex' })).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(user).toHaveValue('mobile-user');
  await expect(localMode).toBeInViewport();
});
