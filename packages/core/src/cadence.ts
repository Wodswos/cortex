import { Cadence, Habit, HabitLog } from './types';
import { dayKeyOf, dateFromDayKey, addDays, startOfWeek } from './time';

function daysBetween(a: string, b: string): number {
  const da = dateFromDayKey(a).getTime();
  const db = dateFromDayKey(b).getTime();
  return Math.round((db - da) / 86400000);
}

/** 某天是否是「应打卡日」(daily/interval/指定 weekdays 是硬性;weekly 弹性目标恒 false) */
export function isDueOn(habit: Habit, dayKey: string): boolean {
  const c = habit.cadence;
  if (c.type === 'daily') return true;
  if (c.type === 'interval') {
    const anchor = dayKeyOf(habit.createdAt);
    const diff = daysBetween(anchor, dayKey);
    return diff >= 0 && diff % Math.max(1, c.everyNDays) === 0;
  }
  if (c.type === 'weekly' && c.days && c.days.length > 0) {
    const d = dateFromDayKey(dayKey).getDay(); // 0=Sun
    const iso = d === 0 ? 7 : d;
    return c.days.includes(iso);
  }
  return false; // weekly 弹性 / custom
}

export function logCountOn(logs: HabitLog[], habitId: string, dayKey: string): number {
  const day = logs.filter((l) => l.habitId === habitId && l.date === dayKey);
  const cancelled = new Set(day.flatMap((l) => l.cancelledUnits ?? []));
  let count = 0;
  for (const log of day) {
    for (let i = 0; i < log.count; i++) if (!cancelled.has(`${log.id}:${i}`)) count++;
  }
  return count;
}

/** 当日打卡数是否达标(due 且 count >= target;非 due 日打卡视为超额完成也算) */
export function isDoneOn(habit: Habit, logs: HabitLog[], dayKey: string): boolean {
  const target = habit.targetPerDay ?? 1;
  return logCountOn(logs, habit.id, dayKey) >= target;
}

/** 连续 streak:从今天往回,跳过非应打卡日,数连续达标日;今天未打不断 streak(从昨天起算) */
export function habitStreak(habit: Habit, logs: HabitLog[], today = new Date()): number {
  const c = habit.cadence;
  let streak = 0;
  let cursor = new Date(today);
  // 今天(或弹性周)未完成不算断,从最后一个有效日开始
  if (!isDoneOn(habit, logs, dayKeyOf(cursor))) cursor = addDays(cursor, -1);
  // weekly 弹性:按周达标计
  if (c.type === 'weekly' && (!c.days || c.days.length === 0)) return weeklyStreak(habit, logs, today);
  for (let i = 0; i < 3650; i++) {
    const key = dayKeyOf(cursor);
    if (isDueOn(habit, key)) {
      if (isDoneOn(habit, logs, key)) streak++;
      else break;
    }
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function weeklyStreak(habit: Habit, logs: HabitLog[], today: Date): number {
  const c = habit.cadence as Extract<Cadence, { type: 'weekly' }>;
  const target = c.timesPerWeek;
  let weeks = 0;
  let weekStart = startOfWeek(today, 1);
  // 本周未达标不断 streak
  if (weekDone(habit, logs, weekStart) < target) weekStart = addDays(weekStart, -7);
  for (let i = 0; i < 520; i++) {
    if (weekDone(habit, logs, weekStart) >= target) weeks++;
    else break;
    weekStart = addDays(weekStart, -7);
  }
  return weeks;
}

export function weekDone(habit: Habit, logs: HabitLog[], date: Date): number {
  const weekStart = startOfWeek(date, 1);
  const end = addDays(weekStart, 7);
  const startKey = dayKeyOf(weekStart);
  const endKey = dayKeyOf(end);
  const dates = new Set(logs.filter((l) => l.habitId === habit.id && l.date >= startKey && l.date < endKey).map((l) => l.date));
  return [...dates].reduce((n, key) => n + logCountOn(logs, habit.id, key), 0);
}

/** 近 N 天热力数据(旧→新),value = count(clamp 到 target) */
export function heatmapDays(
  habit: Habit,
  logs: HabitLog[],
  days: number,
  today = new Date(),
): { dayKey: string; count: number; ratio: number; due: boolean }[] {
  const target = habit.targetPerDay ?? 1;
  const out: { dayKey: string; count: number; ratio: number; due: boolean }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = dayKeyOf(addDays(today, -i));
    const count = logCountOn(logs, habit.id, key);
    out.push({
      dayKey: key,
      count,
      ratio: Math.min(1, count / target),
      due: isDueOn(habit, key),
    });
  }
  return out;
}

/** 近 N 周(列)× 7 天(行)的热力网格,周一开头 */
export function heatmapWeeks(
  habit: Habit,
  logs: HabitLog[],
  weeks: number,
  today = new Date(),
): { dayKey: string; count: number; ratio: number; due: boolean; future: boolean }[][] {
  const thisWeek = startOfWeek(today, 1);
  const firstWeek = addDays(thisWeek, -(weeks - 1) * 7);
  const cols: { dayKey: string; count: number; ratio: number; due: boolean; future: boolean }[][] = [];
  const todayKey = dayKeyOf(today);
  for (let w = 0; w < weeks; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(firstWeek, w * 7 + d);
      const key = dayKeyOf(date);
      const count = logCountOn(logs, habit.id, key);
      col.push({
        dayKey: key,
        count,
        ratio: Math.min(1, count / (habit.targetPerDay ?? 1)),
        due: isDueOn(habit, key),
        future: key > todayKey,
      });
    }
    cols.push(col);
  }
  return cols;
}

/** 今日应做的习惯(用于 Dashboard 迷你条) */
export function habitsDueToday(habits: Habit[], now = new Date()): Habit[] {
  const key = dayKeyOf(now);
  return habits.filter((h) => !h.archivedAt && !h.deletedAt && isDueOn(h, key));
}
