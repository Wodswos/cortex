import { describe, expect, it } from 'vitest';
import { taskContextIds, workProgress, workSignals } from '../src/work';
import { buildChildrenMap, subtreeProgress } from '../src/tree';
import type { Task, ScheduleEvent } from '../src/types';

const now = new Date(2026, 9, 28, 12);
const task = (id: string, patch: Partial<Task> = {}): Task => ({
  id,
  title: id,
  parentId: null,
  status: 'todo',
  important: false,
  urgent: false,
  tags: [],
  ownerId: 'fixture',
  order: 0,
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});
const event = (taskId: string, patch: Partial<ScheduleEvent> = {}): ScheduleEvent => ({
  id: taskId,
  taskId,
  title: taskId,
  start: new Date(2026, 9, 29, 10).getTime(),
  end: new Date(2026, 9, 29, 11).getTime(),
  kind: 'focus',
  ownerId: 'fixture',
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

describe('work focus', () => {
  it('separates active work, week plans and factual risk signals without promoting historic todos', () => {
    const tasks = [
      task('doing', { status: 'doing' }),
      task('old_due', { dueAt: new Date(2026, 8, 1).getTime() }),
      task('week_due', { dueAt: new Date(2026, 9, 30).getTime() }),
      task('cross_week', {
        startAt: new Date(2026, 9, 23).getTime(),
        dueAt: new Date(2026, 10, 8).getTime(),
      }),
      task('important', { priority: 'P1' }),
      task('historic_todo'),
      task('future', { dueAt: new Date(2026, 10, 10).getTime() }),
      task('done', { status: 'done', priority: 'P0', dueAt: 1 }),
      task('folder', { kind: 'node', status: 'doing' }),
      task('deleted', { deletedAt: 2, priority: 'P0' }),
      task('inbox', { status: 'inbox', priority: 'P0' }),
    ];
    const signals = workSignals(tasks, [], now);
    expect([...signals.doing]).toEqual(['doing']);
    expect([...signals.week]).toEqual(['week_due', 'cross_week']);
    expect([...signals.overdue]).toEqual(['old_due']);
    expect([...signals.unscheduled]).toEqual(['important']);
    expect([...signals.current]).toEqual(['doing', 'week_due', 'cross_week']);
  });
  it('includes linked week events and treats future events as a valid schedule', () => {
    const tasks = [
      task('scheduled', { priority: 'P1' }),
      task('past_event', { priority: 'P1' }),
      task('completed_event', { priority: 'P1' }),
    ];
    const signals = workSignals(
      tasks,
      [
        event('scheduled'),
        event('past_event', { start: 1, end: 2 }),
        event('completed_event', { completed: true }),
      ],
      now,
    );
    expect([...signals.week]).toEqual(['scheduled']);
    expect([...signals.unscheduled]).toEqual(['past_event', 'completed_event']);
  });
  it('uses the configured week boundary with an exclusive end', () => {
    const sunday = new Date(2026, 10, 1, 12);
    const tasks = [
      task('sunday', { dueAt: new Date(2026, 10, 1, 18).getTime() }),
      task('next_monday', { dueAt: new Date(2026, 10, 2).getTime() }),
    ];
    expect([...workSignals(tasks, [], sunday, 1).week]).toEqual(['sunday']);
    expect([...workSignals(tasks, [], sunday, 0).week]).toEqual(['sunday', 'next_monday']);
  });
  it('preserves ancestor context, avoids cycles and calculates full-project progress', () => {
    const tasks = [
      task('project', { kind: 'node' }),
      task('section', { parentId: 'project', kind: 'node' }),
      task('active', { parentId: 'section', status: 'doing' }),
      task('finished', { parentId: 'section', status: 'done' }),
      task('later', { parentId: 'project' }),
    ];
    expect([...taskContextIds(tasks, ['active'])]).toEqual(['active', 'section', 'project']);
    expect(workProgress(tasks).get('project')).toEqual({ done: 1, total: 3 });
    expect(subtreeProgress('project', buildChildrenMap(tasks))).toEqual({ done: 1, total: 3 });
    expect(workProgress(tasks).get('section')).toEqual({ done: 1, total: 2 });
    expect([...taskContextIds([task('a', { parentId: 'b' }), task('b', { parentId: 'a' })], ['a'])]).toEqual([
      'a',
      'b',
    ]);
  });
});
