import { describe, it, expect } from 'vitest';
import { isStructural } from '../src/tree';
import { matrixTasks } from '../src/quadrant';
import { Task } from '../src/types';

let seq = 0;
function T(partial: Partial<Task> & { id: string; parentId: string | null }): Task {
  return {
    title: partial.id,
    status: 'todo',
    order: (seq += 1000),
    important: false,
    urgent: false,
    tags: [],
    ownerId: 'u1',
    createdAt: seq,
    updatedAt: seq,
    ...partial,
  } as Task;
}

describe('节点类型 kind(todo | node)', () => {
  it('isStructural:仅 kind=node 是结构节点;缺省/显式 todo/null 都不是(老数据免迁移)', () => {
    expect(isStructural(T({ id: 'a', parentId: null }))).toBe(false);
    expect(isStructural(T({ id: 'b', parentId: null, kind: undefined }))).toBe(false);
    expect(isStructural(T({ id: 'c', parentId: null, kind: null }))).toBe(false);
    expect(isStructural(T({ id: 'd', parentId: null, kind: 'todo' }))).toBe(false);
    expect(isStructural(T({ id: 'e', parentId: null, kind: 'node' }))).toBe(true);
  });

  it('matrixTasks:结构节点不进四象限(矩阵只放可执行任务)', () => {
    const now = new Date();
    const tasks = [
      T({ id: 'todo1', parentId: null }),
      T({ id: 'doing1', parentId: null, status: 'doing' }),
      T({ id: 'node1', parentId: null, kind: 'node' }),
      T({ id: 'nodeDoing', parentId: null, kind: 'node', status: 'doing' }),
      T({ id: 'done1', parentId: null, status: 'done' }),
      T({ id: 'gone', parentId: null, deletedAt: seq }),
    ];
    const ids = matrixTasks(tasks, now).map((t) => t.id);
    expect(ids).toEqual(['todo1', 'doing1']);
  });

  it('结构节点即使带着遗留 dueAt 也不进矩阵(数据不清洗,渲染层不认)', () => {
    const now = new Date();
    const tasks = [
      T({ id: 'legacyDated', parentId: null, kind: 'node', dueAt: Date.now() + 3600_000 }),
      T({ id: 'plain', parentId: null }),
    ];
    expect(matrixTasks(tasks, now).map((t) => t.id)).toEqual(['plain']);
  });
});
