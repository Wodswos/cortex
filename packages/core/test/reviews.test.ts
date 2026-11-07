import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, EMPTY_DATA, type Review, type Task } from '../src/types';
import { dueReviews, reviewFacts, reviewId, reviewMarkdown, reviewPeriod, validDayKey } from '../src/reviews';
import { validateCortexData } from '../src/validation';

const task = (id: string, patch: Partial<Task> = {}): Task => ({
  id, title: id, parentId: null, status: 'todo', ownerId: 'u', order: 0, tags: [], important: false,
  urgent: false, createdAt: 1, updatedAt: 1, ...patch,
});

describe('review calendar and facts', () => {
  it('uses explicit caller-zone boundaries for Agent-generated review facts', () => {
    const start = Date.parse('2026-11-03T16:00:00Z'), end = Date.parse('2026-11-04T16:00:00Z');
    const data = { ...EMPTY_DATA, tasks: [task('local-morning', { status: 'done' as const, completedAt: start + 3600000 }), task('before', { status: 'done' as const, completedAt: start - 1 }), task('after', { status: 'done' as const, completedAt: end })] };
    const facts = reviewFacts(data, { kind: 'daily', start: '2026-11-04', end: '2026-11-05' }, end, { start, end });
    expect(facts.completed.map(task => task.id)).toEqual(['local-morning']);
  });
  it('uses local calendar boundaries and the configured week start', () => {
    const date = new Date(2026, 9, 25, 23, 40);
    expect(reviewPeriod('daily', date)).toEqual({ kind: 'daily', start: '2026-10-25', end: '2026-10-26' });
    expect(reviewPeriod('weekly', date, 1)).toEqual({ kind: 'weekly', start: '2026-10-19', end: '2026-10-26' });
    expect(reviewPeriod('weekly', date, 0)).toEqual({ kind: 'weekly', start: '2026-10-25', end: '2026-11-01' });
    expect(validDayKey('2026-02-30')).toBe(false);
    expect(validDayKey('2024-02-29')).toBe(true);
  });
  it('uses completion timestamps, excludes structural/deleted tasks and prorates cross-midnight focus', () => {
    const start = new Date(2026, 9, 25).getTime(), now = start + 20 * 3600000;
    const tasks = [task('project', { kind: 'node', project: true }),
      task('done', { parentId: 'project', status: 'done', completedAt: start + 1000 }),
      task('old', { status: 'done', completedAt: start - 1, updatedAt: now }),
      task('boundary', { status: 'done', completedAt: start + 86400000 }),
      task('deleted', { status: 'done', completedAt: start + 2000, deletedAt: now }),
      task('due', { parentId: 'project', dueAt: start + 3000 }),
      task('upcoming', { dueAt: now + 1000 })];
    const session = { id: 's', taskId: 'done', startedAt: start - 1800000, endedAt: start + 1800000, actualMin: 40, plannedMin: 60, mode: 'focus' as const, completed: false, ownerId: 'u' };
    const facts = reviewFacts({ ...EMPTY_DATA, tasks, sessions: [session, { ...session, id: 'break', mode: 'short-break' }] }, reviewPeriod('daily', start), now);
    expect(facts.completed.map(task => task.id)).toEqual(['done']);
    expect(facts.completed[0]!.project).toBe('project');
    expect(facts.pending.map(task => task.id)).toEqual(['due']);
    expect(facts.focusMin).toBe(20);
    expect(facts.projects).toEqual([{ id: 'project', title: 'project', done: 1, total: 2 }]);
  });
  it('handles DST days without assuming twenty-four hours', () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = 'America/New_York';
      const start = new Date(2026, 2, 8).getTime(), end = new Date(2026, 2, 9).getTime();
      expect(end - start).toBe(23 * 3600000);
      const facts = reviewFacts({ ...EMPTY_DATA, sessions: [{ id: 'dst', taskId: null, startedAt: start, endedAt: end, actualMin: 60, plannedMin: 60, mode: 'focus', completed: true, ownerId: 'u' }] }, reviewPeriod('daily', start), end);
      expect(facts.focusMin).toBe(60);
    } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
  });
});

describe('review reminders and validation', () => {
  it('defaults to daily 21:30 and Sunday 20:00, advances exactly at the configured minute', () => {
    expect(DEFAULT_SETTINGS.reviewDailyTime).toBe('21:30');
    expect(DEFAULT_SETTINGS.reviewWeeklyTime).toBe('20:00');
    expect(DEFAULT_SETTINGS.reviewWeeklyDay).toBe(0);
    const before = dueReviews([], DEFAULT_SETTINGS, new Date(2026, 9, 25, 19, 59).getTime());
    expect(before.map(reviewId)).toEqual(['weekly_2026-10-12', 'daily_2026-10-24']);
    const weekly = dueReviews([], DEFAULT_SETTINGS, new Date(2026, 9, 25, 20).getTime());
    expect(weekly.map(reviewId)).toEqual(['weekly_2026-10-19', 'daily_2026-10-24']);
    const daily = dueReviews([], DEFAULT_SETTINGS, new Date(2026, 9, 25, 21, 30).getTime());
    expect(daily.map(reviewId)).toEqual(['weekly_2026-10-19', 'daily_2026-10-25']);
  });
  it('does not keep prompting completed periods or create a backlog, and respects disabled reminders', () => {
    const now = new Date(2026, 9, 25, 22).getTime();
    const completed = dueReviews([], DEFAULT_SETTINGS, now).map(period => ({ id: reviewId(period), completedAt: now } as Review));
    expect(dueReviews(completed, DEFAULT_SETTINGS, now)).toEqual([]);
    expect(dueReviews([], { ...DEFAULT_SETTINGS, reviewDailyEnabled: false, reviewWeeklyEnabled: false }, now)).toEqual([]);
    expect(dueReviews([], DEFAULT_SETTINGS, new Date(2027, 0, 1, 22).getTime())).toHaveLength(2);
  });
  it('rejects invalid periods, snapshots and reminder settings before import', () => {
    expect(() => validateCortexData({ settings: { reviewDailyTime: '24:00' } })).toThrow();
    expect(() => validateCortexData({ settings: { reviewWeeklyDay: 7 } })).toThrow();
    expect(() => validateCortexData({ reviews: [{ id: 'daily_2026-02-30', kind: 'daily', periodStart: '2026-02-30', periodEnd: '2026-03-03' }] })).toThrow();
    expect(() => validateCortexData({ tasks: [] })).not.toThrow();
  });
  it('accepts older backups and validates and exports the separate solution field', () => {
    const legacy = { id: 'daily_2026-10-25', kind: 'daily', periodStart: '2026-10-25', periodEnd: '2026-10-26', highlights: '', friction: 'Late feedback', nextSteps: '' };
    expect(() => validateCortexData({ reviews: [legacy] })).not.toThrow();
    expect(() => validateCortexData({ reviews: [{ ...legacy, resolution: null }] })).toThrow();
    expect(() => validateCortexData({ reviews: [{ ...legacy, resolution: 7 }] })).toThrow();
    expect(() => validateCortexData({ reviews: [{ ...legacy, resolution: 'x'.repeat(100001) }] })).toThrow();
    const review: Review = { ...legacy, kind: 'daily', resolution: 'Review together before implementation', facts: null, completedAt: null, ownerId: 'u', createdAt: 1, updatedAt: 1 };
    expect(() => validateCortexData({ reviews: [review] })).not.toThrow();
    const facts = { capturedAt: 1, completed: [], pending: [], focusMin: 0, projects: [] };
    expect(reviewMarkdown(review, facts)).toContain('## 阻碍与反思\nLate feedback\n\n### 如何解决？\nReview together before implementation\n\n## 下一步');
  });
});
