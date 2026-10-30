import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('mobile task panes scroll without moving the app frame or navigation', async ({ page }) => {
  await page.goto('/settings');
  const tasks = Array.from({ length: 45 }, (_, index) => ({
    id: `mobile-${index}`, title: `Mobile task ${index}`, status: 'todo',
    parentId: null, order: index, ownerId: 'fixture', tags: [], createdAt: 1, updatedAt: 1,
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
