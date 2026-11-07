import { describe, expect, it } from 'vitest';
import { dayKeyOf, type Habit, type HabitLog } from '@cortex/core';
import { habitReminderKey, planHabitNotifications } from '../src/features/habits/reminderPlan';

const date = (day: string, time = '12:00') => new Date(`${day}T${time}:00`).getTime();
const habit = (id: string, patch: Partial<Habit> = {}): Habit => ({ id, name: id, icon: 'Flame', color: '#6b80ae', cadence: { type: 'daily' }, targetPerDay: 1, ownerId: 'owner', reminderAt: '09:00', createdAt: date('2026-10-01'), ...patch });
const log = (id: string, day: string, count = 1): HabitLog => ({ id: `${id}-${day}`, habitId: id, date: day, count, ownerId: 'owner' });
const readUntil = () => 0;

describe('native habit notification planning', () => {
  it('catches up today once and uses distinct local dates for future reminders', () => {
    const now = date('2026-11-04');
    const plans = planHabitNotifications('owner', [habit('read', { createdAt: date('2026-11-04', '11:00') })], [], now, {}, readUntil);
    expect(plans).toHaveLength(14);
    expect(plans[0]?.at).toBe(now + 1000);
    expect(plans[0]?.key).toBe(`${habitReminderKey('owner', 'read', '2026-11-04', '09:00')}:tz:${new Date(now).getTimezoneOffset()}`);
    expect(plans[1]?.at).toBe(date('2026-11-05', '09:00'));
    expect(plans[0]?.key).not.toBe(planHabitNotifications('other', [habit('read')], [], now, {}, readUntil)[0]?.key);
  });
  it('cancels completed, disabled, deleted and non-scheduled occurrences while keeping future days', () => {
    const habits = [habit('done'), habit('off', { reminderEnabled: false }), habit('deleted', { deletedAt: 1 }), habit('archived', { archivedAt: 1 }), habit('weekly', { cadence: { type: 'weekly', days: [1], timesPerWeek: 1 } }), habit('interval', { cadence: { type: 'interval', everyNDays: 2 }, createdAt: date('2026-11-04', '00:00') }), habit('custom', { cadence: { type: 'custom', cron: '* * * * *' } })];
    const plans = planHabitNotifications('owner', habits, [log('done', '2026-11-04')], date('2026-11-04'), {}, readUntil);
    expect(plans.some(plan => ['off', 'deleted', 'archived', 'custom'].includes(plan.habitId))).toBe(false);
    expect(plans.find(plan => plan.habitId === 'done')?.at).toBe(date('2026-11-05', '09:00'));
    expect(plans.filter(plan => plan.habitId === 'weekly').every(plan => new Date(plan.at).getDay() === 1)).toBe(true);
    expect(plans.filter(plan => plan.habitId === 'interval').map(plan => dayKeyOf(plan.at)).slice(0, 3)).toEqual(['2026-11-04', '2026-11-06', '2026-11-08']);
  });
  it('keeps a completed flexible week quiet without disabling the next week', () => {
    const plans = planHabitNotifications('owner', [habit('weekly', { cadence: { type: 'weekly', timesPerWeek: 2 } })], [log('weekly', '2026-11-02', 2)], date('2026-11-04'), {}, readUntil);
    expect(dayKeyOf(plans[0]!.at)).toBe('2026-11-09');
  });
  it('distinguishes snoozes from already delivered occurrences and closes only the current day', () => {
    const now = date('2026-11-04');
    const key = habitReminderKey('owner', 'read', '2026-11-04', '09:00');
    const snoozed = planHabitNotifications('owner', [habit('read')], [], now, {}, value => value === key ? now + 600000 : 0);
    expect(snoozed[0]?.at).toBe(now + 600000);
    expect(snoozed[0]?.key).toBe(`${key}:tz:${new Date(now).getTimezoneOffset()}:snooze:${now + 600000}`);
    const dismissed = planHabitNotifications('owner', [habit('read')], [], now, {}, value => value === key ? date('2026-11-05', '00:00') : 0);
    expect(dismissed[0]?.at).toBe(date('2026-11-05', '09:00'));
  });
  it('keeps scheduled wall-clock hours across daylight-saving changes', () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = 'America/New_York';
      const plans = planHabitNotifications('owner', [habit('read')], [], date('2026-10-31', '00:00'), {}, readUntil);
      expect(plans.slice(0, 3).map(plan => new Date(plan.at).getHours())).toEqual([9, 9, 9]);
      expect(plans[1]!.at - plans[0]!.at).toBe(25 * 3600000);
    } finally { process.env.TZ = previous; }
  });
  it('replaces native receipt keys after a timezone change without losing local snooze keys', () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = 'Asia/Shanghai';
      const shanghai = planHabitNotifications('owner', [habit('read')], [], date('2026-11-04', '00:00'), {}, readUntil);
      process.env.TZ = 'Asia/Tokyo';
      const tokyo = planHabitNotifications('owner', [habit('read')], [], date('2026-11-04', '00:00'), {}, readUntil);
      expect(shanghai[0]?.key).not.toBe(tokyo[0]?.key);
      expect(new Date(tokyo[0]!.at).getHours()).toBe(9);
      expect(shanghai[0]!.at - tokyo[0]!.at).toBe(3600000);
    } finally { process.env.TZ = previous; }
  });
  it('keeps multi-time progress rules and schedules only the latest overdue slot', () => {
    const read = habit('read', { reminderTimes: ['08:00', '20:00'], targetPerDay: 2 });
    const before = planHabitNotifications('owner', [read], [], date('2026-11-04', '07:00'), {}, readUntil);
    expect(before.slice(0, 2).map(plan => plan.at)).toEqual([date('2026-11-04', '08:00'), date('2026-11-04', '20:00')]);
    const morningDone = planHabitNotifications('owner', [read], [log('read', '2026-11-04')], date('2026-11-04'), {}, readUntil);
    expect(morningDone[0]?.at).toBe(date('2026-11-04', '20:00'));
    const late = planHabitNotifications('owner', [read], [], date('2026-11-04', '21:00'), {}, readUntil);
    expect(late[0]?.key).toContain(':2026-11-04:20:00:tz:');
    expect(dayKeyOf(late[1]!.at)).toBe('2026-11-05');
  });
});
