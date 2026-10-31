import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const date = '2026-10-25';
const fixedNow = new Date(`${date}T22:00:00+08:00`);
const facts = { capturedAt: fixedNow.getTime(), completed: [], pending: [], focusMin: 0, projects: [] };
const prior = (kind: 'daily' | 'weekly', start: string, end: string) => ({
  id: `${kind}_${start}`, kind, periodStart: start, periodEnd: end, highlights: 'Earlier reflection', friction: '', nextSteps: '', facts,
  completedAt: fixedNow.getTime(), createdAt: 1, updatedAt: 1, ownerId: 'fixture',
});
async function seed(page: Page, data: unknown) {
  await page.goto('/settings');
  await page.locator('input[type=file]').setInputFiles({ name: 'reviews.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await expect(page.getByText(/已合并备份/)).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  (page as any).__reviewErrors = errors;
});
test.afterEach(async ({ page }) => { expect((page as any).__reviewErrors).toEqual([]); });

test('daily reviews preserve IME drafts across immediate navigation, finalize facts and export Markdown', async ({ page, browserName }) => {
  await page.clock.install({ time: fixedNow });
  const doneAt = new Date(`${date}T18:00:00+08:00`).getTime();
  await seed(page, { tasks: [{ id: 'report_done', title: 'Ship prototype', status: 'done', parentId: null, order: 0, tags: [], ownerId: 'fixture', createdAt: 1, updatedAt: 1, completedAt: doneAt }],
    sessions: [{ id: 'report_focus', taskId: 'report_done', startedAt: doneAt - 1800000, endedAt: doneAt, plannedMin: 30, actualMin: 25, mode: 'focus', completed: true, ownerId: 'fixture' }] });
  await page.goto(`/reviews?kind=daily&date=${date}`);
  const highlight = page.getByRole('textbox', { name: '今天需要推进什么／真正推进了什么？', exact: true });
  await expect(page.getByTestId('review-completed-count')).toHaveText('1项');
  await expect(page.getByTestId('review-focus-duration')).toHaveText('25m');
  if (browserName === 'chromium') {
    await highlight.focus();
    const cdp = await page.context().newCDPSession(page);
    for (const text of ['w', 'wan', 'wancheng']) {
      await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
      await expect(highlight).toBeFocused(); await expect(highlight).toHaveValue(text);
    }
    await cdp.send('Input.insertText', { text: '完成原型，确认关键交互' }); await cdp.detach();
  } else await highlight.fill('完成原型，确认关键交互');
  await page.getByRole('textbox', { name: '哪里卡住了，为什么？', exact: true }).fill('反馈太晚，明天先沟通');
  await page.getByRole('textbox', { name: '明天最重要的一步是什么？', exact: true }).fill('约一次原型评审');
  await page.getByRole('navigation', { name: '工作导航' }).getByRole('link', { name: '全部任务', exact: true }).click();
  await page.getByRole('navigation', { name: '工具' }).getByRole('link', { name: '复盘', exact: true }).click();
  await expect(highlight).toHaveValue('完成原型，确认关键交互');
  await expect(page.getByRole('textbox', { name: '明天最重要的一步是什么？', exact: true })).toHaveValue('约一次原型评审');
  await page.reload(); await expect(highlight).toHaveValue('完成原型，确认关键交互');
  await page.getByRole('button', { name: '完成复盘', exact: true }).click();
  await expect(page.getByRole('button', { name: '继续编辑', exact: true })).toBeVisible();
  await expect(highlight).toHaveAttribute('readonly', '');
  await page.getByRole('region', { name: '工作回顾', exact: true }).getByRole('button', { name: /Ship prototype/ }).click();
  await page.getByRole('textbox', { name: '任务标题', exact: true }).fill('Renamed after review');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: '工作回顾', exact: true }).getByRole('button', { name: /Ship prototype/ })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出复盘 Markdown', exact: true }).click();
  const file = await (await downloading).path();
  const markdown = await readFile(file!, 'utf8');
  expect(markdown).toContain('完成原型，确认关键交互'); expect(markdown).toContain('Ship prototype'); expect(markdown).toContain('25 分钟');
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(highlight).not.toHaveAttribute('readonly', '');
  await expect(page.getByRole('region', { name: '工作回顾', exact: true }).getByRole('button', { name: /Renamed after review/ })).toBeVisible();
});

test('opening periods creates no empty history; weekly review includes daily entries and remains usable on mobile', async ({ page }) => {
  await page.clock.install({ time: fixedNow });
  await page.goto('/reviews');
  await expect(page.getByRole('navigation', { name: '历史复盘' }).getByRole('link')).toHaveCount(0);
  await page.getByRole('button', { name: '上一期复盘', exact: true }).click();
  await expect(page.getByLabel('复盘日期', { exact: true })).toHaveValue('2026-10-24');
  await page.getByRole('button', { name: '下一期复盘', exact: true }).click();
  await expect(page.getByLabel('复盘日期', { exact: true })).toHaveValue(date);
  await expect(page.getByRole('navigation', { name: '历史复盘' }).getByRole('link')).toHaveCount(0);
  await page.getByRole('textbox', { name: '今天需要推进什么／真正推进了什么？', exact: true }).fill('Important daily insight');
  await page.getByRole('button', { name: '完成复盘', exact: true }).click();
  await page.getByRole('tab', { name: '周报', exact: true }).click();
  await expect(page.getByRole('heading', { name: '2026-10-19 ～ 2026-10-25', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '本周日报' }).getByText('Important daily insight', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '本周真正推进了什么？', exact: true }).fill('Focus on the right project');
  await page.getByRole('button', { name: '完成复盘', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '历史复盘' }).getByRole('link')).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '继续编辑', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: '继续编辑', exact: true })).toBeInViewport();
  await page.getByText('复盘提醒', { exact: true }).click();
  await expect(page.getByLabel('日报提醒时间', { exact: true })).toHaveValue('21:30');
  await expect(page.getByLabel('周报提醒时间', { exact: true })).toHaveValue('20:00');
  await expect(page.getByRole('combobox', { name: '周报提醒星期', exact: true })).toHaveValue('0');
});

test('due reminders appear at Sunday 20:00 and daily 21:30, snooze and stop after completion', async ({ page }) => {
  await page.clock.install({ time: new Date(`${date}T19:59:00+08:00`) });
  await seed(page, { reviews: [prior('weekly', '2026-10-12', '2026-10-19'), prior('daily', '2026-10-24', '2026-10-25')] });
  await page.goto('/tasks');
  const reminder = page.getByRole('complementary', { name: '复盘提醒', exact: true });
  await expect(reminder).toHaveCount(0);
  await page.clock.fastForward(60000);
  await expect(reminder.getByRole('link', { name: '开始复盘', exact: true })).toHaveAttribute('title', '2026-10-19 · 周报待复盘');
  await reminder.getByRole('button', { name: '一小时后再提醒复盘', exact: true }).click();
  await expect(reminder).toHaveCount(0);
  await page.clock.fastForward(3600000);
  await expect(reminder).toBeVisible();
  await reminder.getByRole('link', { name: '开始复盘', exact: true }).click();
  await page.getByRole('textbox', { name: '本周真正推进了什么？', exact: true }).fill('A quieter week, with a clearer direction');
  await page.getByRole('button', { name: '完成复盘', exact: true }).click();
  await page.getByRole('navigation', { name: '工作导航' }).getByRole('link', { name: '全部任务', exact: true }).click();
  await expect(reminder).toHaveCount(0);
  await page.clock.fastForward(1800000);
  await expect(reminder.getByRole('link', { name: '开始复盘', exact: true })).toHaveAttribute('title', '2026-10-25 · 日报待复盘');
});

async function register(context: BrowserContext, label: string) {
  const invite = await context.request.post('/api/invites', { headers: { Cookie: process.env.E2E_ADMIN_COOKIE! }, data: {} });
  expect(invite.ok()).toBe(true);
  const { code } = await invite.json();
  const username = `review_${label}_${Date.now()}`;
  const response = await context.request.post('/api/auth/register', { data: { username, password: 'fixture-password', inviteCode: code } });
  expect(response.ok()).toBe(true); return username;
}

test('reviews sync between devices and are isolated between accounts', async ({ page, context, browser, baseURL }) => {
  const username = await register(context, 'owner');
  await page.goto(`/reviews?kind=daily&date=${date}`);
  await page.getByRole('textbox', { name: '今天需要推进什么／真正推进了什么？', exact: true }).fill('Private account reflection');
  await page.getByRole('heading', { name: '复盘', exact: true }).click();
  await expect(page.getByRole('status', { name: '复盘保存状态' })).toHaveText('已保存');
  const otherDevice = await browser.newContext({ baseURL });
  const otherAccount = await browser.newContext({ baseURL });
  try {
    const login = await otherDevice.request.post('/api/auth/login', { data: { username, password: 'fixture-password' } });
    expect(login.ok()).toBe(true);
    const devicePage = await otherDevice.newPage();
    await devicePage.goto(`/reviews?kind=daily&date=${date}`);
    await expect(devicePage.getByRole('textbox', { name: '今天需要推进什么／真正推进了什么？', exact: true })).toHaveValue('Private account reflection');
    await register(otherAccount, 'other');
    const isolatedPage = await otherAccount.newPage();
    await isolatedPage.goto(`/reviews?kind=daily&date=${date}`);
    await expect(isolatedPage.getByRole('textbox', { name: '今天需要推进什么／真正推进了什么？', exact: true })).toHaveValue('');
    await expect(isolatedPage.getByRole('navigation', { name: '历史复盘' }).getByRole('link')).toHaveCount(0);
  } finally { await otherDevice.close(); await otherAccount.close(); }
});
