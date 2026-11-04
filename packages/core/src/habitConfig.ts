import type { Habit } from './types';

export const MAX_HABIT_REMINDER_TIMES = 24;
const validTime = (value: unknown): value is string => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

/** Canonical local times, with a fallback for habits created before multi-time support. */
export function habitReminderTimes(habit: Pick<Habit, 'reminderAt' | 'reminderTimes'>): string[] {
  return [...new Set((habit.reminderTimes ?? (habit.reminderAt ? [habit.reminderAt] : [])).filter(validTime))].sort();
}

/** Validate habit configuration before any local write or backup import. */
export function validateHabitConfig(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('习惯配置无效');
  const item = value as Record<string, unknown>;
  if (item.name !== undefined && (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 200)) throw new Error('习惯名称需为 1–200 个字符');
  if (item.reminderAt !== undefined && (typeof item.reminderAt !== 'string' || item.reminderAt !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.reminderAt))) throw new Error('打卡时间需为有效的时分');
  if (item.reminderEnabled !== undefined && typeof item.reminderEnabled !== 'boolean') throw new Error('提醒开关无效');
  if (item.reminderTimes !== undefined && (!Array.isArray(item.reminderTimes) || item.reminderTimes.length > MAX_HABIT_REMINDER_TIMES || !item.reminderTimes.every(validTime) || new Set(item.reminderTimes).size !== item.reminderTimes.length)) throw new Error(`打卡时间需有效且不重复，最多 ${MAX_HABIT_REMINDER_TIMES} 个`);
  if (item.targetPerDay !== undefined && (!Number.isInteger(item.targetPerDay) || Number(item.targetPerDay) < 1 || Number(item.targetPerDay) > 10000)) throw new Error('每日目标需为 1–10000 的整数');
  if (item.cadence === undefined) return;
  if (!item.cadence || typeof item.cadence !== 'object' || Array.isArray(item.cadence)) throw new Error('习惯频率无效');
  const cadence = item.cadence as Record<string, unknown>;
  if (cadence.type === 'daily') return;
  if (cadence.type === 'weekly' && Number.isInteger(cadence.timesPerWeek) && Number(cadence.timesPerWeek) >= 1 && Number(cadence.timesPerWeek) <= 100 && (cadence.days === undefined || Array.isArray(cadence.days) && cadence.days.every(day => Number.isInteger(day) && day >= 1 && day <= 7))) return;
  if (cadence.type === 'interval' && Number.isInteger(cadence.everyNDays) && Number(cadence.everyNDays) > 0) return;
  if (cadence.type === 'custom' && typeof cadence.cron === 'string') return;
  throw new Error('习惯频率无效');
}
