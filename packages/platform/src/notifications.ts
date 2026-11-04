import { Capacitor } from '@capacitor/core';
import { LocalNotifications, type LocalNotificationSchema } from '@capacitor/local-notifications';

export type NotifPermission = 'granted' | 'denied' | 'unsupported' | 'default';

export function nativeNotifSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('LocalNotifications');
}

export function notifSupported(): boolean {
  return nativeNotifSupported() || typeof Notification !== 'undefined';
}

export async function getNotifPermission(): Promise<NotifPermission> {
  if (nativeNotifSupported()) {
    try {
      const { display } = await LocalNotifications.checkPermissions();
      return display === 'granted' || display === 'denied' ? display : 'default';
    } catch { return 'unsupported'; }
  }
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

const permissionListeners = new Set<() => void>();
const emitPermissionChange = () => permissionListeners.forEach(listener => listener());
/** Refresh after a manual grant or returning from the system's Settings app. */
export function onNotifPermissionChange(listener: () => void): () => void {
  permissionListeners.add(listener);
  if (permissionListeners.size === 1 && typeof window !== 'undefined') {
    window.addEventListener('focus', emitPermissionChange);
    document.addEventListener('visibilitychange', emitPermissionChange);
  }
  return () => {
    permissionListeners.delete(listener);
    if (!permissionListeners.size && typeof window !== 'undefined') {
      window.removeEventListener('focus', emitPermissionChange);
      document.removeEventListener('visibilitychange', emitPermissionChange);
    }
  };
}

/** Call only from an explicit user gesture; checking/scheduling never prompts. */
export async function requestNotifPermission(): Promise<NotifPermission> {
  if (!notifSupported()) return 'unsupported';
  let permission: NotifPermission;
  try {
    if (nativeNotifSupported()) {
      const current = await getNotifPermission();
      if (current === 'granted' || current === 'denied') permission = current;
      else {
        const { display } = await LocalNotifications.requestPermissions();
        permission = display === 'granted' || display === 'denied' ? display : 'default';
      }
    } else if (Notification.permission === 'granted' || Notification.permission === 'denied') permission = Notification.permission;
    else permission = await Notification.requestPermission();
  } catch { permission = 'denied'; }
  emitPermissionChange();
  return permission;
}

let nextImmediateId = Date.now() % 60000;
export function notify(title: string, body?: string): void {
  if (nativeNotifSupported()) {
    const id = nextImmediateId = nextImmediateId % 60000 + 1;
    void LocalNotifications.checkPermissions().then(({ display }) => {
      if (display === 'granted') return LocalNotifications.schedule({ notifications: [{ id, title, body: body ?? '', sound: 'default', silent: false }] });
    }).catch(() => { /* Reminders remain visible in the application. */ });
    return;
  }
  if (!notifSupported() || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, icon: '/icons/icon-192.png', tag: 'cortex', silent: false });
  } catch {
    /* PWA/SW 场景失败静默 */
  }
}

export interface HabitNotificationPlan {
  key: string;
  habitId: string;
  title: string;
  body: string;
  at: number;
}
const HABIT_KIND = 'cortex.habit-reminder.v1';
interface HabitNotificationMeta { kind: typeof HABIT_KIND; ownerId: string; habitId: string; key: string; at: number }
const habitMeta = (value: unknown): HabitNotificationMeta | undefined => {
  if (!value || typeof value !== 'object') return;
  const meta = value as Partial<HabitNotificationMeta>;
  if (meta.kind === HABIT_KIND && typeof meta.ownerId === 'string' && typeof meta.habitId === 'string' && typeof meta.key === 'string' && typeof meta.at === 'number') return meta as HabitNotificationMeta;
};
const isHabitNotification = (value: { extra?: unknown; data?: unknown }) => habitMeta(value.extra ?? value.data);
const receiptMemory = new Map<string, Record<string, number>>();
function readReceipts(ownerId: string): Record<string, number> {
  const remembered = receiptMemory.get(ownerId);
  if (remembered) {
    for (const [key, at] of Object.entries(remembered)) if (at < Date.now() - 35 * 86400000) delete remembered[key];
    return remembered;
  }
  let receipts: Record<string, number> = {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(`cortex:native-habit-receipts:${encodeURIComponent(ownerId)}`) ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) receipts = Object.fromEntries(Object.entries(parsed).filter(([, at]) => typeof at === 'number' && Number.isFinite(at) && at >= Date.now() - 35 * 86400000));
  } catch { /* Use in-memory receipts when storage is unavailable. */ }
  receiptMemory.set(ownerId, receipts);
  return receipts;
}
function saveReceipts(ownerId: string, receipts: Record<string, number>) {
  receiptMemory.set(ownerId, receipts);
  try { localStorage.setItem(`cortex:native-habit-receipts:${encodeURIComponent(ownerId)}`, JSON.stringify(receipts)); } catch { /* In-memory fallback. */ }
}
function notificationId(key: string, used: Set<number>): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  let id = 65536 + ((hash >>> 0) % (2147483647 - 65536));
  while (used.has(id)) id = id === 2147483647 ? 65536 : id + 1;
  return id;
}
let latestReconcile = 0;
let reconciliation = Promise.resolve();
/** Replace only Cortex habit requests. Queueing prevents account-change races;
 * successful schedule receipts prevent repeats after a delivered alert is cleared. */
export function reconcileHabitNotifications(ownerId: string | null, plans: HabitNotificationPlan[]): Promise<void> {
  if (!nativeNotifSupported()) return Promise.resolve();
  const revision = ++latestReconcile;
  const run = reconciliation.catch(() => {}).then(async () => {
    if (revision !== latestReconcile) return;
    const { notifications: pending } = await LocalNotifications.getPending();
    const now = Date.now();
    const permission = ownerId === null ? 'denied' : (await LocalNotifications.checkPermissions()).display;
    if (revision !== latestReconcile) return;
    const receipts = ownerId === null ? {} : readReceipts(ownerId);
    const other = pending.filter(item => !isHabitNotification(item));
    const used = new Set(other.map(item => item.id));
    const unique = new Map<string, HabitNotificationPlan>();
    if (ownerId !== null && permission === 'granted') for (const plan of plans) {
      if (!plan.key || !plan.habitId || !Number.isFinite(plan.at) || plan.at <= now || receipts[plan.key] && receipts[plan.key]! <= now) continue;
      unique.set(plan.key, { ...plan, at: receipts[plan.key] ?? plan.at });
    }
    // iOS allows 64 pending requests per app. Leave room for other app reminders.
    const selected = [...unique.values()].sort((a, b) => a.at - b.at || a.key.localeCompare(b.key)).slice(0, Math.max(0, Math.min(60, 64 - other.length)));
    const desired = selected.map(plan => {
      const existing = pending.find(item => { const meta = isHabitNotification(item); return meta?.ownerId === ownerId && meta.key === plan.key; });
      const id = existing && !used.has(existing.id) ? existing.id : notificationId(`${ownerId}:${plan.key}`, used);
      used.add(id);
      return { id, title: plan.title, body: plan.body, sound: 'default', silent: false, threadIdentifier: 'cortex-habits', schedule: { at: new Date(plan.at) }, extra: { kind: HABIT_KIND, ownerId, habitId: plan.habitId, key: plan.key, at: plan.at } } satisfies LocalNotificationSchema;
    });
    const matches = (item: typeof pending[number], target: typeof desired[number]) => {
      const meta = isHabitNotification(item);
      return item.id === target.id && item.title === target.title && item.body === target.body && meta?.ownerId === ownerId && meta.habitId === target.extra.habitId && meta.key === target.extra.key && meta.at === target.extra.at;
    };
    const cancel = pending.filter(item => isHabitNotification(item) && !desired.some(target => matches(item, target)));
    if (cancel.length) {
      await LocalNotifications.cancel({ notifications: cancel.map(({ id }) => ({ id })) });
      for (const item of cancel) {
        const meta = isHabitNotification(item)!;
        if (meta.ownerId === ownerId && desired.some(target => target.extra.key === meta.key)) continue;
        const previous = meta.ownerId === ownerId ? receipts : readReceipts(meta.ownerId);
        if (previous[meta.key]! > now) { delete previous[meta.key]; saveReceipts(meta.ownerId, previous); }
      }
    }
    if (revision !== latestReconcile) return;
    const schedule = desired.filter(target => !pending.some(item => matches(item, target)));
    if (schedule.length) await LocalNotifications.schedule({ notifications: schedule });
    if (ownerId !== null) {
      for (const item of desired) receipts[item.extra.key] = item.extra.at;
      saveReceipts(ownerId, receipts);
    }
    const { notifications: delivered } = await LocalNotifications.getDeliveredNotifications();
    const visibleKeys = new Set(ownerId !== null && permission === 'granted' ? plans.map(plan => plan.key) : []);
    const remove = delivered.filter(item => {
      const meta = isHabitNotification(item);
      return meta && (meta.ownerId !== ownerId || !visibleKeys.has(meta.key));
    });
    if (remove.length) await LocalNotifications.removeDeliveredNotifications({ notifications: remove });
  });
  reconciliation = run;
  return run;
}

export async function onHabitNotificationAction(listener: (action: { ownerId: string; habitId: string }) => void): Promise<() => void> {
  if (!nativeNotifSupported()) return () => {};
  const handle = await LocalNotifications.addListener('localNotificationActionPerformed', action => {
    const meta = isHabitNotification(action.notification);
    if (action.actionId === 'tap' && meta) listener({ ownerId: meta.ownerId, habitId: meta.habitId });
  });
  return () => { void handle.remove(); };
}

/** 播放短提示音(WebAudio,零音频资产) */
export function chime(kind: 'done' | 'break' = 'done'): void {
  try {
    const Ctx =
      (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
        .AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = kind === 'done' ? [523.25, 659.25, 783.99] : [659.25, 523.25];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.55);
    });
    setTimeout(() => ctx.close().catch(() => {}), 2000);
  } catch {
    /* 无伤大雅 */
  }
}
