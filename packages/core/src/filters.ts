import { Task } from './types';
import { endOfDay, addDays, startOfDay, dayKeyOf } from './time';
import { activeTasks, sortSiblings, fullyDoneIds } from './tree';

export type ListGroupKey = 'overdue' | 'today' | 'upcoming' | 'anytime' | 'done';

export const GROUP_LABEL: Record<ListGroupKey, string> = {
  overdue: '已过期',
  today: '今天',
  upcoming: '即将到来',
  anytime: '任何时候',
  done: '已完成',
};

export const GROUP_ORDER: ListGroupKey[] = ['overdue', 'today', 'upcoming', 'anytime', 'done'];

/** 注意:调用方应保证 showDone=false 时已完成任务已从输入剔除 */
export function listGroupOf(task: Task, now: Date): ListGroupKey {
  // 原位变灰:已完成任务按 dueAt 归入对应分组,而非单独「已完成」组
  if (task.dueAt != null) {
    if (task.dueAt < startOfDay(now).getTime()) return 'overdue';
    if (task.dueAt < endOfDay(now).getTime()) return 'today';
    if (task.dueAt < endOfDay(addDays(now, 7)).getTime()) return 'upcoming';
  }
  return 'anytime';
}

export interface TaskFilter {
  kind: 'all' | 'today' | 'next7' | 'high' | 'unscheduled' | 'tag' | 'inbox';
  tagId?: string;
}

export function matchFilter(task: Task, filter: TaskFilter, now: Date): boolean {
  const eod = endOfDay(now).getTime();
  switch (filter.kind) {
    case 'today':
      return task.dueAt != null && task.dueAt < eod;
    case 'next7':
      return task.dueAt != null && task.dueAt < endOfDay(addDays(now, 7)).getTime();
    case 'high':
      return task.important || task.urgent;
    case 'unscheduled':
      return task.dueAt == null;
    case 'tag':
      return !!filter.tagId && task.tags.includes(filter.tagId);
    default:
      return true;
  }
}

/** List 视图数据:根级任务按组分组(子任务跟随父级,不单独分组) */
export function groupRoots(
  tasks: Task[],
  now: Date,
  filter?: TaskFilter,
  opts?: { showDone?: boolean },
): { key: ListGroupKey; label: string; tasks: Task[] }[] {
  const showDone = opts?.showDone ?? true;
  const active = activeTasks(tasks).filter((t) => t.status !== 'inbox');
  const byId = new Map(tasks.map((t) => [t.id, t]));
  // 隐藏模式只藏「整棵子树都完成」的根;已完成但子级仍在进行的保持灰色可见
  const hideDone = !showDone ? fullyDoneIds(tasks) : null;
  const roots = active.filter((t) => {
    if (hideDone?.has(t.id)) return false;
    if (t.parentId == null) return true;
    const p = byId.get(t.parentId);
    return !p || !!p.deletedAt || p.status === 'archived';
  });
  const filtered = (filter ? roots.filter((t) => matchFilter(t, filter, now)) : roots).slice().sort(sortSiblings);
  const groups = new Map<ListGroupKey, Task[]>();
  for (const t of filtered) {
    const k = listGroupOf(t, now);
    const arr = groups.get(k);
    if (arr) arr.push(t);
    else groups.set(k, [t]);
  }
  return GROUP_ORDER.filter((k) => groups.has(k)).map((k) => ({
    key: k,
    label: GROUP_LABEL[k],
    tasks: groups.get(k)!,
  }));
}

export function inboxTasks(tasks: Task[]): Task[] {
  return tasks
    .filter((t) => t.status === 'inbox' && !t.deletedAt)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** 完成于今日(「已完成」组只显示今天完成的) */
export function completedToday(tasks: Task[], now: Date): Task[] {
  const key = dayKeyOf(now);
  return tasks.filter(
    (t) => t.status === 'done' && t.completedAt != null && dayKeyOf(t.completedAt) === key,
  );
}
