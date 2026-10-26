import { describe, it, expect } from 'vitest';
import { generateICS } from '../src/ics';

describe('generateICS', () => {
  it('基本结构 + CRLF', () => {
    const out = generateICS([
      { uid: 'e1', title: '评审会', start: new Date(Date.UTC(2026, 8, 1, 2, 0)), end: new Date(Date.UTC(2026, 8, 1, 3, 0)) },
    ]);
    expect(out).toContain('BEGIN:VCALENDAR\r\n');
    expect(out).toContain('BEGIN:VEVENT\r\n');
    expect(out).toContain('DTSTART:20260901T020000Z\r\n');
    expect(out).toContain('DTEND:20260901T030000Z\r\n');
    expect(out).toContain('SUMMARY:评审会\r\n');
    expect(out.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
  it('转义分号/逗号/换行', () => {
    const out = generateICS([{ uid: 'e2', title: 'a,b;c\nd', start: new Date() }]);
    expect(out).toContain('SUMMARY:a\\,b\\;c\\nd');
  });
  it('allDay 输出 VALUE=DATE', () => {
    const out = generateICS([{ uid: 'e3', title: 'x', start: new Date(2026, 8, 1), allDay: true }]);
    expect(out).toContain('DTSTART;VALUE=DATE:20260901');
  });
  it('缺省 end = start + 30min', () => {
    const out = generateICS([{ uid: 'e4', title: 'x', start: new Date(Date.UTC(2026, 8, 1, 8, 0)) }]);
    expect(out).toContain('DTEND:20260901T083000Z');
  });
});
