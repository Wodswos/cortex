import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { activeTasks, isProject, validateCortexData } from '@cortex/core';
import { CortexStore, DOC_IDS } from '../src/store';

function sync(a: CortexStore, b: CortexStore) {
  for (const id of DOC_IDS) {
    const left = Y.encodeStateAsUpdate(a.docs[id]), right = Y.encodeStateAsUpdate(b.docs[id]);
    Y.applyUpdate(a.docs[id], right, 'remote'); Y.applyUpdate(b.docs[id], left, 'remote');
  }
}
const find = (store: CortexStore, id: string) => store.getData().tasks.find((task) => task.id === id)!;

describe('recycle bin', () => {
  it('restores a deletion batch without reviving independently deleted work, even in the same millisecond', () => {
    const store = new CortexStore('u');
    const root = store.createProject('Project');
    const child = store.createTask({ title: 'work', parentId: root.id, status: 'done', notes: 'keep notes' });
    const old = store.createTask({ title: 'older discarded work', parentId: root.id, status: 'todo' });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      store.softDeleteTasks([old.id]); store.softDeleteTasks([child.id, root.id]);
      expect(find(store, old.id).deletedAt).toBe(find(store, root.id).deletedAt);
      expect(find(store, old.id).deleteBatchId).not.toBe(find(store, root.id).deleteBatchId);
      const removed = store.getData().tasks;
      store.restoreTask(root.id);
      expect(activeTasks(store.getData().tasks).map((task) => task.id)).toEqual([root.id, child.id]);
      expect(find(store, child.id)).toMatchObject({ status: 'done', notes: 'keep notes', parentId: root.id });
      expect(find(store, old.id).deletedAt).toBe(1000);
      store.undo(); expect(store.getData().tasks).toEqual(removed);
      store.redo(); expect(find(store, root.id).deletedAt).toBeNull();
    } finally { clock.mockRestore(); store.destroy(); }
  });

  it('restores a child and its ancestor path, leaving siblings in the bin', () => {
    const store = new CortexStore('u');
    const root = store.createProject('Project');
    const group = store.createTask({ title: 'phase', kind: 'node', parentId: root.id, status: 'todo' });
    const child = store.createTask({ title: 'child', parentId: group.id, status: 'doing' });
    const grandchild = store.createTask({ title: 'grandchild', parentId: child.id, status: 'todo' });
    const sibling = store.createTask({ title: 'sibling', parentId: root.id, status: 'todo' });
    store.softDeleteTasks([root.id]);
    store.restoreTask(child.id);
    expect(activeTasks(store.getData().tasks).map((task) => task.id)).toEqual([root.id, group.id, child.id, grandchild.id]);
    expect(find(store, sibling.id).deletedAt).toBeGreaterThan(0);
    store.restoreTask(sibling.id); expect(find(store, sibling.id).parentId).toBe(root.id);
    store.destroy();
  });

  it('restores legacy timestamp batches and makes an archived ancestor path reachable', () => {
    const store = new CortexStore('u');
    store.importJSON({ tasks: [
      { id: 'root', kind: 'node', project: true, status: 'archived', deletedAt: 100, parentId: null },
      { id: 'child', title: 'keep', status: 'todo', parentId: 'root', deletedAt: 100 },
      { id: 'old', title: 'old', status: 'todo', parentId: 'root', deletedAt: 50 },
    ] });
    store.restoreTask('root');
    expect(activeTasks(store.getData().tasks).map((task) => task.id).sort()).toEqual(['child', 'root']);
    expect(find(store, 'old').deletedAt).toBe(50);
    expect(() => validateCortexData({ tasks: [{ id: 'bad', deleteBatchId: 123 }] })).toThrow();
    expect(() => validateCortexData(store.exportJSON())).not.toThrow();
    store.destroy();
  });

  it('preserves restored batches, links and notes through sync and both backup formats', () => {
    const a = new CortexStore('u'), b = new CortexStore('u');
    const root = a.createProject('Project');
    const child = a.createTask({ title: 'action', parentId: root.id, status: 'todo', notes: 'notes', mindBackground: 'sage' });
    a.addLink(child.id, 'url', 'https://example.com', 'reference');
    a.softDeleteTasks([root.id]); sync(a, b);
    expect(find(b, root.id).deletedAt).toBeGreaterThan(0);
    for (const input of [a.exportJSON(), a.exportSnapshot()]) {
      const restored = new CortexStore('u'); restored.importJSON(input); restored.restoreTask(root.id);
      expect(find(restored, child.id)).toMatchObject({ title: 'action', notes: 'notes', mindBackground: 'sage', deletedAt: null });
      expect(restored.getData().links).toHaveLength(1); restored.destroy();
    }
    b.restoreTask(root.id); sync(a, b);
    expect(a.getData().tasks).toEqual(b.getData().tasks);
    expect(activeTasks(a.getData().tasks)).toHaveLength(2);
    a.destroy(); b.destroy();
  });

  it('permanently deletes only deleted tasks, keeps live descendants ordinary and preserves calendar and focus history', () => {
    const store = new CortexStore('u');
    const root = store.createProject('Project');
    const child = store.createTask({ title: 'deleted child', parentId: root.id, status: 'todo' });
    const keep = store.createTask({ title: 'concurrent live group', kind: 'node', project: false, parentId: root.id, status: 'todo' });
    store.addLink(child.id, 'url', 'https://example.com');
    store.createEvent({ title: 'meeting history', taskId: child.id, start: 100, end: 200 });
    store.addFocusSession({ taskId: child.id, startedAt: 100, endedAt: 200, actualMin: 1, plannedMin: 1, mode: 'focus', completed: true });
    store.softDeleteTasks([root.id]);
    // Simulate an older/offline client restoring one nested row on its own.
    store.updateTask(keep.id, { deletedAt: null });
    expect(store.permanentlyDeleteTasks([root.id, keep.id])).toBe(2);
    expect(store.getData().tasks).toHaveLength(1);
    expect(find(store, keep.id)).toMatchObject({ parentId: null, kind: 'node', project: false });
    expect(isProject(find(store, keep.id))).toBe(false);
    expect(store.getData().links).toHaveLength(0);
    expect(store.getData().events[0]).toMatchObject({ title: 'meeting history', taskId: null });
    expect(store.getData().sessions[0]).toMatchObject({ actualMin: 1, taskId: null });
    expect(store.permanentlyDeleteTasks([keep.id])).toBe(0);
    store.destroy();
  });

  it('does not resurrect purged tasks after an offline edit, undo or redo', () => {
    const a = new CortexStore('u'), b = new CortexStore('u');
    const root = a.createProject('Project');
    const child = a.createTask({ title: 'private content', parentId: root.id, status: 'todo' });
    sync(a, b);
    a.softDeleteTasks([root.id]);
    a.permanentlyDeleteTasks([root.id]);
    b.updateTask(child.id, { notes: 'offline edit' });
    sync(a, b);
    expect(a.getData().tasks).toHaveLength(0); expect(b.getData().tasks).toHaveLength(0);
    for (let i = 0; i < 5; i++) a.undo();
    expect(a.getData().tasks).toHaveLength(0);
    for (let i = 0; i < 5; i++) a.redo();
    expect(a.getData().tasks).toHaveLength(0);
    a.destroy(); b.destroy();
  });
});
