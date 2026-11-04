import { expect, test, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const time = new Date('2026-11-04T20:00:00+08:00');
const habit = (id: string, name: string, reminderAt = '20:00') => ({ id, name, icon: 'Flame', color: '#6b80ae', cadence: { type: 'daily' }, targetPerDay: 1, reminderAt, ownerId: 'fixture', createdAt: time.getTime() - 86400000 });
const hint = (page: Page) => page.getByRole('complementary', { name: '习惯提醒', exact: true });
async function seed(page: Page) {
  await page.clock.install({ time });
  await page.goto('/settings');
  await page.locator('input[type=file]').setInputFiles({ name: 'reminders.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ habits: [habit('reading', '阅读'), habit('water', '喝水'), habit('walk', '散步', '21:00')] })) });
  await expect(page.getByText(/已合并备份/)).toBeVisible();
  await page.goto('/tasks');
  await expect(hint(page)).toBeVisible();
}

test('closing a reminder quiets the current batch across reload without checking in or disabling later reminders', async ({ page }) => {
  await seed(page);
  await hint(page).getByRole('button', { name: '关闭本次习惯提醒', exact: true }).click();
  await expect(hint(page)).toHaveCount(0);
  await page.reload();
  await expect(hint(page)).toHaveCount(0);
  await page.goto('/habits');
  await expect(page.getByRole('button', { name: '为 阅读 打卡', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '为 喝水 打卡', exact: true })).toBeVisible();
  await page.clock.fastForward(3600000);
  await expect(hint(page)).toContainText('散步');
  await page.clock.fastForward(24 * 3600000);
  await expect(hint(page)).toContainText('另有 2 项待打卡');
});

test('an idle reminder fades after 15 seconds, stays dismissed and restarts its idle timer after interaction', async ({ page }) => {
  await seed(page);
  await page.clock.runFor(14000);
  await expect(hint(page)).toBeVisible();
  await page.locator('header').dispatchEvent('pointerdown');
  await page.clock.runFor(14000);
  await expect(hint(page)).not.toHaveAttribute('data-fading', 'true');
  await page.clock.runFor(1000);
  await expect(hint(page)).toHaveAttribute('data-fading', 'true');
  await page.clock.runFor(300);
  await expect(hint(page)).toHaveCount(0);
  await page.clock.fastForward(60000);
  await expect(hint(page)).toHaveCount(0);
  await page.reload();
  await expect(hint(page)).toHaveCount(0);
});

test('snoozing a batch avoids an immediate replacement and returns it after ten minutes', async ({ page }) => {
  await seed(page);
  await hint(page).getByRole('button', { name: '10 分钟后提醒', exact: true }).click();
  await expect(hint(page)).toHaveCount(0);
  await page.reload();
  await expect(hint(page)).toHaveCount(0);
  await page.clock.fastForward(600000);
  await expect(hint(page)).toContainText('另有 1 项待打卡');
});
