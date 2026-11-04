import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const task = (id: string, patch: Record<string, unknown> = {}) => ({
  id, title: id, parentId: null, status: 'todo', order: 0, ownerId: 'fixture', tags: [],
  important: false, urgent: false, createdAt: 1, updatedAt: 1, ...patch,
});
async function seed(page: Page, data: unknown) {
  await page.goto('/settings');
  await page.locator('input[type=file]').setInputFiles({ name: 'trash.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await expect(page.getByText(/已合并备份/)).toBeVisible();
}
async function exported(page: Page) {
  await page.goto('/settings');
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
  return JSON.parse(await readFile((await (await waiting).path())!, 'utf8')).data;
}
const row = (page: Page, id: string) => page.locator(`[data-trash-id="${id}"]`);
const deletion = (page: Page) => page.getByRole('dialog', { name: '删除项目', exact: true });
async function deleteProject(page: Page, title = 'Project') {
  await page.getByRole('button', { name: `项目 ${title} 菜单`, exact: true }).click();
  await page.getByRole('button', { name: '删除项目', exact: true }).click();
  await deletion(page).getByRole('button', { name: '移入回收站', exact: true }).click();
  await expect(deletion(page)).toHaveCount(0);
}
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  (page as any).__trashErrors = errors;
});
test.afterEach(async ({ page }) => { expect((page as any).__trashErrors).toEqual([]); });

test('project deletion confirms from the sidebar, details and mind-map keyboard, and cancellation never mutates content', async ({ page }) => {
  await seed(page, { tasks: [task('project', { title: 'Project', project: true, kind: 'node' }), task('child', { parentId: 'project' }), task('grandchild', { parentId: 'child' }), task('unrelated')] });
  await page.goto('/tasks?project=project');
  await page.getByRole('button', { name: '项目 Project 菜单', exact: true }).click();
  await page.getByRole('button', { name: '删除项目', exact: true }).click();
  await expect(deletion(page)).toContainText('「Project」');
  await expect(deletion(page)).toContainText('共 3 项');
  await expect(deletion(page).getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await deletion(page).getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Project', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑项目 Project', exact: true }).click();
  const detail = page.getByRole('dialog', { name: '项目详情', exact: true });
  await detail.getByRole('button', { name: '删除', exact: true }).click();
  await expect(deletion(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(deletion(page)).toHaveCount(0);
  await expect(detail).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: '导图', exact: true }).click();
  const root = page.locator('.react-flow__node[data-id="project"]');
  await root.getByText('Project', { exact: true }).click();
  await page.getByRole('region', { name: '任务导图画布', exact: true }).focus();
  await page.keyboard.press('Delete');
  await expect(deletion(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(root).toBeVisible();
  await page.keyboard.press('Delete');
  await deletion(page).getByRole('button', { name: '移入回收站', exact: true }).click();
  await expect(deletion(page)).toHaveCount(0);
  await expect(page).toHaveURL(url => url.pathname === '/tasks' && !url.searchParams.has('project'));
  await page.locator('a[href="/trash"]').click();
  await expect(row(page, 'project')).toBeVisible();
  await expect(row(page, 'grandchild')).toBeVisible();
  await expect(row(page, 'unrelated')).toHaveCount(0);
  await page.reload();
  await expect(row(page, 'project')).toBeVisible();
});

test('trash searches notes, previews deleted content, restores a batch without older deletions, and restores a child with its path', async ({ page }, testInfo) => {
  await seed(page, { tasks: [task('project', { title: 'Project', project: true, kind: 'node' }),
    task('phase', { title: '设计阶段', kind: 'node', project: false, parentId: 'project' }),
    task('child', { title: '中文任务', parentId: 'phase', notes: '关键复盘备注\n第二行内容', status: 'done', completedAt: 1000 }),
    task('sibling', { title: '同级任务', parentId: 'project' }),
    task('old', { title: '之前删除的任务', parentId: 'project', deletedAt: 500 }),
  ] });
  await deleteProject(page);
  await page.locator('a[href="/trash"]').click();
  await expect(page.locator('[data-trash-id]')).toHaveCount(5);
  await page.getByRole('button', { name: '折叠已删除的 Project', exact: true }).click();
  await expect(page.locator('[data-trash-id]')).toHaveCount(1);
  await page.getByLabel('搜索已删除内容', { exact: true }).fill('关键复盘');
  await expect(row(page, 'project')).toBeVisible(); await expect(row(page, 'phase')).toBeVisible(); await expect(row(page, 'child')).toBeVisible();
  await expect(row(page, 'sibling')).toHaveCount(0);
  await page.getByRole('button', { name: '查看已删除的 中文任务', exact: true }).click();
  const preview = page.getByRole('dialog', { name: '已删除内容', exact: true });
  await expect(preview).toContainText('关键复盘备注\n第二行内容');
  await expect(preview).toContainText('Project / 设计阶段');
  await expect(preview).toContainText('已完成');
  await page.keyboard.press('Escape');
  await page.getByLabel('搜索已删除内容', { exact: true }).fill('');
  await page.getByRole('button', { name: '恢复 Project', exact: true }).click();
  await expect(page.getByRole('status', { name: '回收站保存状态', exact: true })).toContainText('已恢复');
  await expect(page.locator('[data-trash-id]')).toHaveCount(1);
  await expect(row(page, 'old')).toBeVisible();
  await page.reload();
  await expect(row(page, 'old')).toBeVisible();
  await deleteProject(page);
  await expect(page.locator('[data-trash-id]')).toHaveCount(5);
  await page.getByRole('button', { name: '恢复 中文任务', exact: true }).click();
  await expect(page.getByRole('status', { name: '回收站保存状态', exact: true })).toContainText('已恢复');
  await expect(page.locator('[data-trash-id]')).toHaveCount(2);
  await expect(row(page, 'sibling')).toBeVisible(); await expect(row(page, 'old')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '恢复 同级任务', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('trash-mobile.png') });
  const data = await exported(page);
  for (const id of ['project', 'phase', 'child']) expect(data.tasks.find((value: any) => value.id === id).deletedAt).toBeNull();
  expect(data.tasks.find((value: any) => value.id === 'child')).toMatchObject({ notes: '关键复盘备注\n第二行内容', status: 'done', parentId: 'phase' });
});

test('permanent deletion and emptying require explicit confirmation, survive reload and do not remove active work', async ({ page }) => {
  await seed(page, { tasks: [task('deleted', { title: '已删除项目', kind: 'node', project: true, deletedAt: 100 }), task('child', { parentId: 'deleted', deletedAt: 100 }), task('another', { title: '另一个已删除任务', deletedAt: 200 }), task('active', { title: '仍在推进', notes: 'keep this' })] });
  await page.locator('a[href="/trash"]').click();
  await page.getByRole('button', { name: '彻底删除 已删除项目', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '彻底删除内容', exact: true });
  await expect(dialog).toContainText('共 2 项');
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(row(page, 'deleted')).toBeVisible();
  await page.getByRole('button', { name: '彻底删除 已删除项目', exact: true }).click();
  await dialog.getByRole('button', { name: '确认彻底删除', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row(page, 'deleted')).toHaveCount(0); await expect(row(page, 'child')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(row(page, 'deleted')).toHaveCount(0);
  await page.getByRole('button', { name: '清空回收站', exact: true }).click();
  const empty = page.getByRole('dialog', { name: '清空回收站', exact: true });
  await expect(empty).toContainText('全部 1 项');
  await page.keyboard.press('Escape');
  await expect(row(page, 'another')).toBeVisible();
  await page.getByRole('button', { name: '清空回收站', exact: true }).click();
  await empty.getByRole('button', { name: '确认彻底删除', exact: true }).click();
  await expect(empty).toHaveCount(0);
  await expect(page.getByText('回收站是空的', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('回收站是空的', { exact: true })).toBeVisible();
  const data = await exported(page);
  expect(data.tasks).toHaveLength(1); expect(data.tasks[0]).toMatchObject({ id: 'active', title: '仍在推进', notes: 'keep this' });
});

async function account(context: BrowserContext, suffix: string) {
  const invite = await context.request.post('/api/invites', { headers: { Cookie: process.env.E2E_ADMIN_COOKIE! }, data: {} });
  expect(invite.ok()).toBe(true);
  const { code } = await invite.json();
  const username = `trash_${suffix}_${Date.now()}`;
  const register = () => context.request.post('/api/auth/register', { data: { username, password: 'fixture-password', inviteCode: code } });
  let response = await register();
  // A full run shares one real server and can exhaust its auth budget. Honor it.
  if (response.status() === 429) {
    const retrySeconds = Number(response.headers()['retry-after']);
    expect(retrySeconds).toBeGreaterThan(0);
    expect(retrySeconds).toBeLessThanOrEqual(60);
    await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1000));
    response = await register();
  }
  expect(response.ok(), `Registration status ${response.status()}`).toBe(true); return username;
}
test('trash restores sync between devices and deleted content is isolated between accounts with identical task IDs', async ({ page, context, browser }) => {
  test.setTimeout(120000);
  const username = await account(context, 'a');
  await seed(page, { tasks: [task('shared', { title: '账户 A 私有项目', kind: 'node', project: true }), task('child', { parentId: 'shared' })] });
  await deleteProject(page, '账户 A 私有项目');
  await page.locator('a[href="/trash"]').click();
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const remote = await other.newPage();
    await account(other, 'b');
    await seed(remote, { tasks: [task('shared', { title: '账户 B 项目', kind: 'node', project: true })] });
    await remote.goto('/trash');
    await expect(remote.getByText('回收站是空的', { exact: true })).toBeVisible();
    await expect(remote.getByText('账户 A 私有项目', { exact: true })).toHaveCount(0);
    const login = await other.request.post('/api/auth/login', { data: { username, password: 'fixture-password' } });
    expect(login.ok()).toBe(true);
    await remote.reload();
    await expect(row(remote, 'shared')).toBeVisible();
    await expect(remote.getByText('账户 B 项目', { exact: true })).toHaveCount(0);
    await remote.getByRole('button', { name: '恢复 账户 A 私有项目', exact: true }).click();
    await expect(page.getByText('回收站是空的', { exact: true })).toBeVisible({ timeout: 15000 });
    await page.reload();
    await expect(page.getByText('回收站是空的', { exact: true })).toBeVisible();
  } finally { await other.close(); }
});
