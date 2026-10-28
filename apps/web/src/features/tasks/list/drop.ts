import { canReparent, type Task } from '@cortex/core';

export const TASK_INDENT = 16;

export interface TaskDrop {
  /** The row used as the sibling/parent anchor, possibly an ancestor of the hovered row. */
  anchorId: string;
  parentId: string | null;
  placement: 'before' | 'after' | 'inside';
  depth: number;
  /** Outdenting a dated task to the root lets the list place it in its date group. */
  groupedRoot?: boolean;
}

/** Project the pointer onto a stable row, independently of where the task was grabbed. */
export function projectTaskDrop(
  dragId: string,
  target: { task: Task; depth: number },
  pointer: { x: number; y: number },
  rect: { left: number; top: number; height: number },
  children: Map<string | null, Task[]>,
  byId: Map<string, Task>,
): TaskDrop | null {
  if (!canReparent(dragId, target.task.id, children)) return null;
  const relativeY = (pointer.y - rect.top) / Math.max(1, rect.height);
  let placement: TaskDrop['placement'] =
    relativeY < 0.25 ? 'before' : relativeY > 0.75 ? 'after' : 'inside';
  let anchor = target.task;
  let depth = target.depth;

  // Moving into the indentation gutter lifts the task out of nested branches.
  const lift = Math.min(depth, Math.max(0, Math.ceil((rect.left + 20 - pointer.x) / TASK_INDENT)));
  for (let i = 0; i < lift; i++) {
    const parent = anchor.parentId ? byId.get(anchor.parentId) : undefined;
    if (!parent) return null;
    anchor = parent;
    depth--;
    placement = 'after';
  }
  const parentId = placement === 'inside' ? anchor.id : anchor.parentId;
  if (!canReparent(dragId, parentId, children)) return null;
  return { anchorId: anchor.id, parentId, placement, depth };
}
