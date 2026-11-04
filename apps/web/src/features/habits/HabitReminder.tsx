import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Bell, Clock, X } from 'lucide-react';
import { addDays, dayKeyOf, habitReminderSlot, logCountOn, startOfDay } from '@cortex/core';
import { useCortex, useCortexData } from '@cortex/crdt';
import { nativeNotifSupported, notify } from '@cortex/platform';
import { useHabitClock } from './clock';
import { HABIT_REMINDER_FADE_MS, HABIT_REMINDER_IDLE_MS, habitReminderKey, reminderUntil } from './reminderPlan';
import { useNativeHabitNotifications } from './useNativeHabitNotifications';

/** Hints can be dismissed without checking in or disabling future reminders.
 * Current occurrences stay quiet for the rest of the day, across navigation. */
export function HabitReminder() {
  const store = useCortex();
  const data = useCortexData();
  const now = useHabitClock();
  const today = dayKeyOf(now);
  const [snoozes, setSnoozes] = useState<Record<string, number>>({});
  const [fading, setFading] = useState(false);
  const panel = useRef<HTMLElement>(null);
  useNativeHabitNotifications(now, snoozes);
  const keyOf = (id: string, time: string) => habitReminderKey(store.userId, id, today, time);
  const due = data.habits.flatMap(habit => {
    const slot = habitReminderSlot(habit, data.habitLogs, new Date(now));
    if (!slot) return [];
    return reminderUntil(keyOf(habit.id, slot.time), snoozes) <= now ? [{ habit, slot }] : [];
  }).sort((a, b) => a.slot.time.localeCompare(b.slot.time) || a.habit.createdAt - b.habit.createdAt || a.habit.id.localeCompare(b.habit.id));
  const habit = due[0]?.habit, slot = due[0]?.slot;
  const key = habit && slot ? keyOf(habit.id, slot.time) : null;
  const dueKeys = due.map(item => keyOf(item.habit.id, item.slot.time));
  const currentKeys = useRef(dueKeys);
  currentKeys.current = dueKeys;
  const deferCurrent = (until: number) => {
    const updates = Object.fromEntries(currentKeys.current.map(item => [item, until]));
    setSnoozes(previous => ({ ...previous, ...updates }));
    for (const item of Object.keys(updates)) {
      try { localStorage.setItem(item, String(until)); } catch { /* In-memory fallback. */ }
    }
    setFading(false);
  };
  const deferRef = useRef(deferCurrent);
  deferRef.current = deferCurrent;
  useEffect(() => {
    setFading(false);
    if (!key) return;
    let idle: ReturnType<typeof setTimeout>;
    let fade: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const clear = () => { clearTimeout(idle); clearTimeout(fade); };
    const reset = () => {
      if (disposed) return;
      clear();
      setFading(false);
      if (document.hidden || panel.current?.contains(document.activeElement) && document.activeElement?.matches(':focus-visible')) return;
      idle = setTimeout(() => {
        setFading(true);
        fade = setTimeout(() => deferRef.current(addDays(startOfDay(Date.now()), 1).getTime()), HABIT_REMINDER_FADE_MS);
      }, HABIT_REMINDER_IDLE_MS);
    };
    const interaction = (event: Event) => { if (event.type === 'focusout') queueMicrotask(reset); else reset(); };
    window.addEventListener('pointerdown', interaction, { passive: true });
    window.addEventListener('keydown', interaction);
    window.addEventListener('focusin', interaction);
    window.addEventListener('focusout', interaction);
    document.addEventListener('visibilitychange', interaction);
    reset();
    return () => {
      disposed = true;
      clear();
      window.removeEventListener('pointerdown', interaction);
      window.removeEventListener('keydown', interaction);
      window.removeEventListener('focusin', interaction);
      window.removeEventListener('focusout', interaction);
      document.removeEventListener('visibilitychange', interaction);
    };
  }, [key]);
  useEffect(() => {
    if (!habit || !key || !slot || nativeNotifSupported()) return;
    // Only existing permission is used automatically. A permission prompt is
    // available from the habit editor after an explicit click.
    const marker = `${key}:notified`;
    try { if (localStorage.getItem(marker)) return; } catch { return; }
    notify(`该${habit.name}了`, `${slot.time} · 打开 Cortex，完成今天的习惯。`);
    try { localStorage.setItem(marker, '1'); } catch { /* The in-app reminder remains available. */ }
  }, [key, habit?.name]);
  if (!habit || !key || !slot) return null;
  const count = logCountOn(data.habitLogs, habit.id, today);
  return <aside ref={panel} aria-label="习惯提醒" aria-live="polite" data-fading={fading || undefined} className={`fixed bottom-[calc(5rem+var(--app-safe-area-bottom,0px))] right-3 z-30 w-80 max-w-[calc(100vw-24px)] rounded-xl border border-[var(--border-strong)] bg-[var(--background)] p-4 shadow-lg transition-opacity duration-250 motion-reduce:transition-none md:bottom-4 md:right-4 ${fading ? 'pointer-events-none opacity-0' : 'opacity-100'}`}>
    <div className="flex items-center gap-2 text-sm font-medium"><Bell size={15} className="shrink-0 text-[var(--accent-solid)]" /><span className="min-w-0 flex-1 truncate" title={habit.name}>{habit.name}</span><button aria-label="关闭本次习惯提醒" title="今天不再显示当前提醒，不影响之后的提醒和打卡记录" onClick={() => deferCurrent(addDays(startOfDay(Date.now()), 1).getTime())} className="-mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:bg-[var(--surface)] hover:text-foreground"><X size={16} /></button></div>
    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted"><Clock size={12} />{slot.time} · 今天 {count}/{habit.targetPerDay ?? 1} 次{due.length > 1 && ` · 另有 ${due.length - 1} 项待打卡`}</p>
    <div className="mt-3 flex items-center justify-end gap-3 text-xs"><button className="text-muted hover:text-foreground" onClick={() => {
      deferCurrent(Date.now() + 600000);
    }}>10 分钟后提醒</button><Link aria-label={`去打卡 ${habit.name}`} to={`/habits?habit=${encodeURIComponent(habit.id)}`} className="rounded-md bg-[var(--accent-solid)] px-3 py-1.5 text-white">去打卡</Link></div>
  </aside>;
}
