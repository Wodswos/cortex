import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { CortexStore } from '../src/store';

/**
 * 撤销/重做:Y.UndoManager 只追踪 origin=null 的本地写入。
 * 远端同步(SyncClient 用 REMOTE symbol)与测试里的显式 origin 均不可撤销。
 */

describe('撤销 / 重做', () => {
  it('标题修改:undo 回旧值,redo 回新值', () => {
    const s = new CortexStore('u1');
    const t = s.createTask({ title: '旧标题', status: 'todo' });
    s.stopUndoCapture();
    s.updateTask(t.id, { title: '新标题' });
    s.stopUndoCapture();
    expect(s.getData().tasks[0]!.title).toBe('新标题');
    expect(s.undo()).toBe(true);
    expect(s.getData().tasks[0]!.title).toBe('旧标题');
    expect(s.redo()).toBe(true);
    expect(s.getData().tasks[0]!.title).toBe('新标题');
  });

  it('新建后 undo = 该任务消失,redo = 回来', () => {
    const s = new CortexStore('u1');
    const t = s.createTask({ title: '临时', status: 'todo' });
    s.stopUndoCapture();
    expect(s.undo()).toBe(true);
    expect(s.getData().tasks).toHaveLength(0);
    expect(s.redo()).toBe(true);
    expect(s.getData().tasks).toHaveLength(1);
    expect(s.getData().tasks[0]!.id).toBe(t.id);
  });

  it('批量软删子树:一次 undo 全部恢复', () => {
    const s = new CortexStore('u1');
    const root = s.createTask({ title: '根', status: 'todo' });
    s.createTask({ title: '子', status: 'todo', parentId: root.id });
    s.createTask({ title: '孙', status: 'todo', parentId: root.id });
    s.stopUndoCapture();
    s.softDeleteTask(root.id);
    s.stopUndoCapture();
    expect(s.getData().tasks.filter((x) => !x.deletedAt)).toHaveLength(0);
    expect(s.undo()).toBe(true);
    expect(s.getData().tasks.filter((x) => !x.deletedAt)).toHaveLength(3);
  });

  it('reparent(拖拽挂靠):undo 回原父级', () => {
    const s = new CortexStore('u1');
    const a = s.createTask({ title: 'A', status: 'todo' });
    const b = s.createTask({ title: 'B', status: 'todo' });
    const c = s.createTask({ title: 'C', status: 'todo', parentId: b.id });
    s.stopUndoCapture();
    s.reparent(c.id, a.id, 1);
    s.stopUndoCapture();
    expect(s.getData().tasks.find((x) => x.id === c.id)!.parentId).toBe(a.id);
    s.undo();
    expect(s.getData().tasks.find((x) => x.id === c.id)!.parentId).toBe(b.id);
  });

  it('stopUndoCapture 切分撤销单元:连续两次标题修改分两次撤', () => {
    const s = new CortexStore('u1');
    const t = s.createTask({ title: 'v0', status: 'todo' });
    s.stopUndoCapture();
    s.updateTask(t.id, { title: 'v1' });
    s.stopUndoCapture();
    s.updateTask(t.id, { title: 'v2' });
    s.stopUndoCapture();
    s.undo();
    expect(s.getData().tasks[0]!.title).toBe('v1');
    s.undo();
    expect(s.getData().tasks[0]!.title).toBe('v0');
  });

  it('设置修改(hiddenRoots)可撤销', () => {
    const s = new CortexStore('u1');
    s.stopUndoCapture();
    s.updateSettings({ hiddenRoots: ['x'] });
    s.stopUndoCapture();
    expect(s.getData().settings.hiddenRoots).toEqual(['x']);
    s.undo();
    expect(s.getData().settings.hiddenRoots).toEqual([]);
  });

  it('远端更新不可撤销(origin ≠ null)', () => {
    const A = new CortexStore('u1');
    const B = new CortexStore('u2');
    A.createTask({ title: '本地', status: 'todo' });
    A.stopUndoCapture();
    B.createTask({ title: '远端', status: 'todo' });
    // 模拟 SyncClient:B 的更新以 REMOTE origin 应用到 A
    Y.applyUpdate(A.docs.tasks, Y.encodeStateAsUpdate(B.docs.tasks), Symbol('remote'));
    expect(A.getData().tasks).toHaveLength(2);
    expect(A.undo()).toBe(true); // 撤的是 A 自己那条
    expect(A.getData().tasks.map((t) => t.title)).toEqual(['远端']);
    expect(A.undo()).toBe(false); // 远端的不许撤
    expect(A.getData().tasks).toHaveLength(1);
  });

  it('勾选完成时:无截止 → 补为完成时刻;有截止 → 保持不动', () => {
    const s = new CortexStore('u1');
    // 原本没有截止时间:完成时补为完成时刻
    const a = s.createTask({ title: '作业', status: 'todo' });
    s.setTaskStatus(a.id, 'done');
    const afterA = s.getData().tasks.find((t) => t.id === a.id)!;
    expect(afterA.status).toBe('done');
    expect(afterA.dueAt).toBe(afterA.completedAt); // 补为完成时刻
    s.setTaskStatus(a.id, 'todo'); // 取消完成不清除截止
    expect(s.getData().tasks.find((t) => t.id === a.id)!.dueAt).toBe(afterA.dueAt);
    // 原本就有截止时间:完成后不改动
    const b = s.createTask({ title: '作业2', status: 'todo', dueAt: 1000 });
    s.setTaskStatus(b.id, 'done');
    const afterB = s.getData().tasks.find((t) => t.id === b.id)!;
    expect(afterB.dueAt).toBe(1000); // 用户排期原样保留
    expect(afterB.completedAt).toBeGreaterThan(1000);
  });

  it('importJSON / absorbLocal 不进撤销栈', () => {
    const local = new CortexStore('local');
    local.createTask({ title: '本地任务', status: 'todo' });
    const s = new CortexStore('u1');
    s.absorbLocal(local);
    expect(s.getData().tasks).toHaveLength(1);
    expect(s.canUndo()).toBe(false);
    s.importJSON({ tasks: s.exportJSON().tasks });
    expect(s.canUndo()).toBe(false);
  });
});
