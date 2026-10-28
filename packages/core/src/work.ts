import type { ScheduleEvent, Task } from './types';
import { activeTasks, isStructural } from './tree';
import { addDays, startOfWeek } from './time';
import { priorityOf } from './quadrant';

export type WorkFocus = 'current' | 'doing' | 'week' | 'overdue' | 'unscheduled' | 'all';
export const WORK_FOCUS = ['current', 'doing', 'week', 'overdue', 'unscheduled', 'all'] as const;

/** Observable work signals, not predictions of blockers or project health. */
export function workSignals(tasks: Task[], events: ScheduleEvent[], now: Date, weekStartsOn: 0 | 1 = 1) {
  const doing = new Set<string>(),
    week = new Set<string>(),
    overdue = new Set<string>(),
    unscheduled = new Set<string>();
  const weekStart = startOfWeek(now, weekStartsOn).getTime();
  const weekEnd = addDays(weekStart, 7).getTime();
  const scheduled = new Set<string>();
  const weekScheduled = new Set<string>();
  for (const event of events) {
    if (event.deletedAt || event.completed || !event.taskId) continue;
    if (event.end > now.getTime()) scheduled.add(event.taskId);
    if (event.start < weekEnd && event.end > weekStart) weekScheduled.add(event.taskId);
  }
  for (const task of activeTasks(tasks)) {
    if (isStructural(task) || task.status === 'done' || task.status === 'inbox') continue;
    if (task.status === 'doing') doing.add(task.id);
    if (task.dueAt != null && task.dueAt < now.getTime()) overdue.add(task.id);
    const first = task.startAt ?? task.dueAt;
    const last = task.dueAt ?? task.startAt;
    if (
      weekScheduled.has(task.id) ||
      (first != null && last != null && Math.min(first, last) < weekEnd && Math.max(first, last) >= weekStart)
    )
      week.add(task.id);
    if (
      ['P0', 'P1'].includes(priorityOf(task)) &&
      task.startAt == null &&
      task.dueAt == null &&
      !scheduled.has(task.id)
    )
      unscheduled.add(task.id);
  }
  return { current: new Set([...doing, ...week]), doing, week, overdue, unscheduled };
}

/** Keep ancestor paths so focused tasks retain their position in the project. */
export function taskContextIds(tasks: Task[], matches: Iterable<string>): Set<string> {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const keep = new Set<string>();
  for (const id of matches) {
    let task = byId.get(id);
    while (task && !keep.has(task.id)) {
      keep.add(task.id);
      task = task.parentId ? byId.get(task.parentId) : undefined;
    }
  }
  return keep;
}

/** Progress always uses the complete subtree, excluding structural containers. */
export function workProgress(tasks: Task[]): Map<string, { done: number; total: number }> {
  const children = new Map<string | null, Task[]>();
  for (const task of activeTasks(tasks)) {
    if (task.status === 'inbox') continue;
    const siblings = children.get(task.parentId) ?? [];
    siblings.push(task);
    children.set(task.parentId, siblings);
  }
  const progress = new Map<string, { done: number; total: number }>();
  const visiting = new Set<string>();
  const visit = (task: Task): { done: number; total: number } => {
    if (progress.has(task.id)) return progress.get(task.id)!;
    if (visiting.has(task.id)) return { done: 0, total: 0 };
    visiting.add(task.id);
    let done = 0,
      total = 0;
    for (const child of children.get(task.id) ?? []) {
      const nested = visit(child);
      done += nested.done;
      total += nested.total;
      if (!isStructural(child)) {
        total++;
        if (child.status === 'done') done++;
      }
    }
    visiting.delete(task.id);
    const value = { done, total };
    progress.set(task.id, value);
    return value;
  };
  for (const task of activeTasks(tasks)) visit(task);
  return progress;
}
