import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { logCountOn } from '@cortex/core';
import { CortexStore } from '../src/store';

/** 模拟同步:双向交换全量 state(等价于 SyncStep1/2 收敛后的结果) */
function syncStores(a: CortexStore, b: CortexStore): void {
  for (const id of ['root', 'tasks', 'events', 'links', 'sessions', 'habits', 'habitLogs'] as const) {
    const ua = Y.encodeStateAsUpdate(a.docs[id]);
    const ub = Y.encodeStateAsUpdate(b.docs[id]);
    Y.applyUpdate(b.docs[id], ua);
    Y.applyUpdate(a.docs[id], ub);
  }
}

function assertConverged(a: CortexStore, b: CortexStore): void {
  const normalized = (store: CortexStore) => Object.fromEntries(Object.entries(store.exportJSON()).map(([key, value]) => [key,
    Array.isArray(value) ? [...value].sort((a, b) => a.id.localeCompare(b.id)) : value]));
  expect(normalized(a)).toEqual(normalized(b));
}

describe('CRDT 双端合并', () => {
  it('一端创建,另一端可见', () => {
    const A = new CortexStore('u1');
    const B = new CortexStore('u1');
    A.createTask({ title: '买牛奶', status: 'todo', dueAt: 123 });
    syncStores(A, B);
    expect(B.exportJSON().tasks).toHaveLength(1);
    expect(B.exportJSON().tasks[0]!.title).toBe('买牛奶');
    assertConverged(A, B);
  });

  it('双端离线并发改同一任务的不同字段 → 都保留(×20 确定性)', () => {
    for (let round = 0; round < 20; round++) {
      const A = new CortexStore('u1');
      const B = new CortexStore('u1');
      const t = A.createTask({ title: '原题', status: 'todo' });
      syncStores(A, B); // 双端都有 t

      A.updateTask(t.id, { title: 'A 改的标题' });
      A.updateTask(t.id, { important: true });
      B.updateTask(t.id, { notes: 'B 加的备注' });
      B.setTaskStatus(t.id, 'done');

      syncStores(A, B);
      syncStores(B, A); // 二轮确保差量收敛

      const at = A.exportJSON().tasks[0]!;
      const bt = B.exportJSON().tasks[0]!;
      // 字段级合并:B 没写 title,A 没写 notes → 两端修改全部保留
      expect(at.title).toBe('A 改的标题');
      expect(bt.title).toBe('A 改的标题');
      expect(at.notes).toBe('B 加的备注');
      expect([at.important, bt.important]).toEqual([true, true]);
      expect([at.status, bt.status]).toEqual(['done', 'done']);
      assertConverged(A, B);
    }
  });

  it('双端各自建任务 → 合并后都在', () => {
    const A = new CortexStore('u1');
    const B = new CortexStore('u1');
    A.createTask({ title: 'A 的' });
    B.createTask({ title: 'B 的' });
    syncStores(A, B);
    const titles = A.exportJSON().tasks.map((t) => t.title).sort();
    expect(titles).toEqual(['A 的', 'B 的']);
    assertConverged(A, B);
  });

  it('软删子树同步到对端', () => {
    const A = new CortexStore('u1');
    const B = new CortexStore('u1');
    const root = A.createTask({ title: 'root', status: 'todo' });
    const child = A.createTask({ title: 'child', status: 'todo', parentId: root.id });
    A.softDeleteTask(root.id);
    syncStores(A, B);
    const bt = B.exportJSON().tasks;
    expect(bt.every((t) => t.deletedAt != null)).toBe(true);
    expect(bt).toHaveLength(2);
    expect(child.id).toBeTruthy();
  });
});

describe('CortexStore CRUD', () => {
  it('toggle 状态机 completedAt', () => {
    const s = new CortexStore('u1');
    const t = s.createTask({ title: 'x', status: 'todo' });
    s.toggleTaskDone(t.id);
    expect(s.getData().tasks[0]!.status).toBe('done');
    expect(s.getData().tasks[0]!.completedAt).toBeGreaterThan(0);
    s.toggleTaskDone(t.id);
    expect(s.getData().tasks[0]!.status).toBe('todo');
    expect(s.getData().tasks[0]!.completedAt).toBeNull();
  });

  it('renumberParent 规范化兄弟 order', () => {
    const s = new CortexStore('u1');
    const a = s.createTask({ title: 'a', status: 'todo', order: 0 });
    s.createTask({ title: 'b', status: 'todo', order: 1 });
    // 疯狂中点挤压
    let lo = 0;
    for (let i = 0; i < 80; i++) {
      s.createTask({ title: `x${i}`, status: 'todo', order: (lo + 1) / 2 });
      lo = (lo + 1) / 2;
    }
    s.renumberParent(null);
    const orders = s
      .getData()
      .tasks.filter((t) => t.title !== 'b')
      .map((t) => t.order);
    expect(a.order).toBe(0);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('logHabit 增减与删除', () => {
    const s = new CortexStore('u1');
    const h = s.createHabit({ name: '喝水', targetPerDay: 8 });
    s.logHabit(h.id, '2026-08-29', 1, 8);
    s.logHabit(h.id, '2026-08-29', 1, 8);
    expect(logCountOn(s.getData().habitLogs, h.id, '2026-08-29')).toBe(2);
    s.logHabit(h.id, '2026-08-29', -1, 8);
    expect(logCountOn(s.getData().habitLogs, h.id, '2026-08-29')).toBe(1);
    s.logHabit(h.id, '2026-08-29', -1, 8);
    expect(logCountOn(s.getData().habitLogs, h.id, '2026-08-29')).toBe(0);
  });

  it('ensureTag 大小写不敏感去重', () => {
    const s = new CortexStore('u1');
    const a = s.ensureTag('Work');
    const b = s.ensureTag('work');
    expect(a.id).toBe(b.id);
    expect(s.getData().tags).toHaveLength(1);
  });

  it('importJSON/absorbLocal', () => {
    const local = new CortexStore('local');
    local.createTask({ title: '本地任务', status: 'todo' });
    const acc = new CortexStore('u9');
    const n = acc.absorbLocal(local);
    expect(n).toBe(1);
    expect(acc.getData().tasks[0]!.ownerId).toBe('u9');
  });
});
