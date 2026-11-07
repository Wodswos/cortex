import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.use({ serviceWorkers: 'block' });
const now = new Date('2026-11-04T12:00:00+08:00');
const start = new Date('2026-11-03T00:00:00+08:00').getTime();
const due = new Date('2026-11-06T18:00:00+08:00').getTime();
const task = (id: string, patch = {}) => ({ id, title: id, parentId: 'project', status: 'todo', ownerId: 'fixture', order: 0, tags: [], important: false, urgent: false, createdAt: 1, updatedAt: 1, ...patch });
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
async function seed(page: Page, tasks: unknown[], events: unknown[] = []) {
  await page.clock.setFixedTime(now);
  await page.goto('/settings');
  await page.locator('input[type=file]').setInputFiles({ name: 'dates.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ tasks: [task('project', { parentId: null, kind: 'node', project: true }), ...tasks], events })) });
  await expect(page.getByText(/已合并备份/)).toBeVisible();
  await page.goto('/tasks?project=project&view=mindmap&scope=all');
}
async function clearDates(page: Page, id: string) {
  await node(page, id).click({ button: 'right' });
  await page.getByRole('button', { name: '设定时间', exact: true }).hover();
  await page.getByRole('button', { name: '清除日期', exact: true }).click();
  await expect(page.getByRole('button', { name: '设定时间', exact: true })).toHaveCount(0);
}
async function exported(page: Page) {
  await page.locator('a[href="/settings"]').first().click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
  return JSON.parse(await readFile((await (await downloading).path())!, 'utf8')).data;
}

test('clear dates removes a remaining start date and its week signal, persists through reload and changes date-filter membership', async ({ page }) => {
  await seed(page, [task('start_only', { title: '操作系统与并发基础', startAt: start, dueAt: null })]);
  await expect(node(page, 'start_only').getByText('本周安排', { exact: true })).toBeVisible();
  await clearDates(page, 'start_only');
  await expect(node(page, 'start_only').getByText('本周安排', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(node(page, 'start_only')).toBeVisible();
  await expect(node(page, 'start_only').getByText('本周安排', { exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: '列表', exact: true }).click();
  await page.getByRole('region', { name: '工作概览', exact: true }).getByRole('button', { name: '本周', exact: true }).click();
  await expect(page.locator('[data-row][data-task-id="start_only"]')).toHaveCount(0);
  await page.getByRole('combobox', { name: '任务时间范围', exact: true }).selectOption('undated');
  await expect(page.locator('[data-row][data-task-id="start_only"]')).toBeVisible();
  const data = await exported(page);
  expect(data.tasks.find((value: any) => value.id === 'start_only')).toMatchObject({ startAt: null, dueAt: null });
});

test('batch clearing both endpoints is a single undoable action and preserves unrelated fields and tasks', async ({ page }) => {
  await seed(page, [task('alpha', { startAt: start, dueAt: due, notes: '保留笔记', status: 'doing', priority: 'P1' }), task('beta', { startAt: start, dueAt: null }), task('unrelated', { dueAt: due })]);
  await node(page, 'alpha').locator('[data-mind-title]').click();
  await node(page, 'beta').locator('[data-mind-title]').click({ modifiers: ['ControlOrMeta'] });
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
  await clearDates(page, 'alpha');
  await expect(node(page, 'beta').getByText('本周安排', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '撤销 (⌘Z)', exact: true }).click();
  await expect(node(page, 'beta').getByText('本周安排', { exact: true })).toBeVisible();
  let data = await exported(page);
  expect(data.tasks.find((value: any) => value.id === 'alpha')).toMatchObject({ startAt: start, dueAt: due });
  expect(data.tasks.find((value: any) => value.id === 'beta')).toMatchObject({ startAt: start, dueAt: null });
  await page.getByRole('button', { name: '重做 (⌘⇧Z)', exact: true }).click();
  data = await exported(page);
  expect(data.tasks.find((value: any) => value.id === 'alpha')).toMatchObject({ startAt: null, dueAt: null, notes: '保留笔记', status: 'doing', priority: 'P1' });
  expect(data.tasks.find((value: any) => value.id === 'beta')).toMatchObject({ startAt: null, dueAt: null });
  expect(data.tasks.find((value: any) => value.id === 'unrelated')).toMatchObject({ dueAt: due });
});

test('clearing task dates preserves linked calendar events', async ({ page }) => {
  const event = { id: 'meeting', taskId: 'scheduled', title: '关联日程', start, end: start + 3600000, kind: 'meeting', ownerId: 'fixture', createdAt: 1, updatedAt: 1 };
  await seed(page, [task('scheduled', { startAt: start, dueAt: due })], [event]);
  await clearDates(page, 'scheduled');
  const data = await exported(page);
  expect(data.tasks.find((value: any) => value.id === 'scheduled')).toMatchObject({ startAt: null, dueAt: null });
  expect(data.events.find((value: any) => value.id === 'meeting')).toMatchObject({ ...event, ownerId: 'local' });
});

test('cleared endpoints sync to another device and stay cleared after reloading it', async ({ page, context, browser, baseURL }) => {
  const invite = await context.request.post('/api/invites', { headers: { Cookie: process.env.E2E_ADMIN_COOKIE! }, data: {} });
  expect(invite.ok()).toBe(true);
  const { code } = await invite.json();
  const username = `dates_${Date.now()}`;
  expect((await context.request.post('/api/auth/register', { data: { username, password: 'fixture-password', inviteCode: code } })).ok()).toBe(true);
  await seed(page, [task('synced', { startAt: start, dueAt: due })]);
  const peer = await browser.newContext({ baseURL, serviceWorkers: 'block', timezoneId: 'Asia/Shanghai' });
  try {
    expect((await peer.request.post('/api/auth/login', { data: { username, password: 'fixture-password' } })).ok()).toBe(true);
    const second = await peer.newPage();
    await second.clock.setFixedTime(now);
    await second.goto('/tasks?project=project&view=mindmap&scope=all');
    await expect(node(second, 'synced').getByText('本周安排', { exact: true })).toBeVisible({ timeout: 15000 });
    await clearDates(page, 'synced');
    await expect(node(second, 'synced').getByText('本周安排', { exact: true })).toHaveCount(0);
    await second.reload();
    await expect(node(second, 'synced')).toBeVisible();
    await expect(node(second, 'synced').getByText('本周安排', { exact: true })).toHaveCount(0);
    const data = await exported(second);
    expect(data.tasks.find((value: any) => value.id === 'synced')).toMatchObject({ startAt: null, dueAt: null });
  } finally { await peer.close(); }
});
