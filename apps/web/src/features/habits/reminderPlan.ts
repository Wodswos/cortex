import { addDays, dayKeyOf, habitReminderSlot, habitReminderTimes, startOfDay, type Habit, type HabitLog } from '@cortex/core';
import type { HabitNotificationPlan } from '@cortex/platform';

export const HABIT_REMINDER_IDLE_MS = 15_000;
export const HABIT_REMINDER_FADE_MS = 250;
export const habitReminderKey = (owner: string, id: string, day: string, time: string) =>
  `cortex:habit-reminder:${encodeURIComponent(owner)}:${id}:${day}:${time}`;

export function reminderUntil(key: string, memory: Record<string, number>): number {
  let until = memory[key] ?? 0;
  try {
    if (localStorage.getItem(`${key}:dismissed`) === '1') return Infinity;
    until = Math.max(until, Number(localStorage.getItem(key)) || 0);
  } catch { /* In-memory fallback. */ }
  return until;
}

/** One-shot local dates let edits and check-ins cancel individual occurrences.
 * Calendar arithmetic preserves wall-clock reminder times across DST changes. */
export function planHabitNotifications(owner: string, habits: Habit[], logs: HabitLog[], now: number,
  snoozes: Record<string, number> = {}, readUntil = (key: string) => reminderUntil(key, snoozes)): HabitNotificationPlan[] {
  const plans: HabitNotificationPlan[] = [];
  for (let offset = 0; offset < 14; offset++) {
    const day = addDays(startOfDay(now), offset);
    const nextDay = addDays(day, 1).getTime();
    for (const habit of habits) for (const time of habitReminderTimes(habit)) {
      const [hours, minutes] = time.split(':').map(Number);
      const scheduled = new Date(day);
      scheduled.setHours(hours!, minutes!, 0, 0);
      // Later logs and weekly quotas use the exact same rules as the in-app hint.
      const slot = habitReminderSlot(habit, logs, new Date(Math.max(scheduled.getTime(), offset === 0 ? now : 0)));
      if (slot?.time !== time) continue;
      const key = habitReminderKey(owner, habit.id, dayKeyOf(day), time);
      const until = readUntil(key);
      if (until >= nextDay) continue;
      const at = Math.max(scheduled.getTime(), until, now + 1000);
      if (at >= nextDay) continue;
      // Receipts keep catch-up times stable; a changed timezone must still
      // replace future OS requests with the new local wall-clock occurrence.
      const nativeKey = `${key}:tz:${scheduled.getTimezoneOffset()}`;
      plans.push({ key: until > scheduled.getTime() ? `${nativeKey}:snooze:${until}` : nativeKey,
        habitId: habit.id, title: `该${habit.name}了`, body: `${time} · 打开 Cortex，完成今天的习惯。`, at });
    }
  }
  return plans.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
}
