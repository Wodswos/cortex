import { describe, it, expect } from 'vitest';
import { buildChildrenMap, flattenTree, descendantsOf, canReparent, subtreeProgress, ancestorsOf, taskRange } from '../src/tree';
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

describe('tree', () => {
  const tasks = [
    T({ id: 'root1', parentId: null }),
    T({ id: 'a', parentId: 'root1' }),
    T({ id: 'a1', parentId: 'a' }),
    T({ id: 'a2', parentId: 'a' }),
    T({ id: 'b', parentId: 'root1' }),
    T({ id: 'root2', parentId: null }),
  ];
  const children = buildChildrenMap(tasks);
  const byId = new Map(tasks.map((t) => [t.id, t]));

  it('buildChildrenMap 排序', () => {
    expect(children.get(null)!.map((t) => t.id)).toEqual(['root1', 'root2']);
    expect(children.get('root1')!.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('flattenTree 深度与折叠', () => {
    const rows = flattenTree(children).map((r) => [r.task.id, r.depth]);
    expect(rows).toEqual([
      ['root1', 0], ['a', 1], ['a1', 2], ['a2', 2], ['b', 1], ['root2', 0],
    ]);
    const collapsed = flattenTree(children, { collapsed: new Set(['a']) }).map((r) => r.task.id);
    expect(collapsed).not.toContain('a1');
    expect(collapsed).toContain('a');
  });

  it('descendantsOf', () => {
    expect(descendantsOf('a', children)).toEqual(new Set(['a1', 'a2']));
    expect(descendantsOf('root1', children)).toEqual(new Set(['a', 'a1', 'a2', 'b']));
  });

  it('canReparent 防环', () => {
    expect(canReparent('a1', 'root2', children)).toBe(true);
    expect(canReparent('a', 'a2', children)).toBe(false); // 挂到自己的后代
    expect(canReparent('a', 'a', children)).toBe(false);
    expect(canReparent('a', null, children)).toBe(true);
  });

  it('subtreeProgress', () => {
    const tasks2 = [
      ...tasks,
      T({ id: 'a3', parentId: 'a', status: 'done', completedAt: 1 }),
    ];
    const c2 = buildChildrenMap(tasks2);
    expect(subtreeProgress('a', c2)).toEqual({ done: 1, total: 3 });
  });

  it('ancestorsOf 返回根方向序列', () => {
    expect(ancestorsOf('a1', byId).map((t) => t.id)).toEqual(['root1', 'a']);
  });

  describe('taskRange', () => {
    const day = new Date(2026, 8, 15); // 本地 2026-09-15 00:00
    const d0 = day.getTime();
    const at = (h: number, m = 0) => d0 + h * 3600_000 + m * 60_000;

    it('两端都有 = startAt ~ dueAt', () => {
      const t = T({ id: 'x', parentId: null, startAt: at(9), dueAt: at(18) });
      expect(taskRange(t)).toEqual({ start: at(9), end: at(18) });
    });

    it('两端反了也不出负宽度', () => {
      const t = T({ id: 'x', parentId: null, startAt: at(18), dueAt: at(9) });
      expect(taskRange(t)).toEqual({ start: at(18), end: at(18) });
    });

    it('只有开始 = 开始时刻 ~ 当天末尾', () => {
      const t = T({ id: 'x', parentId: null, startAt: at(14, 30) });
      expect(taskRange(t)).toEqual({ start: at(14, 30), end: d0 + 86_400_000 - 1 });
    });

    it('只有截止 = **当天开头** ~ 截止时刻(不从 createdAt 画起)', () => {
      const t = T({ id: 'x', parentId: null, dueAt: at(17), createdAt: d0 - 5 * 86_400_000 });
      expect(taskRange(t)).toEqual({ start: d0, end: at(17) });
    });

    it('都没有 = 创建当天(调用方自行决定是否隐藏)', () => {
      const t = T({ id: 'x', parentId: null, createdAt: at(10) });
      expect(taskRange(t)).toEqual({ start: at(10), end: d0 + 86_400_000 - 1 });
    });
  });
});
