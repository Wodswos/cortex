import { describe, expect, it } from 'vitest';
import { habitReminderDue, habitReminderSlot, habitReminderTimes, validateCortexData, validateHabitConfig, type Habit, type HabitLog } from '../src';
const habit = (patch: Partial<Habit> = {}): Habit => ({ id: 'habit', name: '阅读', icon: 'Flame', color: '#6b80ae', cadence: { type: 'daily' }, reminderAt: '20:00', targetPerDay: 2, ownerId: 'u', createdAt: new Date('2026-11-01T12:00:00').getTime(), ...patch });
const log = (date: string, count: number, patch: Partial<HabitLog> = {}): HabitLog => ({ id: 'log', habitId: 'habit', date, count, ownerId: 'u', ...patch });
const at = (time: string) => new Date(`2026-11-04T${time}:00`);
describe('habit reminders', () => {
  it('uses local time, catches up late, stops after today is complete, and honors cancellation units', () => {
    expect(habitReminderDue(habit(), [], at('19:59'))).toBe(false);
    expect(habitReminderDue(habit(), [], at('20:00'))).toBe(true);
    expect(habitReminderDue(habit(), [log('2026-11-04', 1)], at('21:00'))).toBe(true);
    expect(habitReminderDue(habit(), [log('2026-11-04', 2)], at('21:00'))).toBe(false);
    expect(habitReminderDue(habit(), [log('2026-11-04', 2), log('2026-11-04', 0, { id: 'cancel', cancelledUnits: ['log:0'] })], at('21:00'))).toBe(true);
    for (const patch of [{ reminderAt: '' }, { reminderAt: '25:00' }, { reminderEnabled: false }, { archivedAt: 1 }, { deletedAt: 1 }, { createdAt: at('22:00').getTime() }]) expect(habitReminderDue(habit(patch), [], at('21:00'))).toBe(false);
  });
  it('respects scheduled weekdays, interval anchors and unsupported custom rules', () => {
    expect(habitReminderDue(habit({ cadence: { type: 'weekly', days: [1, 3, 5], timesPerWeek: 3 } }), [], at('20:00'))).toBe(true);
    expect(habitReminderDue(habit({ cadence: { type: 'weekly', days: [2, 4], timesPerWeek: 2 } }), [], at('20:00'))).toBe(false);
    expect(habitReminderDue(habit({ cadence: { type: 'interval', everyNDays: 3 } }), [], at('20:00'))).toBe(true);
    expect(habitReminderDue(habit({ cadence: { type: 'interval', everyNDays: 2 } }), [], at('20:00'))).toBe(false);
    expect(habitReminderDue(habit({ cadence: { type: 'custom', cron: '*' } }), [], at('20:00'))).toBe(false);
  });
  it('stops flexible weekly reminders after the quota and resets on a new week', () => {
    const flexible = habit({ cadence: { type: 'weekly', timesPerWeek: 3 } });
    expect(habitReminderDue(flexible, [log('2026-11-02', 2)], at('20:00'))).toBe(true);
    expect(habitReminderDue(flexible, [log('2026-11-02', 3)], at('20:00'))).toBe(false);
    expect(habitReminderDue(flexible, [log('2026-11-01', 3)], at('20:00'))).toBe(true);
  });
  it('rejects malformed schedule writes and imports while supporting legacy optional reminders', () => {
    expect(() => validateCortexData({ habits: [habit()] })).not.toThrow();
    expect(() => validateHabitConfig({ reminderAt: '', reminderEnabled: false })).not.toThrow();
    for (const patch of [{ name: '' }, { reminderAt: '24:00' }, { reminderAt: '8:00' }, { reminderEnabled: 'yes' }, { targetPerDay: 1.5 }, { cadence: { type: 'weekly', timesPerWeek: 0 } }]) expect(() => validateCortexData({ habits: [{ ...habit(), ...patch }] })).toThrow();
  });
  it('stages multiple times by cumulative progress, catches missed slots and counts early check-ins', () => {
    const twice = habit({ reminderTimes: ['20:00', '08:00'] });
    expect(habitReminderTimes(twice)).toEqual(['08:00', '20:00']);
    expect(habitReminderSlot(twice, [], at('07:59'))).toBeNull();
    expect(habitReminderSlot(twice, [], at('08:00'))).toEqual({ time: '08:00', target: 1 });
    expect(habitReminderSlot(twice, [log('2026-11-04', 1)], at('19:59'))).toBeNull();
    expect(habitReminderSlot(twice, [log('2026-11-04', 1)], at('20:00'))).toEqual({ time: '20:00', target: 2 });
    expect(habitReminderSlot(twice, [], at('23:59'))).toEqual({ time: '20:00', target: 2 });
    expect(habitReminderSlot(twice, [log('2026-11-04', 2)], at('20:00'))).toBeNull();
    expect(habitReminderSlot(twice, [log('2026-11-03', 2)], at('08:00'))).toEqual({ time: '08:00', target: 1 });
    expect(habitReminderSlot({ ...twice, targetPerDay: 3 }, [log('2026-11-04', 1)], at('08:00'))).toEqual({ time: '08:00', target: 2 });
    expect(habitReminderSlot({ ...twice, targetPerDay: 1 }, [log('2026-11-04', 1)], at('20:00'))).toBeNull();
    expect(habitReminderSlot({ ...twice, reminderEnabled: false }, [], at('20:00'))).toBeNull();
    expect(habitReminderSlot({ ...twice, cadence: { type: 'weekly', timesPerWeek: 2 } }, [log('2026-11-02', 2)], at('20:00'))).toBeNull();
    expect(habitReminderTimes(habit({ reminderTimes: [] }))).toEqual([]);
    expect(habitReminderDue(habit({ reminderTimes: [] }), [], at('20:00'))).toBe(false);
  });
  it('validates all multi-time schedules before import, including duplicates and size limits', () => {
    expect(() => validateCortexData({ habits: [habit({ reminderTimes: ['08:00', '20:00'] })] })).not.toThrow();
    for (const reminderTimes of [null, '08:00', ['08:00', '08:00'], ['8:00'], ['24:00'], [1], [''], Array.from({ length: 25 }, (_, i) => `${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`)]) {
      expect(() => validateHabitConfig({ reminderTimes })).toThrow();
      expect(() => validateCortexData({ habits: [{ ...habit(), reminderTimes }] })).toThrow();
    }
  });
});
