import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Notice = { id: number; title: string; body: string; schedule?: { at: Date }; extra?: Record<string, unknown> };
const state = vi.hoisted(() => ({ native: true, permission: 'granted', pending: [] as Notice[], delivered: [] as Notice[], action: (_value: unknown) => {} }));
const plugin = vi.hoisted(() => ({
  checkPermissions: vi.fn(), requestPermissions: vi.fn(), getPending: vi.fn(), schedule: vi.fn(), cancel: vi.fn(),
  getDeliveredNotifications: vi.fn(), removeDeliveredNotifications: vi.fn(), addListener: vi.fn(), remove: vi.fn(),
}));
vi.mock('../../../packages/platform/node_modules/@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => state.native, isPluginAvailable: () => true } }));
vi.mock('../../../packages/platform/node_modules/@capacitor/local-notifications', () => ({ LocalNotifications: plugin }));

let notifications: typeof import('@cortex/platform');
const now = new Date(2026, 10, 4, 19, 59).getTime();
const plan = (key = 'owner:read:2026-11-04:20:00', at = now + 60000) => ({ key, habitId: 'read', title: '该阅读了', body: '20:00 · 完成今天的习惯。', at });

beforeEach(async () => {
  vi.resetModules(); vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal('Notification', undefined);
  state.native = true; state.permission = 'granted'; state.pending = []; state.delivered = [];
  plugin.checkPermissions.mockImplementation(async () => ({ display: state.permission }));
  plugin.requestPermissions.mockImplementation(async () => ({ display: state.permission = 'granted' }));
  plugin.getPending.mockImplementation(async () => ({ notifications: [...state.pending] }));
  plugin.getDeliveredNotifications.mockImplementation(async () => ({ notifications: [...state.delivered] }));
  plugin.schedule.mockImplementation(async ({ notifications: items }: { notifications: Notice[] }) => {
    state.pending = [...state.pending.filter(item => !items.some(value => value.id === item.id)), ...items];
    return { notifications: items.map(({ id }) => ({ id })) };
  });
  plugin.cancel.mockImplementation(async ({ notifications: items }: { notifications: { id: number }[] }) => {
    state.pending = state.pending.filter(item => !items.some(value => value.id === item.id));
  });
  plugin.removeDeliveredNotifications.mockImplementation(async ({ notifications: items }: { notifications: { id: number }[] }) => {
    state.delivered = state.delivered.filter(item => !items.some(value => value.id === item.id));
  });
  plugin.addListener.mockImplementation(async (_event: string, callback: typeof state.action) => { state.action = callback; return { remove: plugin.remove }; });
  notifications = await import('@cortex/platform');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('native notification permissions', () => {
  it('supports native permission checks without the browser Notification global and prompts only on a click', async () => {
    state.permission = 'prompt';
    expect(notifications.notifSupported()).toBe(true);
    expect(notifications.nativeNotifSupported()).toBe(true);
    expect(await notifications.getNotifPermission()).toBe('default');
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
    const refresh = vi.fn();
    const unsubscribe = notifications.onNotifPermissionChange(refresh);
    expect(await notifications.requestNotifPermission()).toBe('granted');
    expect(plugin.requestPermissions).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
    unsubscribe();
    expect(await notifications.requestNotifPermission()).toBe('granted');
    expect(plugin.requestPermissions).toHaveBeenCalledOnce();
  });

  it('preserves web fallback and does not schedule through the native bridge outside a native app', async () => {
    state.native = false;
    expect(await notifications.getNotifPermission()).toBe('unsupported');
    await notifications.reconcileHabitNotifications('owner', [plan()]);
    notifications.notify('专注完成');
    expect(plugin.getPending).not.toHaveBeenCalled();
    expect(plugin.schedule).not.toHaveBeenCalled();
  });
});

describe('native habit queue', () => {
  it('keeps one stable request and never resends an already delivered or cleared occurrence', async () => {
    await notifications.reconcileHabitNotifications('owner', [plan()]);
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0]).toMatchObject({ title: '该阅读了', sound: 'default', silent: false, schedule: { at: new Date(now + 60000) }, extra: { ownerId: 'owner', habitId: 'read', key: plan().key } });
    await notifications.reconcileHabitNotifications('owner', [plan(plan().key, now + 120000)]);
    expect(plugin.schedule).toHaveBeenCalledOnce();
    state.pending = []; // The OS delivered it and the user cleared the alert.
    vi.setSystemTime(now + 61000);
    await notifications.reconcileHabitNotifications('owner', [plan(plan().key, Date.now() + 1000)]);
    expect(plugin.schedule).toHaveBeenCalledOnce();
  });

  it('keeps newer receipts in memory when storage reads are stale and writes fail', async () => {
    vi.stubGlobal('localStorage', { getItem: () => '{}', setItem: () => { throw new Error('Storage quota exceeded'); } });
    await notifications.reconcileHabitNotifications('owner', [plan()]);
    await notifications.reconcileHabitNotifications('owner', [plan(plan().key, now + 120000)]);
    expect(plugin.schedule).toHaveBeenCalledOnce();
    state.pending = [];
    vi.setSystemTime(now + 61000);
    await notifications.reconcileHabitNotifications('owner', [plan(plan().key, Date.now() + 1000)]);
    expect(plugin.schedule).toHaveBeenCalledOnce();
  });

  it('cancels completed/disabled habits and allows a canceled future reminder to be enabled again', async () => {
    await notifications.reconcileHabitNotifications('owner', [plan()]);
    const habit = state.pending[0]!;
    const focus = { id: 1, title: '专注完成', body: '' };
    state.pending.push(focus);
    state.delivered = [habit, focus];
    await notifications.reconcileHabitNotifications('owner', []);
    expect(state.pending).toEqual([focus]);
    expect(state.delivered).toEqual([focus]);
    await notifications.reconcileHabitNotifications('owner', [plan()]);
    expect(plugin.schedule).toHaveBeenCalledTimes(2);
    expect(state.pending).toHaveLength(2);
  });

  it('clears the previous account pending and delivered habits while preserving other notification types', async () => {
    await notifications.reconcileHabitNotifications('alice', [plan()]);
    state.delivered = [...state.pending];
    const focus = { id: 2, title: '专注完成', body: '' };
    state.pending.push(focus); state.delivered.push(focus);
    await notifications.reconcileHabitNotifications('bob', [plan('bob:read:2026-11-04:20:00')]);
    expect(state.pending.map(item => item.extra?.ownerId ?? 'focus')).toEqual(['focus', 'bob']);
    expect(state.delivered).toEqual([focus]);
    await notifications.reconcileHabitNotifications(null, []);
    expect(state.pending).toEqual([focus]);
    await notifications.reconcileHabitNotifications('alice', [plan()]);
    expect(state.pending.map(item => item.extra?.ownerId ?? 'focus')).toEqual(['focus', 'alice']);
  });

  it('serializes an in-flight schedule with logout so no old account request survives', async () => {
    let finish!: () => void;
    const blocked = new Promise<void>(resolve => { finish = resolve; });
    plugin.schedule.mockImplementationOnce(async ({ notifications: items }: { notifications: Notice[] }) => { state.pending.push(...items); await blocked; return { notifications: [] }; });
    const first = notifications.reconcileHabitNotifications('owner', [plan()]);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(plugin.schedule).toHaveBeenCalledOnce();
    const logout = notifications.reconcileHabitNotifications(null, []);
    finish();
    await Promise.all([first, logout]);
    expect(state.pending).toEqual([]);
  });

  it('keeps the earliest 60 requests and also respects pending slots used by other app reminders', async () => {
    state.pending = Array.from({ length: 10 }, (_, index) => ({ id: index + 1, title: 'other', body: '' }));
    const plans = Array.from({ length: 80 }, (_, index) => plan(`owner:habit-${index}`, now + (80 - index) * 60000));
    await notifications.reconcileHabitNotifications('owner', plans);
    expect(state.pending).toHaveLength(64);
    expect(state.pending.filter(item => item.extra)).toHaveLength(54);
    expect(new Set(state.pending.map(item => item.id)).size).toBe(64);
    expect(state.pending.find(item => item.extra?.key === 'owner:habit-79')).toBeDefined();
    expect(state.pending.find(item => item.extra?.key === 'owner:habit-0')).toBeUndefined();
    await notifications.reconcileHabitNotifications(null, []);
    state.pending = [];
    await notifications.reconcileHabitNotifications('owner', plans);
    expect(state.pending).toHaveLength(60);
  });

  it('revoking permission cancels stale reminders without prompting, and a scheduling failure remains retryable', async () => {
    await notifications.reconcileHabitNotifications('owner', [plan()]);
    state.permission = 'denied';
    await notifications.reconcileHabitNotifications('owner', [plan()]);
    expect(state.pending).toEqual([]);
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
    state.permission = 'granted';
    plugin.schedule.mockRejectedValueOnce(new Error('OS scheduling failed'));
    await expect(notifications.reconcileHabitNotifications('owner', [plan()])).rejects.toThrow('OS scheduling failed');
    await notifications.reconcileHabitNotifications('owner', [plan()]);
    expect(state.pending).toHaveLength(1);
    plugin.checkPermissions.mockRejectedValueOnce(new Error('Permission check failed'));
    await expect(notifications.reconcileHabitNotifications('owner', [plan()])).rejects.toThrow('Permission check failed');
  });

  it('routes only taps on habit notifications and exposes the owner for account-safe navigation', async () => {
    const callback = vi.fn();
    const unsubscribe = await notifications.onHabitNotificationAction(callback);
    await notifications.reconcileHabitNotifications('owner', [plan()]);
    const notification = state.pending[0]!;
    state.action({ actionId: 'dismiss', notification });
    state.action({ actionId: 'tap', notification: { id: 1, title: 'other', body: '' } });
    expect(callback).not.toHaveBeenCalled();
    state.action({ actionId: 'tap', notification });
    expect(callback).toHaveBeenCalledExactlyOnceWith({ ownerId: 'owner', habitId: 'read' });
    unsubscribe();
    expect(plugin.remove).toHaveBeenCalledOnce();
  });
});
