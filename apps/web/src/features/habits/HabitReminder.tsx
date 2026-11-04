import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Bell, Clock } from 'lucide-react';
import { dayKeyOf, habitReminderDue, logCountOn } from '@cortex/core';
import { useCortex, useCortexData } from '@cortex/crdt';
import { notify } from '@cortex/platform';
import { useHabitClock } from './clock';

/** Global reminder persists until completion or explicit snooze, even after
 * navigating away from habits. Reminder bookkeeping is local to this account. */
export function HabitReminder() {
  const store = useCortex();
  const data = useCortexData();
  const now = useHabitClock();
  const today = dayKeyOf(now);
  const [snoozes, setSnoozes] = useState<Record<string, number>>({});
  const prefix = `cortex:habit-reminder:${encodeURIComponent(store.userId)}:`;
  const keyOf = (id: string, time: string) => `${prefix}${id}:${today}:${time}`;
  const due = data.habits.filter(habit => {
    if (!habitReminderDue(habit, data.habitLogs, new Date(now))) return false;
    const key = keyOf(habit.id, habit.reminderAt!);
    let until = snoozes[key] ?? 0;
    try { until = Math.max(until, Number(localStorage.getItem(key)) || 0); } catch { /* In-memory fallback. */ }
    return until <= now;
  }).sort((a, b) => a.reminderAt!.localeCompare(b.reminderAt!) || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const habit = due[0];
  const key = habit ? keyOf(habit.id, habit.reminderAt!) : null;
  useEffect(() => {
    if (!habit || !key) return;
    // Only existing permission is used automatically. A permission prompt is
    // available from the habit editor after an explicit click.
    const marker = `${key}:notified`;
    try { if (localStorage.getItem(marker)) return; } catch { return; }
    notify(`该${habit.name}了`, `${habit.reminderAt} · 打开 Cortex，完成今天的习惯。`);
    try { localStorage.setItem(marker, '1'); } catch { /* The in-app reminder remains available. */ }
  }, [key, habit?.name]);
  if (!habit || !key) return null;
  const count = logCountOn(data.habitLogs, habit.id, today);
  return <aside aria-label="习惯提醒" aria-live="polite" className="fixed bottom-20 right-3 z-30 w-80 max-w-[calc(100vw-24px)] rounded-xl border border-[var(--border-strong)] bg-[var(--background)] p-4 shadow-lg md:bottom-4 md:right-4">
    <div className="flex items-center gap-2 text-sm font-medium"><Bell size={15} className="shrink-0 text-[var(--accent-solid)]" /><span className="min-w-0 truncate" title={habit.name}>{habit.name}</span></div>
    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted"><Clock size={12} />{habit.reminderAt} · 今天 {count}/{habit.targetPerDay ?? 1} 次{due.length > 1 && ` · 另有 ${due.length - 1} 项待打卡`}</p>
    <div className="mt-3 flex items-center justify-end gap-3 text-xs"><button className="text-muted hover:text-foreground" onClick={() => {
      const until = now + 600000;
      setSnoozes(previous => ({ ...previous, [key]: until }));
      try { localStorage.setItem(key, String(until)); } catch { /* In-memory fallback. */ }
    }}>10 分钟后提醒</button><Link aria-label={`去打卡 ${habit.name}`} to={`/habits?habit=${encodeURIComponent(habit.id)}`} className="rounded-md bg-[var(--accent-solid)] px-3 py-1.5 text-white">去打卡</Link></div>
  </aside>;
}
