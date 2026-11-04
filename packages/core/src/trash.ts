import type { Task } from './types';
import { buildChildrenMap, normalizeTaskForest } from './tree';

/** Includes each selected branch once, regardless of selection order or overlap. */
export function taskBranchIds(tasks: Task[], roots: readonly string[]): Set<string> {
  const children = buildChildrenMap(tasks);
  const known = new Set(tasks.map((task) => task.id));
  const result = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const id = queue.pop()!;
    if (!known.has(id) || result.has(id)) continue;
    result.add(id);
    for (const child of children.get(id) ?? []) queue.push(child.id);
  }
  return result;
}

/** Deleted children stay beneath their deleted parent; live parents are shown as context. */
export function trashRoots(tasks: Task[]): Task[] {
  const deleted = normalizeTaskForest(tasks).filter((task) => task.deletedAt != null);
  const ids = new Set(deleted.map((task) => task.id));
  return deleted.filter((task) => !task.parentId || !ids.has(task.parentId))
    .sort((a, b) => b.deletedAt! - a.deletedAt! || a.id.localeCompare(b.id));
}
