import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.use({ serviceWorkers: 'block' });
const task = (id: string, patch = {}) => ({ id, title: id, parentId: null, status: 'todo', ownerId: 'fixture', order: 0, tags: [], important: false, urgent: false, createdAt: 1, updatedAt: 1, ...patch });
const shortcuts = (page: Page) => page.getByRole('navigation', { name: '快捷视图', exact: true });
const globalRoot = (page: Page) => page.locator('.react-flow__node[data-id="__cortex_all__"]');
async function seed(page: Page) {
  await page.goto('/settings');
  await page.locator('input[type=file]').setInputFiles({ name: 'workspace.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ tasks: [task('project', { title: '真实项目', kind: 'node', project: true }), task('child', { parentId: 'project', dueAt: Date.now() })] })) });
  await expect(page.getByText(/已合并备份/)).toBeVisible();
  await page.goto('/tasks?view=mindmap&scope=all');
  await expect(globalRoot(page)).toBeVisible();
}

test('shortcut directory collapses independently, remembers its state, and expands only after creating a shortcut', async ({ page }) => {
  await seed(page);
  await expect(globalRoot(page).locator('[data-mind-title]')).toHaveText('我的工作空间');
  const projects = page.getByRole('navigation', { name: '项目', exact: true });
  await page.getByRole('button', { name: '收起快捷视图', exact: true }).click();
  await expect(shortcuts(page)).toBeHidden();
  await expect(projects).toBeVisible();
  await page.reload();
  const expand = page.getByRole('button', { name: '展开快捷视图', exact: true });
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expect(expand).toHaveText('快捷视图1');
  await expand.focus(); await expand.press('Enter');
  const collapse = page.getByRole('button', { name: '收起快捷视图', exact: true });
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
  await expect(shortcuts(page).getByRole('link')).toHaveCount(1);
  await collapse.press('Space');
  await expect(shortcuts(page)).toBeHidden();
  await page.getByRole('button', { name: '添加快捷视图', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '保存快捷视图', exact: true });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(shortcuts(page)).toBeHidden();
  await page.getByRole('button', { name: '添加快捷视图', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '保存快捷视图', exact: true });
  await dialog.getByLabel('视图名称', { exact: true }).fill('新的快捷入口');
  await dialog.getByRole('button', { name: '保存快捷视图', exact: true }).click();
  await expect(shortcuts(page)).toBeVisible();
  await expect(shortcuts(page).getByRole('link', { name: '新的快捷入口', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: '收起快捷视图', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  await expect(shortcuts(page)).toBeHidden();
  await page.getByRole('button', { name: '展开快捷视图', exact: true }).click();
  await expect(shortcuts(page).getByRole('link', { name: '新的快捷入口', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

async function account(context: BrowserContext, prefix: string) {
  const response = await context.request.post('/api/invites', { headers: { Cookie: process.env.E2E_ADMIN_COOKIE! }, data: {} });
  expect(response.ok()).toBe(true);
  const { code } = await response.json();
  const username = `${prefix}_${Date.now()}`;
  expect((await context.request.post('/api/auth/register', { data: { username, password: 'fixture-password', inviteCode: code } })).ok()).toBe(true);
  return username;
}

test('global mind-map root uses the current username, and account changes preserve separate collapse preferences and real project names', async ({ page, context }) => {
  const first = await account(context, 'root_a');
  await seed(page);
  await expect(globalRoot(page).locator('[data-mind-title]')).toHaveText(first);
  await expect(page.locator('.react-flow__edge-path')).toHaveCount(2);
  await page.getByRole('button', { name: '收起快捷视图', exact: true }).click();
  await page.reload();
  await expect(globalRoot(page).locator('[data-mind-title]')).toHaveText(first);
  await expect(shortcuts(page)).toBeHidden();
  await page.goto('/tasks?project=project&view=mindmap&scope=all');
  await expect(globalRoot(page)).toHaveCount(0);
  await expect(page.locator('.react-flow__node[data-id="project"] [data-mind-title]')).toHaveText('真实项目');
  const second = await account(context, 'root_b');
  await seed(page);
  await expect(globalRoot(page).locator('[data-mind-title]')).toHaveText(second);
  await expect(shortcuts(page)).toBeVisible();
  expect((await context.request.post('/api/auth/login', { data: { username: first, password: 'fixture-password' } })).ok()).toBe(true);
  await page.goto('/tasks?view=mindmap&scope=all');
  await expect(globalRoot(page).locator('[data-mind-title]')).toHaveText(first);
  await expect(shortcuts(page)).toBeHidden();
  await page.locator('a[href="/settings"]').first().click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
  const data = JSON.parse(await readFile((await (await downloading).path())!, 'utf8')).data;
  expect(data.tasks).toHaveLength(2);
  expect(data.tasks.some((task: any) => task.id === '__cortex_all__')).toBe(false);
  expect(data.tasks.find((task: any) => task.id === 'project').title).toBe('真实项目');
});
