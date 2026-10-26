import { describe, it, expect } from 'vitest';
import { groupRoots, listGroupOf, inboxTasks, completedToday } from '../src/filters';
import { fullyDoneIds } from '../src/tree';
import { Task } from '../src/types';

const NOW = new Date(2026, 7, 29, 10, 0);
let seq = 0;
function T(partial: Partial<Task> & { id: string }): Task {
  return {
    title: partial.id,
    status: 'todo',
    parentId: null,
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

describe('listGroupOf', () => {
  it('过期/今天/即将/任何时候,已完成但原位按 due 分组', () => {
    expect(listGroupOf(T({ id: 'a', dueAt: NOW.getTime() - 86400000 }), NOW)).toBe('overdue');
    expect(listGroupOf(T({ id: 'b', dueAt: new Date(2026, 7, 29, 18).getTime() }), NOW)).toBe('today');
    expect(listGroupOf(T({ id: 'c', dueAt: new Date(2026, 8, 2).getTime() }), NOW)).toBe('upcoming');
    expect(listGroupOf(T({ id: 'd' }), NOW)).toBe('anytime');
    // 原位变灰:已完成的过期任务按 due 归入「已过期」,而非单独「已完成」
    expect(listGroupOf(T({ id: 'e', status: 'done', completedAt: Date.now(), dueAt: NOW.getTime() - 86400000 }), NOW)).toBe('overdue');
    expect(listGroupOf(T({ id: 'f', status: 'done', completedAt: Date.now() }), NOW)).toBe('anytime');
  });
});

describe('groupRoots', () => {
  it('showDone=false 时剔除已完成任务', () => {
    const tasks = [
      T({ id: 'd1', status: 'done' }),
      T({ id: 'a1' }),
    ];
    const ids = (g: { tasks: Task[] }[]) => g.flatMap((gr) => gr.tasks.map((t) => t.id));
    expect(ids(groupRoots(tasks, NOW, undefined, { showDone: false }))).not.toContain('d1');
    expect(ids(groupRoots(tasks, NOW, undefined, { showDone: false }))).toContain('a1');
    // showDone 默认 true:已完成任务保留在分组内
    expect(ids(groupRoots(tasks, NOW))).toContain('d1');
  });
});

describe('groupRoots', () => {
  it('只分组根级,inbox 不出现', () => {
    const tasks = [
      T({ id: 'r1', dueAt: new Date(2026, 7, 29, 18).getTime() }),
      T({ id: 'child', parentId: 'r1' }),
      T({ id: 'inbox1', status: 'inbox' }),
      T({ id: 'r2' }),
    ];
    const groups = groupRoots(tasks, NOW);
    const ids = groups.flatMap((g) => g.tasks.map((t) => t.id));
    expect(ids).toContain('r1');
    expect(ids).toContain('r2');
    expect(ids).not.toContain('child');
    expect(ids).not.toContain('inbox1');
  });
  it('子任务成为孤儿时升为根', () => {
    const tasks = [
      T({ id: 'gone', parentId: 'deleted-parent' }),
      T({ id: 'deleted-parent', parentId: null, deletedAt: 1 }),
    ];
    const groups = groupRoots(tasks, NOW);
    expect(groups.flatMap((g) => g.tasks.map((t) => t.id))).toContain('gone');
  });
  it('隐藏模式:只藏「整棵子树都完成」的根,进行中子树的已完成根保持可见', () => {
    const tasks = [
      // pd:已完成 + 子级全部完成 → 隐藏
      T({ id: 'pd', status: 'done' }),
      T({ id: 'pd-c1', parentId: 'pd', status: 'done' }),
      T({ id: 'pd-c2', parentId: 'pd', status: 'done' }),
      // ad:根已完成但还有未完成子级 → 保留(灰色可见,子级不能跟着蒸发)
      T({ id: 'ad', status: 'done' }),
      T({ id: 'ad-c', parentId: 'ad' }),
      // 普通未完成根
      T({ id: 'ok' }),
    ];
    const ids = (g: { tasks: Task[] }[]) => g.flatMap((gr) => gr.tasks.map((t) => t.id));
    const hidden = ids(groupRoots(tasks, NOW, undefined, { showDone: false }));
    expect(hidden).not.toContain('pd');
    expect(hidden).toContain('ad');
    expect(hidden).toContain('ok');
    // fullyDoneIds 语义:pd 与其后代、独立完成的叶子进集合;ad 不进
    const done = fullyDoneIds(tasks);
    expect(done.has('pd')).toBe(true);
    expect(done.has('pd-c1')).toBe(true);
    expect(done.has('ad')).toBe(false);
    expect(done.has('ad-c')).toBe(false);
    expect(done.has('ok')).toBe(false);
  });
});

describe('inbox/completedToday', () => {
  it('inbox 按创建时间倒序', () => {
    const a = T({ id: 'a', status: 'inbox', createdAt: 1 });
    const b = T({ id: 'b', status: 'inbox', createdAt: 2 });
    expect(inboxTasks([a, b]).map((t) => t.id)).toEqual(['b', 'a']);
  });
  it('completedToday 只含今天完成的', () => {
    const tasks = [
      T({ id: 'a', status: 'done', completedAt: new Date(2026, 7, 29, 9).getTime() }),
      T({ id: 'b', status: 'done', completedAt: new Date(2026, 7, 28, 9).getTime() }),
    ];
    expect(completedToday(tasks, NOW).map((t) => t.id)).toEqual(['a']);
  });
});
