import { Task } from './types';
import { startOfDay, endOfDay } from './time';

/**
 * 任务的有效时间范围(甘特图条、窗口重叠过滤都用它):
 * - 两端都有 → startAt ~ dueAt
 * - 只有开始 → 开始时刻 ~ 当天末尾
 * - 只有截止 → 当天开头 ~ 截止时刻(不再回退到 createdAt!否则一个只设了截止的任务
 *   会从"创建时刻"画起 —— 创建得早的任务条会横跨好几天,看着像排错了期)
 * - 都没有 → 空范围(调用方自行决定是否隐藏;甘特图默认隐藏无时间任务)
 */
export function taskRange(t: Task): { start: number; end: number } {
  const { startAt, dueAt } = t;
  if (startAt != null && dueAt != null) return { start: startAt, end: Math.max(dueAt, startAt) };
  if (startAt != null) return { start: startAt, end: endOfDay(startAt).getTime() - 1 };
  if (dueAt != null) return { start: startOfDay(new Date(dueAt)).getTime(), end: dueAt };
  const start = t.createdAt;
  return { start, end: endOfDay(start).getTime() - 1 };
}

/** 纯投影修复:每个环断开字典序最小节点的父边,与更新到达顺序无关。 */
export function normalizeTaskForest(tasks: Task[]): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const parents = new Map(tasks.map((t) => [t.id, !t.project && t.parentId && byId.has(t.parentId) ? t.parentId : null]));
  const finished = new Set<string>();
  for (const task of tasks) {
    const path: string[] = [];
    const positions = new Map<string, number>();
    let id: string | null = task.id;
    while (id && !finished.has(id)) {
      const cycleAt = positions.get(id);
      if (cycleAt !== undefined) {
        const root = path.slice(cycleAt).sort()[0]!;
        parents.set(root, null);
        break;
      }
      positions.set(id, path.length);
      path.push(id);
      id = parents.get(id) ?? null;
    }
    for (const seen of path) finished.add(seen);
  }
  return tasks.map((t) => parents.get(t.id) === t.parentId ? t : { ...t, parentId: parents.get(t.id) ?? null });
}

export interface ChildrenMap {
  get(parentId: ID | null): Task[] | undefined;
}

type ID = string;

export function sortSiblings(a: Task, b: Task): number {
  return a.order - b.order || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

/** parentId → 按 order 排序的子任务 */
export function buildChildrenMap(tasks: Task[]): Map<string | null, Task[]> {
  const map = new Map<string | null, Task[]>();
  for (const t of normalizeTaskForest(tasks)) {
    const key = t.parentId ?? null;
    const arr = map.get(key);
    if (arr) arr.push(t);
    else map.set(key, [t]);
  }
  for (const arr of map.values()) arr.sort(sortSiblings);
  return map;
}

export function taskById(tasks: Task[]): Map<string, Task> {
  return new Map(tasks.map((t) => [t.id, t]));
}

/** root 在前,DFS;不含已删任务 */
export function taskTreeRoots(children: Map<string | null, Task[]>): Task[] {
  return children.get(null) ?? [];
}

export function flattenTree(
  children: Map<string | null, Task[]>,
  opts: { collapsed?: Set<string> } = {},
): { task: Task; depth: number; hasChildren: boolean }[] {
  const rows: { task: Task; depth: number; hasChildren: boolean }[] = [];
  const visited = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    const arr = children.get(parentId);
    if (!arr) return;
    for (const t of arr) {
      if (visited.has(t.id)) continue;
      visited.add(t.id);
      const kids = children.get(t.id) ?? [];
      rows.push({ task: t, depth, hasChildren: kids.length > 0 });
      if (kids.length && !opts.collapsed?.has(t.id)) walk(t.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

export function descendantsOf(id: string, children: Map<string | null, Task[]>): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const c of children.get(cur) ?? []) {
      if (!out.has(c.id)) {
        out.add(c.id);
        stack.push(c.id);
      }
    }
  }
  return out;
}

export function ancestorsOf(id: string, byId: Map<string, Task>): Task[] {
  const out: Task[] = [];
  const visited = new Set([id]);
  let cur = byId.get(id)?.parentId ?? null;
  while (cur) {
    if (visited.has(cur)) break;
    visited.add(cur);
    const t = byId.get(cur);
    if (!t) break;
    out.push(t);
    cur = t.parentId;
  }
  return out.reverse();
}

/** 移动合法性:目标父级不能是自己或自己的后代(防环) */
export function canReparent(taskId: string, newParentId: string | null, children: Map<string | null, Task[]>): boolean {
  if (taskId === newParentId) return false;
  if (newParentId === null) return true;
  const root = children.get(null)?.find((task) => task.id === taskId);
  if (root && isProject(root)) return false;
  return !descendantsOf(taskId, children).has(newParentId);
}

/** 任务自身的完成度 + 祖先链上进度(父任务显示 3/7) */
export function subtreeProgress(taskId: string, children: Map<string | null, Task[]>): { done: number; total: number } {
  let done = 0;
  let total = 0;
  const stack = [...(children.get(taskId) ?? [])];
  const visited = new Set([taskId]);
  while (stack.length) {
    const t = stack.pop()!;
    if (visited.has(t.id)) continue;
    visited.add(t.id);
    if (!isStructural(t)) {
      total++;
      if (t.status === 'done') done++;
    }
    for (const c of children.get(t.id) ?? []) stack.push(c);
  }
  return { done, total };
}

/** 有效任务 = 未软删未归档 */
export function activeTasks(tasks: Task[]): Task[] {
  const hidden = new Set<string>();
  const unavailable = tasks.filter((task) => isProject(task) && (task.deletedAt || task.status === 'archived'));
  if (unavailable.length) {
    const children = buildChildrenMap(tasks);
    for (const project of unavailable) for (const id of descendantsOf(project.id, children)) hidden.add(id);
  }
  return tasks.filter((t) => !t.deletedAt && t.status !== 'archived' && !hidden.has(t.id));
}

/** 结构性节点(非 TODO):不可完成、无状态/优先级/时间,视图里作纯容器/主题(见 types.Task.kind) */
export function isStructural(t: Task): boolean {
  return t.kind === 'node' || t.project === true;
}

export function isProject(task: Task): boolean {
  return task.project ?? (task.kind === 'node' && task.parentId === null);
}

/** Keep a project's root and complete descendant tree; a missing project yields no content. */
export function tasksInProject(tasks: Task[], projectId: string | null): Task[] {
  if (!projectId) return tasks;
  if (!tasks.some((task) => task.id === projectId)) return [];
  const ids = descendantsOf(projectId, buildChildrenMap(tasks)).add(projectId);
  return tasks.filter((task) => ids.has(task.id));
}

/**
 * 「整棵子树都已完成」的任务集合。settings.completedDisplay='hidden' 时隐藏这些:
 * 完成的叶子直接消失;已完成但下面还有未完成子任务的父级保持灰色可见
 * (若按单任务状态隐藏,会把进行中的子树一起从视图里蒸发掉)。
 */
export function fullyDoneIds(tasks: Task[]): Set<string> {
  const kids = buildChildrenMap(activeTasks(tasks));
  const done = new Set<string>();
  const visit = (t: Task): boolean => {
    let all = t.status === 'done';
    for (const c of kids.get(t.id) ?? []) all = visit(c) && all;
    if (all) done.add(t.id);
    return all;
  };
  for (const r of kids.get(null) ?? []) visit(r);
  return done;
}
