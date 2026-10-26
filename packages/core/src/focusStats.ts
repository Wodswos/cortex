import { FocusSession } from './types';
import { dayKeyOf, addDays } from './time';

export interface FocusStats {
  todayMin: number;
  todayCount: number;
  /** 连续有 ≥1 个完成专注会话的天数(今天没有不断,从昨天起算) */
  streakDays: number;
  last7: { dayKey: string; minutes: number }[]; // 旧→新
  totalMin: number;
}

export function computeFocusStats(sessions: FocusSession[], now: Date = new Date()): FocusStats {
  const focus = sessions.filter((s) => s.mode === 'focus' && s.actualMin > 0);
  const todayKey = dayKeyOf(now);
  let todayMin = 0;
  let todayCount = 0;
  let totalMin = 0;
  const byDay = new Map<string, number>();
  for (const s of focus) {
    const key = dayKeyOf(s.startedAt);
    byDay.set(key, (byDay.get(key) ?? 0) + s.actualMin);
    totalMin += s.actualMin;
  }
  todayMin = byDay.get(todayKey) ?? 0;
  todayCount = focus.filter((s) => dayKeyOf(s.startedAt) === todayKey).length;

  // streak
  let streakDays = 0;
  let cursor = new Date(now);
  if (!(byDay.get(dayKeyOf(cursor))! > 0)) cursor = addDays(cursor, -1);
  for (let i = 0; i < 3650; i++) {
    if ((byDay.get(dayKeyOf(cursor)) ?? 0) > 0) streakDays++;
    else break;
    cursor = addDays(cursor, -1);
  }

  const last7: { dayKey: string; minutes: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const key = dayKeyOf(addDays(now, -i));
    last7.push({ dayKey: key, minutes: byDay.get(key) ?? 0 });
  }

  return { todayMin, todayCount, streakDays, last7, totalMin };
}

/** 今日第 N 个番茄(进行中的会话之前的计数) */
export function pomodoroCountToday(sessions: FocusSession[], now: Date = new Date()): number {
  const key = dayKeyOf(now);
  return sessions.filter((s) => s.mode === 'focus' && s.completed && dayKeyOf(s.startedAt) === key).length;
}
