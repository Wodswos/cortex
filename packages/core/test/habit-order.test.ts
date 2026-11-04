import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS, habitOrderAfterMove, sortedHabits, validateCortexData, type Habit } from '../src';
const habit = (id: string, createdAt: number, reminderAt = ''): Habit => ({ id, name: id, createdAt, reminderAt, reminderEnabled: false, cadence: { type: 'daily' }, color: '#6b80ae', icon: 'Check', ownerId: 'u' });
it('orders timed habits first, breaks equal-time ties by manual order, and keeps legacy/new entries stable', () => {
  const values = [habit('none', 1), habit('late', 2, '21:00'), habit('morning_b', 4, '08:00'), habit('morning_a', 3, '08:00')];
  expect(sortedHabits(values, DEFAULT_SETTINGS).map(habit => habit.id)).toEqual(['morning_a', 'morning_b', 'late', 'none']);
  const settings = { habitSort: 'manual' as const, habitOrder: ['late', 'morning_b'] };
  expect(sortedHabits(values, settings).map(habit => habit.id)).toEqual(['late', 'morning_b', 'none', 'morning_a']);
  expect(sortedHabits(values, { ...settings, habitSort: 'time' }).map(habit => habit.id)).toEqual(['morning_b', 'morning_a', 'late', 'none']);
  expect(values.map(habit => habit.id)).toEqual(['none', 'late', 'morning_b', 'morning_a']);
});
it('bases drags on the visible order, excludes inactive entries and preserves unseen ranks during sync', () => {
  const values = [habit('none', 1), habit('late', 2, '21:00'), habit('early', 3, '08:00'), { ...habit('deleted', 4), deletedAt: 1 }];
  const settings = { habitSort: 'time' as const, habitOrder: ['unloaded', 'deleted'] };
  expect(habitOrderAfterMove(values, settings, 'none', 'early')).toEqual(['none', 'early', 'late', 'unloaded', 'deleted']);
  expect(habitOrderAfterMove(values, settings, 'early', 'early')).toBeNull();
  expect(habitOrderAfterMove(values, settings, 'missing', 'early')).toBeNull();
  expect(habitOrderAfterMove(values, settings, 'deleted', 'early')).toBeNull();
});
it('rejects duplicate or malformed imported ordering before any writes', () => {
  for (const settings of [{ habitSort: 'other' }, { habitOrder: ['same', 'same'] }, { habitOrder: [1] }, { habitOrder: ['bad/id'] }]) expect(() => validateCortexData({ settings })).toThrow();
  expect(() => validateCortexData({ settings: { habitSort: 'manual', habitOrder: [] } })).not.toThrow();
});
it('sorts multi-time habits by their earliest time and respects explicitly cleared legacy times', () => {
  const values = [habit('noon', 1, '12:00'), { ...habit('twice', 2, '20:00'), reminderTimes: ['20:00', '08:00'] }, { ...habit('cleared', 3, '07:00'), reminderTimes: [] }];
  expect(sortedHabits(values, DEFAULT_SETTINGS).map(habit => habit.id)).toEqual(['twice', 'noon', 'cleared']);
});
