import { addDays, calendarDaysBetween, dayKeyOf, isStructural, startOfDay, startOfWeek, taskRange, type Task } from '@cortex/core';

export type WindowScope = 'all' | 'today' | 'week' | 'month' | 'custom' | 'undated';
export type TaskWindow = { scope: WindowScope; start: number; days: number; scheduledOnly?: boolean };
export const MAX_WINDOW_DAYS = 366;

function parseDay(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = new Date(`${value}T00:00:00`).getTime();
  return Number.isFinite(time) && dayKeyOf(time) === value ? time : null;
}

/** Date-only arithmetic keeps the inclusive span stable across daylight-saving changes. */
export function readTaskWindow(params: URLSearchParams, now: Date, weekStartsOn: 0 | 1, temporal = false, allowUndated = true): TaskWindow {
  let scope = params.get('scope') as WindowScope;
  if (!['all', 'today', 'week', 'month', 'custom', 'undated'].includes(scope)) scope = temporal ? 'week' : 'all';
  if (temporal && (scope === 'all' || scope === 'undated')) scope = 'week';
  if (!allowUndated && scope === 'undated') scope = 'week';
  const today = startOfDay(now).getTime();
  if (scope === 'week') return { scope, start: startOfWeek(now, weekStartsOn).getTime(), days: 7 };
  if (scope === 'month') return { scope, start: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), days: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() };
  if (scope === 'custom') {
    const start = parseDay(params.get('from')) ?? today;
    const end = parseDay(params.get('to')) ?? start;
    return { scope, start, days: Math.max(1, Math.min(MAX_WINDOW_DAYS, calendarDaysBetween(start, end) + 1)) };
  }
  return { scope, start: today, days: 1 };
}

export const isDatedWindow = (window: TaskWindow) => window.scope !== 'all' && window.scope !== 'undated';
export const windowEnd = (window: TaskWindow) => addDays(window.start, window.days).getTime();
export function isCalendarMonth(window: TaskWindow): boolean {
  const start = new Date(window.start);
  return isDatedWindow(window) && start.getDate() === 1 && window.days === new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
}
export function windowDueAt(window: TaskWindow, now = Date.now()): number | undefined {
  const dated = isDatedWindow(window);
  if (!dated && !window.scheduledOnly) return undefined;
  const today = startOfDay(now).getTime();
  const day = !dated || today >= window.start && today < windowEnd(window) ? today : window.start;
  return addDays(day, 1).getTime() - 60_000;
}

export function taskMatchesWindow(task: Task, window: TaskWindow): boolean {
  if (window.scope === 'all') return true;
  if (isStructural(task)) return false;
  if (window.scope === 'undated') return task.startAt == null && task.dueAt == null;
  if (task.startAt == null && task.dueAt == null) return false;
  const range = taskRange(task);
  return range.start < windowEnd(window) && range.end >= window.start;
}

/** Keep ancestors as context without bringing unrelated siblings into a time window. */
export function tasksInWindow(tasks: Task[], window: TaskWindow, ancestors = true, scheduledOnly = window.scheduledOnly ?? false): Task[] {
  if (window.scope === 'all' && !scheduledOnly) return tasks;
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const keep = new Set<string>();
  for (const task of tasks) {
    if (!taskMatchesWindow(task, window)) continue;
    if (scheduledOnly && (isStructural(task) || task.startAt == null && task.dueAt == null)) continue;
    let current: Task | undefined = task;
    while (current && !keep.has(current.id)) {
      keep.add(current.id);
      current = ancestors && current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  return tasks.filter((task) => keep.has(task.id));
}
