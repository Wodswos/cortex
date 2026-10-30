import { test, expect } from '@playwright/test';

test('registration explains validation errors and accepts a hyphenated username', async ({ page, browser, browserName, baseURL }) => {
  const response = await page.request.post('/api/invites', {
    headers: { Cookie: process.env.E2E_ADMIN_COOKIE! },
    data: {},
  });
  expect(response.ok()).toBeTruthy();
  const { code } = await response.json();
  const username = browserName === 'chromium' ? 'zehua-test' : `zehua-test-${browserName}`;
  const password = 'zehua-test';

  await page.goto('/login');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByPlaceholder('用户名', { exact: true }).fill('zehua.test');
  await page.getByPlaceholder('密码', { exact: true }).fill(password);
  await page.getByPlaceholder('邀请码', { exact: true }).fill(code);
  await page.getByRole('button', { name: '创建账号', exact: true }).click();
  await expect(page.getByText('用户名需 2–32 位，仅支持中文、字母、数字、下划线（_）和连字符（-）', { exact: true })).toBeVisible();

  await page.getByPlaceholder('用户名', { exact: true }).fill(username);
  await page.getByPlaceholder('密码', { exact: true }).fill('short');
  await page.getByRole('button', { name: '创建账号', exact: true }).click();
  await expect(page.getByText('密码需 6–1024 位', { exact: true })).toBeVisible();

  await page.getByPlaceholder('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '创建账号', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto('/settings');
  await expect(page.getByRole('main').getByText(username, { exact: true })).toBeVisible();

  const context = await browser.newContext({ baseURL });
  try {
    const login = await context.newPage();
    await login.goto('/login');
    await login.getByPlaceholder('用户名', { exact: true }).fill(username);
    await login.getByPlaceholder('密码', { exact: true }).fill(password);
    await login.getByRole('button', { name: '登录', exact: true }).last().click();
    await expect(login).not.toHaveURL(/\/login/);
    const me = await context.request.get('/api/auth/me');
    expect(me.status()).toBe(200);
    expect(await me.json()).toMatchObject({ username });
  } finally {
    await context.close();
  }
});
