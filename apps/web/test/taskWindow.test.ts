import { describe, expect, it } from 'vitest';
import { addDays, dayKeyOf, type Task } from '@cortex/core';
import { readTaskWindow, taskMatchesWindow, tasksInWindow, windowDueAt } from '../src/features/tasks/taskWindow';
import { createWheelPager } from '../src/features/tasks/gantt/wheelPaging';

const day = (value: string) => new Date(`${value}T00:00:00`).getTime();
const task = (id: string, patch: Partial<Task> = {}): Task => ({ id, title: id, status: 'todo', parentId: null, ownerId: 'u', order: 0, tags: [], important: false, urgent: false, createdAt: 1, updatedAt: 1, ...patch });
const custom = (from: string, to = from) => readTaskWindow(new URLSearchParams({ scope: 'custom', from, to }), new Date(2026, 10, 3), 1);

describe('workspace time windows', () => {
  it('keeps structural views full by default and temporal views on the configured week', () => {
    const now = new Date(2026, 10, 3);
    expect(readTaskWindow(new URLSearchParams(), now, 1).scope).toBe('all');
    expect(dayKeyOf(readTaskWindow(new URLSearchParams(), now, 1, true).start)).toBe('2026-11-02');
    expect(dayKeyOf(readTaskWindow(new URLSearchParams(), now, 0, true).start)).toBe('2026-11-01');
    expect(readTaskWindow(new URLSearchParams('scope=month'), new Date(2028, 1, 1), 1).days).toBe(29);
  });
  it('rejects malformed dates, reversed ranges and unbounded spans', () => {
    expect(dayKeyOf(custom('2026-02-31').start)).toBe('2026-11-03');
    expect(custom('2026-11-03', '2026-11-01').days).toBe(1);
    expect(custom('2026-11-03', '2099-12-31').days).toBe(366);
  });
  it('matches overlapping work and retains only its ancestry; matrix filtering excludes context-only ancestors', () => {
    const values = [task('project', { kind: 'node' }), task('phase', { parentId: 'project', kind: 'node' }), task('ongoing', { parentId: 'phase', startAt: day('2026-11-01'), dueAt: day('2026-11-05') }), task('future', { parentId: 'phase', dueAt: day('2026-12-01') }), task('done', { status: 'done', dueAt: day('2026-11-03') })];
    const range = custom('2026-11-03');
    expect(tasksInWindow(values, range).map((t) => t.id)).toEqual(['project', 'phase', 'ongoing', 'done']);
    expect(tasksInWindow(values, range, false).map((t) => t.id)).toEqual(['ongoing', 'done']);
    expect(taskMatchesWindow(task('tomorrow', { startAt: day('2026-11-04') }), range)).toBe(false);
    expect(taskMatchesWindow(task('start-only', { startAt: day('2026-11-03') }), range)).toBe(true);
    expect(taskMatchesWindow(task('no-date'), range)).toBe(false);
    expect(windowDueAt(range, day('2026-12-01'))).toBe(day('2026-11-04') - 60000);
    expect(windowDueAt(custom('2026-11-01', '2026-11-07'), day('2026-11-03'))).toBe(day('2026-11-04') - 60000);
  });
  it('keeps undated actionable work accessible and handles cyclic imported ancestry', () => {
    const range = readTaskWindow(new URLSearchParams('scope=undated'), new Date(), 1);
    const values = [task('a', { parentId: 'b' }), task('b', { parentId: 'a', kind: 'node' }), task('dated', { dueAt: day('2026-11-03') })];
    expect(tasksInWindow(values, range).map((t) => t.id)).toEqual(['a', 'b']);
    expect(tasksInWindow(values, range, false).map((t) => t.id)).toEqual(['a']);
    expect(windowDueAt(range)).toBeUndefined();
  });
  it('counts calendar days through daylight-saving transitions', () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = 'America/New_York';
      const range = custom('2026-10-31', '2026-11-02');
      expect(range.days).toBe(3);
      expect(dayKeyOf(addDays(range.start, range.days))).toBe('2026-11-03');
    } finally { process.env.TZ = previous; }
  });
});

describe('Gantt trackpad paging', () => {
  const sample = (pager: ReturnType<typeof createWheelPager>, time: number, deltaX: number, deltaY = 0, rest = {}) => pager.sample({ time, deltaX, deltaY, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, ...rest }, 900);
  it('requires deliberate movement, pages once per gesture and absorbs its momentum', () => {
    const pager = createWheelPager();
    expect(sample(pager, 0, 20).direction).toBe(0);
    expect(sample(pager, 16, 30).direction).toBe(0);
    expect(sample(pager, 32, 30)).toEqual({ prevent: true, direction: 1 });
    for (let i = 1; i <= 30; i++) expect(sample(pager, 32 + i * 20, 80)).toEqual({ prevent: true, direction: 0 });
    expect(sample(pager, 1000, -90)).toEqual({ prevent: true, direction: -1 });
  });
  it('leaves vertical and diagonal scrolling, pinch and modified scrolling alone', () => {
    const pager = createWheelPager();
    expect(sample(pager, 0, 8, 40)).toEqual({ prevent: false, direction: 0 });
    expect(sample(pager, 10, 100, 1).direction).toBe(0); // axis stays vertical
    expect(sample(pager, 500, 50, 45).prevent).toBe(false);
    for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey']) expect(sample(pager, 1000, 100, 0, { [modifier]: true })).toEqual({ prevent: false, direction: 0 });
  });
  it('normalizes line/page wheel deltas and resets when a task drag begins', () => {
    const pager = createWheelPager();
    expect(sample(pager, 0, 5, 0, { deltaMode: 1 }).direction).toBe(1);
    pager.reset();
    expect(sample(pager, 10, -1, 0, { deltaMode: 2 }).direction).toBe(-1);
  });
});
