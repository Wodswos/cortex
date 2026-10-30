import type { Task } from '@cortex/core';

export type GanttDragMode = 'move' | 'start' | 'end';
export type GanttRange = { start: number; end: number };

/** The preview and the saved dates share the same clamped range. */
export function ganttDragRange(initial: GanttRange, mode: GanttDragMode, deltaMin: number): GanttRange {
  const delta = deltaMin * 60000;
  if (mode === 'move') return { start: initial.start + delta, end: initial.end + delta };
  if (mode === 'start') return { start: Math.min(initial.start + delta, initial.end), end: initial.end };
  return { start: initial.start, end: Math.max(initial.end + delta, initial.start) };
}

/** Materialize inferred endpoints so changing one date cannot re-infer the opposite day. */
export function ganttDragPatch(task: Task, range: GanttRange, mode: GanttDragMode): Partial<Task> {
  const patch: Partial<Task> = {};
  if (mode !== 'end' || task.startAt == null) patch.startAt = range.start;
  if (mode !== 'start' || task.dueAt == null) patch.dueAt = range.end;
  return patch;
}
