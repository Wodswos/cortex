import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';
test.use({ serviceWorkers: 'block' });
const now = new Date('2026-11-04T19:59:00+08:00');
const habit = (id: string, patch = {}) => ({ id, name: id, icon: 'Flame', color: '#6b80ae', cadence: { type: 'daily' }, targetPerDay: 1, ownerId: 'fixture', createdAt: new Date('2026-10-01T00:00:00+08:00').getTime(), ...patch });
const row = (page: Page, id: string) => page.locator(`[data-habit-row="${id}"]`);
async function seed(page: Page, data: unknown) {
  await page.goto('/settings');
  await page.locator('input[type=file]').setInputFiles({ name: 'habits.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await expect(page.getByText(/已合并备份/)).toBeVisible();
}
async function exported(page: Page) {
  await page.goto('/settings');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
  const file = await (await downloading).path();
  return JSON.parse(await readFile(file!, 'utf8')).data;
}

test('multi-count check-in fills proportionally, reaches full color and reverses without losing history', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(now);
  await seed(page, { habits: [habit('twice', { name: '早晚阅读', targetPerDay: 2 }), habit('thirds', { name: '喝水', targetPerDay: 3 })] });
  await page.goto('/habits');
  const fill = row(page, 'twice').locator('[data-habit-fill]');
  await expect(fill).toHaveAttribute('style', /height: 0%/);
  await row(page, 'twice').getByRole('button', { name: '为 早晚阅读 打卡', exact: true }).click();
  await expect(row(page, 'twice').getByLabel('今日打卡 1/2', { exact: true })).toBeVisible();
  await expect(fill).toHaveAttribute('style', /height: 50%/);
  await expect.poll(async () => {
    const filled = (await fill.boundingBox())!, button = (await fill.locator('..').boundingBox())!;
    return Math.round(filled.height / (button.height - 2) * 100);
  }).toBe(50);
  await row(page, 'thirds').getByRole('button', { name: '为 喝水 打卡', exact: true }).click();
  await expect.poll(() => row(page, 'thirds').locator('[data-habit-fill]').evaluate(el => parseFloat((el as HTMLElement).style.height))).toBeCloseTo(100 / 3, 2);
  await page.screenshot({ path: testInfo.outputPath('habit-partial-progress.png') });
  await row(page, 'twice').getByRole('button', { name: '为 早晚阅读 打卡', exact: true }).click();
  await expect(row(page, 'twice').getByRole('button', { name: '撤销 早晚阅读 一次打卡', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(fill).toHaveAttribute('style', /height: 100%/);
  await row(page, 'twice').getByRole('button', { name: '撤销 早晚阅读 一次打卡', exact: true }).click();
  await expect(fill).toHaveAttribute('style', /height: 50%/);
  await page.reload(); await expect(fill).toHaveAttribute('style', /height: 50%/);
});

test('multiple daily times can be created, edited, removed and cancelled in a narrow editor', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(now);
  await page.goto('/habits');
  await page.getByRole('button', { name: '新习惯', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '新习惯', exact: true });
  await dialog.getByLabel('习惯名称', { exact: true }).fill('早晚练习');
  await dialog.getByLabel('每日目标次数', { exact: true }).fill('2');
  await dialog.getByLabel('打卡时间', { exact: true }).fill('20:00');
  await dialog.getByRole('button', { name: '添加时间', exact: true }).click();
  await dialog.getByLabel('打卡时间 2', { exact: true }).fill('20:00');
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('不重复');
  await dialog.getByLabel('打卡时间 2', { exact: true }).fill('08:00');
  await expect(dialog.getByText('累计 1 次', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  const item = page.locator('[data-habit-row]').filter({ hasText: '早晚练习' });
  const id = (await item.getAttribute('data-habit-row'))!;
  await item.getByRole('button', { name: '为 早晚练习 打卡', exact: true }).click();
  await expect(item.getByLabel('今日打卡 1/2', { exact: true })).toBeVisible();
  let data = await exported(page);
  expect(data.habits[0]).toMatchObject({ id, reminderTimes: ['08:00', '20:00'], reminderAt: '08:00', targetPerDay: 2 });
  await page.goto('/habits');
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await row(page, id).getByRole('button', { name: '编辑习惯 早晚练习', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '编辑习惯', exact: true });
  await expect(dialog.getByLabel('打卡时间', { exact: true })).toHaveValue('08:00');
  await expect(dialog.getByLabel('打卡时间 2', { exact: true })).toHaveValue('20:00');
  await dialog.getByLabel('打卡时间 2', { exact: true }).fill('21:00');
  await dialog.getByRole('button', { name: '保存修改', exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('habit-multiple-times-mobile.png') });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await row(page, id).getByRole('button', { name: '编辑习惯 早晚练习', exact: true }).click();
  await expect(dialog.getByLabel('打卡时间 2', { exact: true })).toHaveValue('20:00');
  await dialog.getByRole('button', { name: '移除打卡时间 2', exact: true }).click();
  await expect(dialog.getByLabel('打卡时间 2', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  data = await exported(page);
  expect(data.habits[0]).toMatchObject({ id, reminderTimes: ['08:00'], reminderAt: '08:00' });
  expect(data.habitLogs).toHaveLength(1);
});

test('morning progress stops the first reminder and the evening slot has its own persistent snooze', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-04T07:59:00+08:00') });
  await seed(page, { habits: [habit('twice', { name: '早晚阅读', targetPerDay: 2, reminderTimes: ['08:00', '20:00'] })] });
  await page.goto('/habits');
  await expect(row(page, 'twice')).toBeVisible();
  const reminder = page.getByRole('complementary', { name: '习惯提醒', exact: true });
  await expect(reminder).toHaveCount(0);
  await page.clock.fastForward(60000);
  await expect(reminder).toContainText('08:00');
  await row(page, 'twice').getByRole('button', { name: '为 早晚阅读 打卡', exact: true }).click();
  await expect(reminder).toHaveCount(0);
  await page.clock.fastForward(12 * 3600000);
  await expect(reminder).toContainText('20:00');
  await expect(reminder).toContainText('今天 1/2');
  await reminder.getByRole('button', { name: '10 分钟后提醒', exact: true }).click();
  await page.reload(); await expect(reminder).toHaveCount(0);
  await page.clock.fastForward(600000); await expect(reminder).toContainText('20:00');
  await row(page, 'twice').getByRole('button', { name: '为 早晚阅读 打卡', exact: true }).click();
  await expect(reminder).toHaveCount(0);
  await page.clock.fastForward(24 * 3600000); await expect(reminder).toBeVisible();
});

test('Chinese habit creation, timed configuration and editing preserve identity, interval anchor and check-in history', async ({ page, browserName }) => {
  await page.clock.setFixedTime(now);
  await page.goto('/habits');
  await page.getByRole('button', { name: '新习惯', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '新习惯', exact: true });
  const name = dialog.getByLabel('习惯名称', { exact: true });
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await name.focus();
    for (const text of ['y', 'yue', 'yuedu']) {
      await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
      await expect(name).toBeFocused(); await expect(name).toHaveValue(text);
    }
    await name.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 });
    await expect(dialog).toBeVisible();
    await cdp.send('Input.insertText', { text: '阅读中文书' });
    await cdp.detach();
  } else {
    await name.fill('阅读中文书');
  }
  await dialog.getByLabel('每日目标次数', { exact: true }).fill('2');
  await dialog.getByRole('combobox', { name: '习惯频率', exact: true }).selectOption('interval');
  await dialog.getByLabel('间隔天数', { exact: true }).fill('2');
  await dialog.getByLabel('打卡时间', { exact: true }).fill('20:00');
  await expect(dialog.getByRole('checkbox', { name: '到时提醒', exact: true })).toBeChecked();
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const item = page.locator('[data-habit-row]').filter({ hasText: '阅读中文书' });
  const id = (await item.getAttribute('data-habit-row'))!;
  await item.getByRole('button', { name: '为 阅读中文书 打卡', exact: true }).click();
  await item.getByRole('button', { name: '阅读中文书的打卡记录', exact: true }).click();
  await expect(item.locator('[data-habit-day="2026-11-04"]')).toHaveAttribute('data-count', '1');
  await item.getByRole('button', { name: '编辑习惯 阅读中文书', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '编辑习惯', exact: true });
  await expect(dialog.getByLabel('打卡时间', { exact: true })).toHaveValue('20:00');
  await dialog.getByLabel('习惯名称', { exact: true }).fill('认真阅读');
  await dialog.getByLabel('每日目标次数', { exact: true }).fill('3');
  await dialog.getByLabel('打卡时间', { exact: true }).fill('21:30');
  await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(row(page, id).getByLabel('今日打卡 1/3', { exact: true })).toBeVisible();
  const data = await exported(page);
  expect(data.habits).toHaveLength(1);
  expect(data.habits[0]).toMatchObject({ id, name: '认真阅读', createdAt: now.getTime(), cadence: { type: 'interval', everyNDays: 2 }, reminderAt: '21:30', reminderEnabled: true });
  expect(data.habitLogs).toHaveLength(1);
  await page.reload(); await page.goto('/habits');
  await row(page, id).getByRole('button', { name: '认真阅读的打卡记录', exact: true }).click();
  await expect(row(page, id).locator('[data-habit-day="2026-11-04"]')).toHaveAttribute('data-count', '1');
});

test('habit rows form one compact column, accordion toggles and mobile history/editor stay within the viewport', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(now);
  await seed(page, { habits: [habit('read', { name: '阅读', reminderAt: '22:00' }), habit('walk', { name: '步行' })] });
  await page.goto('/habits');
  const a = (await row(page, 'read').boundingBox())!, b = (await row(page, 'walk').boundingBox())!;
  expect(a.x).toBe(b.x); expect(a.width).toBe(b.width); expect(a.y + a.height).toBeLessThanOrEqual(b.y + 1); expect(a.height).toBeLessThan(65);
  const read = row(page, 'read').getByRole('button', { name: '阅读的打卡记录', exact: true });
  await read.click(); await expect(read).toHaveAttribute('aria-expanded', 'true');
  await read.click(); await expect(page.getByRole('region', { name: '阅读打卡详情', exact: true })).toHaveCount(0);
  await read.click();
  await row(page, 'walk').getByRole('button', { name: '步行的打卡记录', exact: true }).click();
  await expect(read).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('region', { name: '步行打卡详情', exact: true })).toBeVisible();
  await expect(page.locator('[data-habit-day]')).toHaveCount(182);
  await page.screenshot({ path: testInfo.outputPath('habits-desktop.png') });
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const walkHistory = row(page, 'walk').getByRole('button', { name: '步行的打卡记录', exact: true });
  await walkHistory.click(); await walkHistory.click();
  await expect(row(page, 'walk').locator('[data-habit-day="2026-11-04"]')).toBeInViewport();
  await row(page, 'walk').getByRole('button', { name: '编辑习惯 步行', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑习惯', exact: true });
  await dialog.getByRole('combobox', { name: '习惯频率', exact: true }).selectOption('weekly-days');
  await dialog.getByLabel('打卡时间', { exact: true }).fill('08:30');
  await dialog.getByRole('button', { name: '保存修改', exact: true }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole('button', { name: '保存修改', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('habits-mobile-editor.png') });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await row(page, 'walk').getByRole('button', { name: '编辑习惯 步行', exact: true }).click();
  await expect(dialog.getByLabel('打卡时间', { exact: true })).toHaveValue('');
});

test('global reminders catch the scheduled time, open the matching history and stop only after the daily target', async ({ page }) => {
  await page.clock.install({ time: now });
  await seed(page, { habits: [habit('read', { name: '阅读', reminderAt: '20:00', targetPerDay: 2 }), habit('rest', { reminderAt: '20:00', cadence: { type: 'weekly', timesPerWeek: 1, days: [2] } })] });
  await page.goto('/tasks');
  await expect(page.getByRole('heading', { name: '当前任务', exact: true })).toBeVisible();
  const reminder = page.getByRole('complementary', { name: '习惯提醒', exact: true });
  await expect(reminder).toHaveCount(0);
  await page.clock.fastForward(60000);
  await expect(reminder).toBeVisible();
  await reminder.getByRole('link', { name: '去打卡 阅读', exact: true }).click();
  await expect(row(page, 'read').getByRole('button', { name: '阅读的打卡记录', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await row(page, 'read').getByRole('button', { name: '为 阅读 打卡', exact: true }).click();
  await expect(reminder).toBeVisible();
  await row(page, 'read').getByRole('button', { name: '为 阅读 打卡', exact: true }).click();
  await expect(reminder).toHaveCount(0);
  await page.goto('/tasks'); await expect(reminder).toHaveCount(0);
  await page.clock.fastForward(24 * 3600000);
  await expect(reminder).toBeVisible();
});

test('closing a reminder persists for that habit and time, preserves check-ins and leaves later slots and days active', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-04T08:00:00+08:00') });
  await seed(page, { habits: [habit('twice', { name: '早晚阅读', targetPerDay: 2, reminderTimes: ['08:00', '20:00'] }), habit('walk', { name: '散步', reminderAt: '08:00' })] });
  await page.goto('/habits');
  const reminder = page.getByRole('complementary', { name: '习惯提醒', exact: true });
  await expect(reminder).toContainText('早晚阅读');
  await reminder.getByRole('button', { name: '关闭本次习惯提醒', exact: true }).click();
  await expect(reminder).toContainText('散步');
  await reminder.getByRole('button', { name: '关闭本次习惯提醒', exact: true }).click();
  await expect(reminder).toHaveCount(0);
  await expect(row(page, 'twice').getByLabel('今日打卡 0/2', { exact: true })).toBeVisible();
  await page.reload(); await expect(reminder).toHaveCount(0);
  await page.clock.fastForward(600000); await expect(reminder).toHaveCount(0);
  await page.getByRole('navigation', { name: '工作导航', exact: true }).getByRole('link', { name: '当前任务', exact: true }).click();
  await page.clock.fastForward(12 * 3600000 - 600000);
  await expect(reminder).toContainText('早晚阅读'); await expect(reminder).toContainText('20:00');
  await reminder.getByRole('button', { name: '关闭本次习惯提醒', exact: true }).click();
  await expect(reminder).toHaveCount(0);
  await page.reload(); await expect(reminder).toHaveCount(0);
  await page.clock.fastForward(24 * 3600000);
  await expect(reminder).toBeVisible();
});

test('closing a reminder still works when browser storage cannot be written', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-11-04T20:00:00+08:00') });
  await seed(page, { habits: [habit('read', { name: '阅读', reminderAt: '20:00' })] });
  await page.goto('/habits');
  const reminder = page.getByRole('complementary', { name: '习惯提醒', exact: true });
  await expect(reminder).toBeVisible();
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Storage blocked', 'SecurityError'); }; });
  await reminder.getByRole('button', { name: '关闭本次习惯提醒', exact: true }).click();
  await expect(reminder).toHaveCount(0);
  await page.clock.fastForward(60000); await expect(reminder).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '习惯', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('snooze survives reload, and switching off or clearing time cancels reminders without deleting history', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-04T20:00:00+08:00') });
  await seed(page, { habits: [habit('read', { name: '阅读', reminderAt: '20:00' })] });
  await page.goto('/tasks');
  const reminder = page.getByRole('complementary', { name: '习惯提醒', exact: true });
  await reminder.getByRole('button', { name: '10 分钟后提醒', exact: true }).click();
  await expect(reminder).toHaveCount(0);
  await page.reload(); await expect(reminder).toHaveCount(0);
  await page.clock.fastForward(600000); await expect(reminder).toBeVisible();
  await reminder.getByRole('link', { name: '去打卡 阅读', exact: true }).click();
  await row(page, 'read').getByRole('button', { name: '编辑习惯 阅读', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '编辑习惯', exact: true });
  await dialog.getByRole('checkbox', { name: '到时提醒', exact: true }).uncheck();
  await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(reminder).toHaveCount(0);
  await expect(row(page, 'read').getByLabel('打卡时间 20:00', { exact: true })).toBeVisible();
  await row(page, 'read').getByRole('button', { name: '编辑习惯 阅读', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '编辑习惯', exact: true });
  await dialog.getByRole('button', { name: '清除时间', exact: true }).click();
  await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(row(page, 'read').getByText('20:00', { exact: true })).toHaveCount(0);
  await page.reload(); await expect(reminder).toHaveCount(0);
});

test('deleting a habit requires confirmation and undo restores its check-ins', async ({ page }) => {
  await page.clock.setFixedTime(now);
  await seed(page, { habits: [habit('read', { name: '阅读' })], habitLogs: [{ id: 'log', habitId: 'read', date: '2026-11-04', count: 1, ownerId: 'fixture' }] });
  await page.goto('/habits');
  await row(page, 'read').getByRole('button', { name: '阅读的打卡记录', exact: true }).click();
  await row(page, 'read').getByRole('button', { name: '删除习惯', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除习惯', exact: true });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(row(page, 'read').locator('[data-habit-day="2026-11-04"]')).toHaveAttribute('data-count', '1');
  await row(page, 'read').getByRole('button', { name: '删除习惯', exact: true }).click();
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(row(page, 'read')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销 (⌘Z)', exact: true }).click();
  await expect(row(page, 'read')).toBeVisible();
  await expect(row(page, 'read').locator('[data-habit-day="2026-11-04"]')).toHaveAttribute('data-count', '1');
});

async function register(context: BrowserContext, prefix: string) {
  const invite = await context.request.post('/api/invites', { headers: { Cookie: process.env.E2E_ADMIN_COOKIE! }, data: {} });
  expect(invite.ok()).toBe(true);
  const { code } = await invite.json(); const username = `${prefix}_${Date.now()}`;
  expect((await context.request.post('/api/auth/register', { data: { username, password: 'fixture-password', inviteCode: code } })).ok()).toBe(true);
  return username;
}
test('habit edits and check-ins sync to another device and stay private to their account', async ({ page, context, browser, baseURL }) => {
  const username = await register(context, 'habit_owner');
  await page.goto('/habits');
  await page.getByRole('button', { name: '新习惯', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新习惯', exact: true });
  await dialog.getByLabel('习惯名称', { exact: true }).fill('Private reading');
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await page.getByRole('button', { name: '为 Private reading 打卡', exact: true }).click();
  const peer = await browser.newContext({ baseURL, serviceWorkers: 'block' }), other = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  try {
    expect((await peer.request.post('/api/auth/login', { data: { username, password: 'fixture-password' } })).ok()).toBe(true);
    const second = await peer.newPage(); await second.goto('/habits');
    await expect(second.getByRole('button', { name: '撤销 Private reading 一次打卡', exact: true })).toBeVisible({ timeout: 15000 });
    await second.getByRole('button', { name: '编辑习惯 Private reading', exact: true }).click();
    const edit = second.getByRole('dialog', { name: '编辑习惯', exact: true });
    await edit.getByLabel('习惯名称', { exact: true }).fill('Private edited');
    await edit.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(page.getByRole('button', { name: '编辑习惯 Private edited', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '编辑习惯 Private edited', exact: true }).click();
    const originalEditor = page.getByRole('dialog', { name: '编辑习惯', exact: true });
    await originalEditor.getByLabel('习惯名称', { exact: true }).fill('Private final');
    await second.getByRole('button', { name: '编辑习惯 Private edited', exact: true }).click();
    await edit.getByLabel('打卡时间', { exact: true }).fill('23:50');
    await edit.getByRole('button', { name: '添加时间', exact: true }).click();
    await edit.getByLabel('打卡时间 2', { exact: true }).fill('23:55');
    await edit.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(page.locator('[data-habit-row]').getByText('23:50', { exact: true })).toBeVisible();
    await originalEditor.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(second.getByRole('button', { name: '编辑习惯 Private final', exact: true })).toBeVisible();
    await expect(second.locator('[data-habit-row]').getByText('23:50', { exact: true })).toBeVisible();
    await expect(second.getByLabel('打卡时间 23:50、23:55，提醒已开启', { exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: '习惯排序方式', exact: true }).selectOption('manual');
    await expect(second.getByRole('combobox', { name: '习惯排序方式', exact: true })).toHaveValue('manual');
    await register(other, 'habit_other');
    const outsider = await other.newPage(); await outsider.goto('/habits');
    await expect(outsider.getByText('种下第一个习惯', { exact: true })).toBeVisible();
    await expect(outsider.getByRole('combobox', { name: '习惯排序方式', exact: true })).toHaveValue('time');
    await expect(outsider.getByText('Private final', { exact: true })).toHaveCount(0);
  } finally { await peer.close(); await other.close(); }
});

test('time sorting, keyboard reordering, cancellation and edits preserve a remembered manual order without changing check-ins', async ({ page }) => {
  await page.clock.setFixedTime(now);
  const base = new Date('2026-10-01T12:00:00+08:00').getTime();
  await seed(page, { habits: [
    habit('late', { name: '晚间阅读', reminderAt: '21:30', reminderEnabled: false, createdAt: base }),
    habit('anytime', { name: '随时散步', createdAt: base + 1 }),
    habit('morning', { name: '晨间拉伸', reminderAt: '08:00', reminderEnabled: false, createdAt: base + 2 }),
    habit('noon', { name: '午间休息', reminderAt: '12:30', reminderEnabled: false, createdAt: base + 3 }),
  ], habitLogs: [{ id: 'existing', habitId: 'anytime', date: '2026-11-04', count: 1, ownerId: 'fixture' }] });
  await page.goto('/habits');
  const order = () => page.locator('[data-habit-row]').evaluateAll(elements => elements.map(element => element.getAttribute('data-habit-row')));
  const sort = page.getByRole('combobox', { name: '习惯排序方式', exact: true });
  await expect(sort).toHaveValue('time');
  await expect.poll(order).toEqual(['morning', 'noon', 'late', 'anytime']);
  const handle = page.getByRole('button', { name: '拖动习惯 随时散步 排序', exact: true });
  await handle.focus(); await handle.press('Space');
  await expect(handle).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 0)));
  await handle.press('ArrowUp');
  await expect(page.getByRole('status').filter({ hasText: '习惯 随时散步 移到 晚间阅读 位置' })).toHaveCount(1);
  await handle.press('Space');
  await expect(sort).toHaveValue('manual');
  await expect.poll(order).toEqual(['morning', 'noon', 'anytime', 'late']);
  await page.reload(); await expect.poll(order).toEqual(['morning', 'noon', 'anytime', 'late']);
  await sort.selectOption('time'); await expect.poll(order).toEqual(['morning', 'noon', 'late', 'anytime']);
  await handle.focus(); await handle.press('Space');
  await expect(handle).toHaveAttribute('aria-pressed', 'true');
  await handle.press('Escape');
  await expect(sort).toHaveValue('time');
  await expect.poll(order).toEqual(['morning', 'noon', 'late', 'anytime']);
  await row(page, 'late').getByRole('button', { name: '编辑习惯 晚间阅读', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑习惯', exact: true });
  await dialog.getByLabel('打卡时间', { exact: true }).fill('05:45');
  await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect.poll(order).toEqual(['late', 'morning', 'noon', 'anytime']);
  await sort.selectOption('manual'); await expect.poll(order).toEqual(['morning', 'noon', 'anytime', 'late']);
  const data = await exported(page);
  expect(data.settings).toMatchObject({ habitSort: 'manual', habitOrder: ['morning', 'noon', 'anytime', 'late'] });
  expect(data.habitLogs).toHaveLength(1); expect(data.habitLogs[0]).toMatchObject({ id: 'existing', count: 1 });
});

test('habit grips support mouse and touch dragging without opening history or overflowing the mobile header', async ({ page, browserName }) => {
  await seed(page, { habits: [habit('a', { name: '阅读' }), habit('b', { name: '步行' }), habit('c', { name: '练习' })] });
  await page.goto('/habits');
  const order = () => page.locator('[data-habit-row]').evaluateAll(elements => elements.map(element => element.getAttribute('data-habit-row')));
  const source = row(page, 'c').getByRole('button', { name: '拖动习惯 练习 排序', exact: true });
  await row(page, 'c').hover();
  let start = (await source.boundingBox())!, end = (await row(page, 'a').boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2 - 8, { steps: 3 });
  await page.mouse.move(end.x + 15, end.y + end.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect.poll(order).toEqual(['c', 'a', 'b']);
  await expect(page.locator('[data-habit-day]')).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 640 });
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    const touchHandle = row(page, 'b').getByRole('button', { name: '拖动习惯 步行 排序', exact: true });
    await expect(touchHandle).toHaveCSS('opacity', '1');
    start = (await touchHandle.boundingBox())!; end = (await row(page, 'c').boundingBox())!;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x + start.width / 2, y: start.y + start.height / 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: end.x + 15, y: end.y + end.height / 2 + 8 }] });
    await expect(touchHandle).toHaveAttribute('aria-pressed', 'true');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: end.x + 15, y: end.y + end.height / 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await expect.poll(order).toEqual(['b', 'c', 'a']);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
