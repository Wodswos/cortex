import { describe, expect, it } from 'vitest';
import { taskRange, type Task } from '@cortex/core';
import { ganttDragPatch, ganttDragRange, type GanttDragMode } from '../src/features/tasks/gantt/drag';

const date = (day: number, hour = 0, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
const task = (patch: Partial<Task>): Task => ({
  id: 't', title: 'Date-only task', parentId: null, status: 'todo', order: 0, ownerId: 'u',
  tags: [], important: false, urgent: false, createdAt: date(1), updatedAt: date(1), ...patch,
});
const drag = (value: Task, mode: GanttDragMode, deltaMin: number) => {
  const preview = ganttDragRange(taskRange(value), mode, deltaMin);
  const patch = ganttDragPatch(value, preview, mode);
  return { preview, patch, saved: taskRange({ ...value, ...patch }) };
};

describe('Gantt date editing keeps the preview and saved interval identical', () => {
  it('keeps the inferred start on its original day when a deadline is extended or shortened across midnight', () => {
    const value = task({ dueAt: date(22, 18) });
    for (const delta of [1440, -1440, 360]) {
      const result = drag(value, 'end', delta);
      expect(result.saved.start).toBe(date(22));
      expect(result.saved).toEqual(result.preview);
    }
  });
  it('keeps an inferred end when moving the start to a different day', () => {
    const value = task({ startAt: date(22, 10) });
    const result = drag(value, 'start', -1440);
    expect(result.saved.end).toBe(taskRange(value).end);
    expect(result.saved).toEqual(result.preview);
  });
  it('preserves duration when moving a one-sided task by hours or across a day boundary', () => {
    for (const value of [task({ dueAt: date(22, 18) }), task({ startAt: date(22, 10) })]) {
      const initial = taskRange(value);
      for (const delta of [60, -120, 1440]) {
        const result = drag(value, 'move', delta);
        expect(result.saved).toEqual(result.preview);
        expect(result.saved.end - result.saved.start).toBe(initial.end - initial.start);
      }
    }
  });
  it('does not rewrite an existing opposite endpoint and clamps handles without flipping the interval', () => {
    const value = task({ startAt: date(22, 10), dueAt: date(22, 18) });
    const start = drag(value, 'start', 1440), end = drag(value, 'end', -1440);
    expect(start.patch).not.toHaveProperty('dueAt');
    expect(end.patch).not.toHaveProperty('startAt');
    expect(start.saved).toEqual({ start: date(22, 18), end: date(22, 18) });
    expect(end.saved).toEqual({ start: date(22, 10), end: date(22, 10) });
  });
});
