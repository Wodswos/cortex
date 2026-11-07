import { expect, it } from 'vitest';
import { reviewDayStart } from '../src/reviewZone';
it('interprets review dates in the caller timezone, including 23/25-hour DST days', () => {
  expect(new Date(reviewDayStart('2026-11-04', 'Asia/Shanghai')).toISOString()).toBe('2026-11-03T16:00:00.000Z');
  expect(new Date(reviewDayStart('2026-11-04', 'UTC')).toISOString()).toBe('2026-11-04T00:00:00.000Z');
  expect(reviewDayStart('2026-03-09', 'America/New_York') - reviewDayStart('2026-03-08', 'America/New_York')).toBe(23 * 3600000);
  expect(reviewDayStart('2026-11-02', 'America/New_York') - reviewDayStart('2026-11-01', 'America/New_York')).toBe(25 * 3600000);
  expect(() => reviewDayStart('2026-11-04', 'not/a-zone')).toThrow();
  expect(() => reviewDayStart('2011-12-30', 'Pacific/Apia')).toThrow();
});
