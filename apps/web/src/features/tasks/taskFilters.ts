import { activeTasks, isStructural, priorityOf, startOfDay, taskContextIds, taskRange, tasksInProject, workSignals, WORK_FOCUS, TASK_FILTER_STATUSES, TASK_FILTER_PRIORITIES, type CortexData, type WorkFocus, type Task } from '@cortex/core';
import { isScheduledOnlyWorkspace, readTaskWindow, taskMatchesWindow, windowEnd, type TaskWindow } from './taskWindow';

export const TASK_STATUSES = TASK_FILTER_STATUSES;
export const TASK_PRIORITIES = TASK_FILTER_PRIORITIES;
export type WorkspaceTaskFilters = { focus: WorkFocus; status: typeof TASK_STATUSES[number]; priority: typeof TASK_PRIORITIES[number]; tagId?: string };
export function readTaskFilters(params: URLSearchParams): WorkspaceTaskFilters {
  const value = params.get('work') ?? params.get('mindFocus');
  const status = params.get('taskStatus'), priority = params.get('taskPriority');
  const tagId = params.get('taskTag');
  return { focus: WORK_FOCUS.includes(value as WorkFocus) ? value as WorkFocus : 'all', status: TASK_STATUSES.includes(status as WorkspaceTaskFilters['status']) ? status as WorkspaceTaskFilters['status'] : 'all', priority: TASK_PRIORITIES.includes(priority as WorkspaceTaskFilters['priority']) ? priority as WorkspaceTaskFilters['priority'] : 'all', ...(tagId && /^[A-Za-z0-9_-]{1,128}$/.test(tagId) ? { tagId } : {}) };
}

/** New tasks inherit explicit filters, keeping the item visible while editing. */
export function workspaceTaskDefaults(params: URLSearchParams, now = Date.now(), defaultDueAt?: number): Partial<Task> {
  const filters = readTaskFilters(params);
  const dueAt = filters.focus === 'overdue' && (!params.get('scope') || params.get('scope') === 'all')
    ? startOfDay(now).getTime() - 60000
    : defaultDueAt;
  return {
    status: ['todo', 'doing', 'done'].includes(filters.status) ? filters.status as Task['status'] : filters.focus === 'current' || filters.focus === 'doing' ? 'doing' : 'todo',
    ...(filters.priority !== 'all' ? { priority: filters.priority === 'high' ? 'P1' as const : filters.priority } : {}),
    ...(filters.tagId ? { tags: [filters.tagId] } : {}),
    ...(dueAt != null ? { dueAt } : {}),
  };
}

/** One predicate for all task views. A tree may retain ancestors as context;
 * context-only parents must never become matching bars or calendar entries. */
export function selectWorkspaceTasks(data: CortexData, params: URLSearchParams, now: Date) {
  const projectId = params.get('project') ?? params.get('root');
  const available = activeTasks(data.tasks).filter(task => task.status !== 'inbox');
  const tasks = projectId ? tasksInProject(available, projectId) : available;
  const scopeIds = new Set(tasks.map(task => task.id));
  const events = data.events.filter(event => !event.deletedAt && (!projectId || !!event.taskId && scopeIds.has(event.taskId)));
  const scheduledOnly = isScheduledOnlyWorkspace(params, data.settings);
  const range = readTaskWindow(params, now, data.settings.weekStartsOn, false, !scheduledOnly);
  const filters = readTaskFilters(params);
  const signals = workSignals(tasks, events, now, data.settings.weekStartsOn);
  // Current work includes explicitly active tasks and unfinished overdue work.
  const focused = filters.focus === 'all' ? null : signals[filters.focus];
  const eventTasks = new Set<string>();
  const scheduledTasks = new Set(events.filter(event => !event.completed && event.end > now.getTime()).map(event => event.taskId));
  if (range.scope !== 'all' && range.scope !== 'undated') for (const event of events) {
    if (event.taskId && event.start < windowEnd(range) && event.end > range.start) eventTasks.add(event.taskId);
  }
  const matching = new Set<string>();
  // A dated calendar block remains visible even if its task has no date fields.
  const matchingEventTaskIds = new Set<string>();
  for (const task of tasks) {
    if (isStructural(task)) continue;
    if (focused && !focused.has(task.id)) continue;
    if (filters.status === 'unfinished' && task.status === 'done' || !['all', 'unfinished'].includes(filters.status) && task.status !== filters.status) continue;
    if (filters.priority === 'high' ? !['P0', 'P1'].includes(priorityOf(task)) : filters.priority !== 'all' && priorityOf(task) !== filters.priority) continue;
    if (filters.tagId && !task.tags.includes(filters.tagId)) continue;
    if (range.scope === 'undated' ? task.startAt != null || task.dueAt != null || scheduledTasks.has(task.id) : !taskMatchesWindow(task, range) && !eventTasks.has(task.id)) continue;
    if (data.settings.completedDisplay === 'hidden' && task.status === 'done') continue;
    matchingEventTaskIds.add(task.id);
    if (!scheduledOnly || task.startAt != null || task.dueAt != null) matching.add(task.id);
  }
  const narrowed = scheduledOnly || filters.focus !== 'all' || filters.status !== 'all' || filters.priority !== 'all' || !!filters.tagId || range.scope !== 'all';
  const context = narrowed ? taskContextIds(tasks, matching) : new Set(tasks.map(task => task.id));
  return { tasks, events, matching, matchingEventTaskIds, context, narrowed, range, filters, projectId };
}

/** All-time task selection still needs a finite canvas in Gantt/calendar. Open
 * around matching dates instead of leaving overdue work outside today's canvas. */
export function workspaceCanvasWindow(data: CortexData, params: URLSearchParams, now: Date, fallback: TaskWindow): TaskWindow {
  if (!['all', 'undated'].includes(params.get('scope') ?? '')) return fallback;
  const selected = selectWorkspaceTasks(data, params, now);
  const dates: number[] = [];
  for (const task of selected.tasks) if (selected.matching.has(task.id) && (task.startAt != null || task.dueAt != null)) {
    const interval = taskRange(task); dates.push(interval.start, interval.end);
  }
  for (const event of selected.events) if (event.taskId && selected.matchingEventTaskIds.has(event.taskId)) dates.push(event.start, event.end - 1);
  if (!dates.length) return fallback;
  let first = Infinity, last = -Infinity;
  for (const value of dates) { first = Math.min(first, value); last = Math.max(last, value); }
  if (['timeline', 'calendar'].includes(params.get('view') ?? '')) {
    const reference = now.getTime() >= first && now.getTime() <= last ? now : new Date(Math.abs(now.getTime() - first) < Math.abs(now.getTime() - last) ? first : last);
    const month = new Date(reference.getFullYear(), reference.getMonth(), 1);
    return { scope: 'month', start: month.getTime(), days: new Date(reference.getFullYear(), reference.getMonth() + 1, 0).getDate() };
  }
  const from = new Date(first), to = new Date(last); from.setHours(0, 0, 0, 0); to.setHours(0, 0, 0, 0);
  const days = Math.round((Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) - Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / 86400000) + 1;
  if (days > 366) { from.setTime(to.getTime()); from.setDate(from.getDate() - 365); }
  return { scope: 'custom', start: from.getTime(), days: Math.min(366, Math.max(1, days)) };
}
