import { describe, expect, it } from 'vitest';
import { EMPTY_DATA, addDays, dayKeyOf, type CortexData, type Task, type ScheduleEvent } from '@cortex/core';
import { readTaskFilters, selectWorkspaceTasks, workspaceCanvasWindow, workspaceTaskDefaults } from '../src/features/tasks/taskFilters';
import { readTaskWindow } from '../src/features/tasks/taskWindow';

const now = new Date(2026, 10, 4, 12);
const day = (value: string) => new Date(`${value}T12:00:00`).getTime();
const task = (id: string, patch: Partial<Task> = {}): Task => ({ id, title: id, status: 'todo', parentId: null, ownerId: 'u', order: 0, tags: [], important: false, urgent: false, createdAt: 1, updatedAt: 1, ...patch });
const event = (taskId: string, from: string, to: string, patch: Partial<ScheduleEvent> = {}): ScheduleEvent => ({ id: taskId, taskId, title: taskId, kind: 'focus', ownerId: 'u', start: day(from), end: day(to), createdAt: 1, updatedAt: 1, ...patch });
const data = (tasks: Task[], events: ScheduleEvent[] = []): CortexData => ({ ...EMPTY_DATA, tasks, events, settings: { ...EMPTY_DATA.settings } });
const choose = (values: CortexData, query: string) => selectWorkspaceTasks(values, new URLSearchParams(query), now);

describe('shared workspace filters', () => {
  it('current means doing or unfinished overdue, including historic backlog, never merely planned work', () => {
    const values = data([task('doing', { status: 'doing' }), task('old', { dueAt: day('2025-01-01') }), task('week', { dueAt: day('2026-11-06') }), task('finished', { status: 'done', dueAt: 1 }), task('todo'), task('inbox', { status: 'inbox', dueAt: 1 }), task('folder', { kind: 'node', status: 'doing' })]);
    expect([...choose(values, 'work=current&scope=all').matching]).toEqual(['doing', 'old']);
    expect([...choose(values, 'work=overdue&scope=all').matching]).toEqual(['old']);
    expect([...choose(values, 'work=current&scope=week').matching]).toEqual([]);
    expect([...choose(values, 'work=all&scope=week').matching]).toEqual(['week']);
  });
  it('combines dates, status, priority and tags, retaining only ancestor context for trees', () => {
    const values = data([task('project', { kind: 'node', project: true }), task('parent', { parentId: 'project', dueAt: day('2026-12-01') }), task('match', { parentId: 'parent', status: 'doing', priority: 'P1', tags: ['tag'], dueAt: day('2026-11-05') }), task('low', { parentId: 'parent', status: 'doing', priority: 'P3', tags: ['tag'], dueAt: day('2026-11-05') }), task('other', { status: 'doing', priority: 'P1', tags: ['tag'], dueAt: day('2026-11-05') })]);
    const selected = choose(values, 'project=project&scope=week&taskStatus=doing&taskPriority=high&taskTag=tag');
    expect([...selected.matching]).toEqual(['match']);
    expect([...selected.context]).toEqual(['match', 'parent', 'project']);
    expect([...choose(values, 'project=missing').matching]).toEqual([]);
    expect([...choose(values, 'root=parent&scope=week&taskPriority=P1').matching]).toEqual(['match']);
  });
  it('matches explicit intervals or linked events with calendar week boundaries', () => {
    const values = data([task('overlap', { startAt: day('2026-11-01'), dueAt: day('2026-11-03') }), task('event'), task('atEnd', { dueAt: new Date(2026, 10, 9).getTime() }), task('past')], [event('event', '2026-11-05', '2026-11-06'), event('past', '2026-09-01', '2026-09-02')]);
    expect([...choose(values, 'scope=week').matching]).toEqual(['overlap', 'event']);
    expect([...choose(values, 'scope=undated').matching]).toEqual(['past']);
    values.settings.weekStartsOn = 0;
    expect(dayKeyOf(choose(values, 'scope=week').range.start)).toBe('2026-11-01');
  });
  it('excludes deleted and archived projects and honors completed visibility without hiding live descendants', () => {
    const values = data([task('deleted', { kind: 'node', project: true, deletedAt: 2 }), task('child', { parentId: 'deleted' }), task('archived', { kind: 'node', project: true, status: 'archived' }), task('archived-child', { parentId: 'archived' }), task('done', { status: 'done' }), task('live', { parentId: 'done', status: 'doing' })]);
    values.settings.completedDisplay = 'hidden';
    const selected = choose(values, 'scope=all&work=current');
    expect([...selected.matching]).toEqual(['live']);
    expect([...selected.context]).toEqual(['live', 'done']);
    expect(choose(values, 'scope=all').tasks.map(t => t.id)).toEqual(['done', 'live']);
    expect(choose(values, 'root=child').tasks).toEqual([]);
  });
  it('terminates ancestor traversal through imported cycles and leaves empty matches empty', () => {
    const values = data([task('a', { parentId: 'b', status: 'doing' }), task('b', { parentId: 'a' })]);
    expect([...choose(values, 'work=current').context]).toEqual(['a', 'b']);
    expect([...choose(values, 'taskPriority=P0').matching]).toEqual([]);
    expect([...choose(values, 'taskPriority=P0').context]).toEqual([]);
  });
  it('accepts legacy focus links and ignores invalid filter values', () => {
    expect(readTaskFilters(new URLSearchParams('mindFocus=doing'))).toMatchObject({ focus: 'doing' });
    expect(readTaskFilters(new URLSearchParams('work=current&mindFocus=doing'))).toMatchObject({ focus: 'current' });
    expect(readTaskFilters(new URLSearchParams('work=bad&taskStatus=bad&taskPriority=bad&taskTag=https://bad'))).toEqual({ focus: 'all', status: 'all', priority: 'all' });
  });
  it('new tasks inherit explicit filters and overdue dates without setting dates for all-time work', () => {
    expect(workspaceTaskDefaults(new URLSearchParams('work=current&taskPriority=high&taskTag=tag'), now.getTime())).toMatchObject({ status: 'doing', priority: 'P1', tags: ['tag'] });
    expect(workspaceTaskDefaults(new URLSearchParams('work=overdue&scope=all'), now.getTime()).dueAt).toBeLessThan(now.getTime());
    expect(workspaceTaskDefaults(new URLSearchParams('scope=all'), now.getTime()).dueAt).toBeUndefined();
    expect(workspaceTaskDefaults(new URLSearchParams('work=current&taskStatus=todo'), now.getTime()).status).toBe('todo');
  });
});

describe('all-time temporal canvas', () => {
  const canvas = (values: CortexData, query: string) => { const params = new URLSearchParams(query); return workspaceCanvasWindow(values, params, now, readTaskWindow(params, now, 1, true)); };
  it('opens old overdue work in view instead of an empty current week', () => {
    const values = data([task('old', { dueAt: day('2025-01-01') }), task('later', { dueAt: day('2026-12-01') })]);
    const gantt = canvas(values, 'view=gantt&scope=all&work=overdue');
    expect(dayKeyOf(gantt.start)).toBe('2025-01-01');
    expect(gantt.days).toBe(1);
    expect(dayKeyOf(canvas(values, 'view=timeline&scope=all&work=overdue').start)).toBe('2025-01-01');
  });
  it('bounds the canvas to 366 calendar days while leaving task matching unbounded', () => {
    const values = data([task('old', { dueAt: day('2020-01-01') }), task('recent', { dueAt: day('2026-11-03') })]);
    const range = canvas(values, 'view=gantt&scope=all');
    expect(range.days).toBe(366);
    expect(dayKeyOf(addDays(range.start, range.days - 1))).toBe('2026-11-03');
    expect(choose(values, 'scope=all').matching.size).toBe(2);
  });
  it('retains a useful canvas for undated work and leaves explicit date windows untouched', () => {
    const values = data([task('undated')]);
    expect(canvas(values, 'view=gantt&scope=undated').days).toBe(7);
    expect(dayKeyOf(canvas(values, 'view=gantt&scope=custom&from=2026-10-01&to=2026-10-03').start)).toBe('2026-10-01');
  });
  it('counts daylight-saving transitions in calendar days', () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = 'America/New_York';
      const values = data([task('a', { dueAt: day('2026-10-31') }), task('b', { dueAt: day('2026-11-02') })]);
      expect(canvas(values, 'view=gantt&scope=all').days).toBe(3);
    } finally { process.env.TZ = previous; }
  });
});
