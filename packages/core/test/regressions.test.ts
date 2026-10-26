import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';
import { generateICS } from '../src/ics';
import { weekDone } from '../src/cadence';
import { endOfDay, calendarPosition, timeAtCalendarPosition, addDays } from '../src/time';
import { taskRange } from '../src/tree';
import type { Habit, Task } from '../src/types';

describe('calendar and export regressions', () => {
  it('folds Chinese and emoji by UTF-8 octets without changing text', () => {
    const title = '中'.repeat(40) + 'a'.repeat(65) + '😀'.repeat(30);
    const output = generateICS([{ uid: 'test', title, start: new Date() }]);
    for (const line of output.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(output.replace(/\r\n /g, '')).toContain(`SUMMARY:${title}\r\n`);
  });
  it('counts the full local week even when given a date in its middle', () => {
    const habit = { id: 'h', cadence: { type: 'weekly', timesPerWeek: 3 } } as Habit;
    const logs = [{ id: 'l', habitId: 'h', ownerId: 'u', date: '2026-10-26', count: 1 }];
    expect(weekDone(habit, logs, new Date(2026, 9, 29))).toBe(1);
  });
  it('keeps date columns and day ends correct across both DST transitions', () => {
    const old = process.env.TZ; process.env.TZ = 'America/New_York';
    try {
      for (const day of [new Date(2026, 2, 8), new Date(2026, 10, 1)]) {
        const startAt = new Date(day).setHours(12);
        expect(taskRange({ startAt } as Task).end).toBe(endOfDay(day).getTime() - 1);
        expect(calendarPosition(addDays(day, 1).getTime(), day)).toBe(1);
        expect(timeAtCalendarPosition(calendarPosition(startAt, day), day)).toBeCloseTo(startAt, 0);
      }
    } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
  });
});
