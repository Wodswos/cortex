import type { Habit, Settings } from './types';
import { habitReminderTimes } from './habitConfig';

type HabitOrdering = Pick<Settings, 'habitSort' | 'habitOrder'>;

export function validateHabitOrder(value: unknown): asserts value is string[] {
  if (!Array.isArray(value) || value.length > 200000 || !value.every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)) || new Set(value).size !== value.length) throw new Error('习惯排序配置无效');
}

/** Untimed habits come last. Equal times follow manual order; legacy/new habits
 * without a saved rank retain a deterministic creation order on every device. */
export function sortedHabits(habits: Habit[], settings: HabitOrdering): Habit[] {
  const ranks = new Map(settings.habitOrder.map((id, index) => [id, index]));
  const manual = (a: Habit, b: Habit) => (ranks.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(b.id) ?? Number.MAX_SAFE_INTEGER) || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
  return habits.filter(habit => !habit.deletedAt && !habit.archivedAt).sort((a, b) => settings.habitSort === 'time' ? (habitReminderTimes(a)[0] ?? '99:99').localeCompare(habitReminderTimes(b)[0] ?? '99:99') || manual(a, b) : manual(a, b));
}

/** Base a drag on the displayed order, including time mode. Preserve unseen ranks
 * while documents sync; reordering never changes the habits or their check-ins. */
export function habitOrderAfterMove(habits: Habit[], settings: HabitOrdering, active: string, over: string): string[] | null {
  if (active === over) return null;
  const visible = sortedHabits(habits, settings).map(habit => habit.id);
  const from = visible.indexOf(active), to = visible.indexOf(over);
  if (from < 0 || to < 0) return null;
  visible.splice(to, 0, visible.splice(from, 1)[0]!);
  const ids = new Set(visible);
  return [...visible, ...settings.habitOrder.filter(id => !ids.has(id))];
}
