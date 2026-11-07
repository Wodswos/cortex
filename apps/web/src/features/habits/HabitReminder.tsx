import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Bell, Clock, X } from 'lucide-react';
import { dayKeyOf, habitReminderSlot, logCountOn } from '@cortex/core';
import { useCortex, useCortexData } from '@cortex/crdt';
import { notify } from '@cortex/platform';
import { useHabitClock } from './clock';

/** Global reminder persists until completion, dismissal or explicit snooze, even after
 * navigating away from habits. Reminder bookkeeping is local to this account. */
export function HabitReminder() {
  const store = useCortex();
  const data = useCortexData();
  const now = useHabitClock();
  const today = dayKeyOf(now);
  const [snoozes, setSnoozes] = useState<Record<string, number>>({});
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});
  const prefix = `cortex:habit-reminder:${encodeURIComponent(store.userId)}:`;
  const keyOf = (id: string, time: string) => `${prefix}${id}:${today}:${time}`;
  const due = data.habits.flatMap(habit => {
    const slot = habitReminderSlot(habit, data.habitLogs, new Date(now));
    if (!slot) return [];
    const key = keyOf(habit.id, slot.time);
    if (dismissed[key]) return [];
    let until = snoozes[key] ?? 0;
    try {
      if (localStorage.getItem(`${key}:dismissed`) === '1') return [];
      until = Math.max(until, Number(localStorage.getItem(key)) || 0);
    } catch { /* In-memory fallback. */ }
    return until <= now ? [{ habit, slot }] : [];
  }).sort((a, b) => a.slot.time.localeCompare(b.slot.time) || a.habit.createdAt - b.habit.createdAt || a.habit.id.localeCompare(b.habit.id));
  const habit = due[0]?.habit, slot = due[0]?.slot;
  const key = habit && slot ? keyOf(habit.id, slot.time) : null;
  useEffect(() => {
    if (!habit || !key || !slot) return;
    // Only existing permission is used automatically. A permission prompt is
    // available from the habit editor after an explicit click.
    const marker = `${key}:notified`;
    try { if (localStorage.getItem(marker)) return; } catch { return; }
    notify(`该${habit.name}了`, `${slot.time} · 打开 Cortex，完成今天的习惯。`);
    try { localStorage.setItem(marker, '1'); } catch { /* The in-app reminder remains available. */ }
  }, [key, habit?.name]);
  if (!habit || !key || !slot) return null;
  const count = logCountOn(data.habitLogs, habit.id, today);
  return <aside aria-label="习惯提醒" aria-live="polite" className="fixed bottom-20 right-3 z-30 w-80 max-w-[calc(100vw-24px)] rounded-xl border border-[var(--border-strong)] bg-[var(--background)] p-4 shadow-lg md:bottom-4 md:right-4">
    <button type="button" aria-label="关闭本次习惯提醒" title="本次不再提醒，后续时间及次日照常提醒" className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-[var(--surface)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--accent-solid)]" onClick={() => {
      setDismissed(previous => ({ ...previous, [key]: true }));
      try { localStorage.setItem(`${key}:dismissed`, '1'); } catch { /* In-memory fallback. */ }
    }}><X aria-hidden="true" size={14} /></button>
    <div className="flex items-center gap-2 pr-6 text-sm font-medium"><Bell size={15} className="shrink-0 text-[var(--accent-solid)]" /><span className="min-w-0 truncate" title={habit.name}>{habit.name}</span></div>
    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted"><Clock size={12} />{slot.time} · 今天 {count}/{habit.targetPerDay ?? 1} 次{due.length > 1 && ` · 另有 ${due.length - 1} 项待打卡`}</p>
    <div className="mt-3 flex items-center justify-end gap-3 text-xs"><button className="text-muted hover:text-foreground" onClick={() => {
      const until = now + 600000;
      setSnoozes(previous => ({ ...previous, [key]: until }));
      try { localStorage.setItem(key, String(until)); } catch { /* In-memory fallback. */ }
    }}>10 分钟后提醒</button><Link aria-label={`去打卡 ${habit.name}`} to={`/habits?habit=${encodeURIComponent(habit.id)}`} className="rounded-md bg-[var(--accent-solid)] px-3 py-1.5 text-white">去打卡</Link></div>
  </aside>;
}
