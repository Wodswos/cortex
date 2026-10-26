import { describe, it, expect } from 'vitest';
import { dayKeyOf, dateFromDayKey, startOfDay, endOfDay, addDays, startOfWeek, weekdayOf, nextWeekday } from '../src/time';

describe('time', () => {
  it('dayKeyOf 本地时区', () => {
    expect(dayKeyOf(new Date(2026, 7, 29, 23, 59))).toBe('2026-08-29');
    expect(dayKeyOf(new Date(2026, 7, 29, 0, 0))).toBe('2026-08-29');
  });
  it('dayKeyOf 与 dateFromDayKey 互逆', () => {
    const d = dateFromDayKey('2026-08-29');
    expect(dayKeyOf(d)).toBe('2026-08-29');
  });
  it('endOfDay 是次日 00:00 开区间', () => {
    const e = endOfDay(new Date(2026, 7, 29, 15, 0));
    expect(e.getDate()).toBe(30);
    expect(e.getHours()).toBe(0);
  });
  it('startOfWeek 周一开头', () => {
    const w = startOfWeek(new Date(2026, 7, 29), 1); // 周六
    expect(weekdayOf(w)).toBe(1);
    expect(w.getDate()).toBe(24); // 周一
  });
  it('nextWeekday 周六找下周一直接命中当天', () => {
    const sat = new Date(2026, 7, 29);
    const mon = nextWeekday(sat, 1);
    expect(dayKeyOf(mon)).toBe('2026-08-31');
    const mon2 = nextWeekday(new Date(2026, 7, 31), 1);
    expect(dayKeyOf(mon2)).toBe('2026-08-31'); // 当天算当天
  });
  it('addDays 跨月', () => {
    expect(dayKeyOf(addDays(new Date(2026, 7, 31), 1))).toBe('2026-09-01');
  });
});
