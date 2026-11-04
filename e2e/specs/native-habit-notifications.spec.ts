import { test, expect } from '@playwright/test';

type NativeNotice = { id: number; title: string; body: string; extra: { ownerId: string; habitId: string; key: string }; schedule: { at: Date } };
type NativeHarness = { permission: string; requests: number; pending: NativeNotice[]; tap(wrongOwner?: boolean): void };
const harness = () => (window as unknown as { __nativeNotifications: NativeHarness }).__nativeNotifications;
test.use({ serviceWorkers: 'block' });

test('native habits request permission explicitly, schedule without browser notifications and open only the active account', async ({ page }) => {
  const external: string[] = [];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && !['localhost', '127.0.0.1'].includes(url.hostname)) {
      external.push(url.origin);
      return route.abort();
    }
    return route.continue();
  });
  await page.addInitScript(() => {
    const listeners = new Map<string, { event: string; callback(value: unknown): void }>();
    let callbackId = 0;
    const state: NativeHarness = {
      permission: 'prompt', requests: 0, pending: [],
      tap(wrongOwner = false) {
        const notification = state.pending[0];
        if (!notification) throw new Error('No scheduled habit notification');
        const value = { ...notification, extra: { ...notification.extra, ...(wrongOwner ? { ownerId: 'another-account' } : {}) } };
        for (const listener of listeners.values()) if (listener.event === 'localNotificationActionPerformed') listener.callback({ actionId: 'tap', notification: value });
      },
    };
    const promises = ['checkPermissions', 'requestPermissions', 'getPending', 'schedule', 'cancel', 'getDeliveredNotifications', 'removeDeliveredNotifications', 'removeListener'];
    Object.assign(window, {
      __nativeNotifications: state,
      // The real Capacitor runtime registers and invokes its plugin proxy. Only
      // the native side of that boundary is replaced; application code is real.
      CapacitorCustomPlatform: { name: 'ios' },
      Capacitor: {
        isNativePlatform: () => true,
        PluginHeaders: [{ name: 'LocalNotifications', methods: [...promises.map(name => ({ name, rtype: 'promise' })), { name: 'addListener', rtype: 'callback' }] }],
        nativePromise: async (_plugin: string, method: string, options: { notifications?: NativeNotice[]; callbackId?: string } = {}) => {
          if (method === 'checkPermissions') return { display: state.permission };
          if (method === 'requestPermissions') { state.requests++; state.permission = 'granted'; return { display: state.permission }; }
          if (method === 'getPending') return { notifications: [...state.pending] };
          if (method === 'schedule') {
            const notifications = options.notifications ?? [];
            state.pending = [...state.pending.filter(item => !notifications.some(value => item.id === value.id)), ...notifications];
            return { notifications: notifications.map(({ id }) => ({ id })) };
          }
          if (method === 'cancel') state.pending = state.pending.filter(item => !options.notifications?.some(value => item.id === value.id));
          if (method === 'getDeliveredNotifications') return { notifications: [] };
          if (method === 'removeListener' && options.callbackId) listeners.delete(options.callbackId);
          return {};
        },
        nativeCallback: (_plugin: string, _method: string, options: { eventName: string }, callback: (value: unknown) => void) => {
          const id = String(++callbackId);
          listeners.set(id, { event: options.eventName, callback });
          return id;
        },
      },
    });
    Object.defineProperty(window, 'Notification', { value: undefined, configurable: true });
  });
  await page.clock.setFixedTime(new Date('2026-11-04T19:00:00+08:00'));
  await page.goto('/settings');
  await page.locator('input[type=file]').setInputFiles({
    name: 'native-habits.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ habits: [{ id: 'native-read', name: '阅读', cadence: { type: 'daily' }, targetPerDay: 1, reminderAt: '19:00', reminderEnabled: true, ownerId: 'fixture', createdAt: 1 }] })),
  });
  await expect(page.getByText(/已合并备份/)).toBeVisible();
  await page.goto('/habits');
  expect(await page.evaluate(harness).then(state => state.requests)).toBe(0);
  await page.getByRole('button', { name: '编辑习惯 阅读', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑习惯', exact: true });
  // Change Date without firing the 30-second clock interval. Granting must use
  // the actual current time so today's catchup is not discarded as already past.
  await page.clock.setFixedTime(new Date('2026-11-04T19:00:20+08:00'));
  await dialog.getByRole('button', { name: '开启手机系统通知', exact: true }).click();
  await expect(dialog.getByText('手机系统通知已开启。', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __nativeNotifications: NativeHarness }).__nativeNotifications.pending.length)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __nativeNotifications: NativeHarness }).__nativeNotifications.pending.some(item => item.extra.key.includes('2026-11-04') && new Date(item.schedule.at).getTime() > Date.now()))).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __nativeNotifications: NativeHarness }).__nativeNotifications.requests)).toBe(1);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.evaluate(() => { history.pushState(null, '', '/tasks'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page).toHaveURL(/\/tasks$/);
  await page.evaluate(() => (window as unknown as { __nativeNotifications: NativeHarness }).__nativeNotifications.tap(true));
  await expect(page).toHaveURL(/\/tasks$/);
  await page.evaluate(() => (window as unknown as { __nativeNotifications: NativeHarness }).__nativeNotifications.tap());
  await expect(page).toHaveURL(/\/habits\?habit=native-read$/);
  const row = page.locator('[data-habit-row="native-read"]');
  await expect(row.getByRole('button', { name: '阅读的打卡记录', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await row.getByRole('button', { name: '为 阅读 打卡', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __nativeNotifications: NativeHarness }).__nativeNotifications.pending.some(item => item.extra.key.includes('2026-11-04')))).toBe(false);
  expect(external).toEqual([]);
});
