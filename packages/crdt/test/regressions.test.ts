import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { buildChildrenMap, flattenTree, logCountOn } from '@cortex/core';
import { CortexStore, DOC_IDS } from '../src/store';

function sync(a: CortexStore, b: CortexStore) {
  for (const id of DOC_IDS) {
    const first = Y.encodeStateAsUpdate(a.docs[id]), second = Y.encodeStateAsUpdate(b.docs[id]);
    Y.applyUpdate(b.docs[id], first, 'remote'); Y.applyUpdate(a.docs[id], second, 'remote');
  }
}
describe('distributed data regressions', () => {
  it('concurrent inverse moves converge to a visible, acyclic forest', () => {
    const a = new CortexStore('u'), b = new CortexStore('u');
    const x = a.createTask({ title: 'A', status: 'todo' }), y = a.createTask({ title: 'B', status: 'todo' });
    sync(a, b);
    a.reparent(x.id, y.id, 0); b.reparent(y.id, x.id, 0); sync(a, b);
    expect(a.getData().tasks).toEqual(b.getData().tasks);
    expect(flattenTree(buildChildrenMap(a.getData().tasks))).toHaveLength(2);
    expect(a.getData().tasks.filter((task) => task.parentId === null)).toHaveLength(1);
    const parentBefore = a.getData().tasks.find((task) => task.id === x.id)!.parentId;
    a.reparent(x.id, x.id, 0);
    expect(a.getData().tasks.find((task) => task.id === x.id)!.parentId).toBe(parentBefore);
  });
  it('preserves concurrent habit increments and deduplicates concurrent cancellation', () => {
    const a = new CortexStore('u'), b = new CortexStore('u');
    const habit = a.createHabit({ name: 'water', targetPerDay: 8 });
    const day = '2026-10-26';
    a.logHabit(habit.id, day, 1, 8); sync(a, b);
    a.logHabit(habit.id, day, -1, 8); b.logHabit(habit.id, day, -1, 8); sync(a, b);
    expect(logCountOn(a.getData().habitLogs, habit.id, day)).toBe(0);
    a.logHabit(habit.id, day, 1, 8); b.logHabit(habit.id, day, 1, 8); sync(a, b);
    expect(logCountOn(a.getData().habitLogs, habit.id, day)).toBe(2);
    a.logHabit(habit.id, day, 1, 8); b.logHabit(habit.id, day, 1, 8); sync(a, b);
    expect(logCountOn(a.getData().habitLogs, habit.id, day)).toBe(4);
  });
  it('imports old JSON without reverting newer edits, and restores settings on an empty store', () => {
    const store = new CortexStore('u');
    const task = store.createTask({ title: 'old', status: 'todo' });
    store.updateSettings({ accent: 'rose', servers: [{ id: 'srv', name: 'host', host: 'user@example.com' }] });
    const old = JSON.parse(JSON.stringify(store.exportJSON()));
    store.updateTask(task.id, { title: 'new', deletedAt: 123 });
    store.importJSON(old);
    expect(store.getData().tasks[0]).toMatchObject({ title: 'new', deletedAt: 123 });
    const restored = new CortexStore('u'); restored.importJSON(old);
    expect(restored.getData().settings).toMatchObject({ accent: 'rose', servers: old.settings.servers });
  });
  it('binary backups preserve history and the server export format can be restored', () => {
    const store = new CortexStore('u');
    const task = store.createTask({ title: 'old', status: 'todo' });
    const old = store.exportSnapshot();
    store.updateTask(task.id, { title: 'new' }); store.importJSON(old);
    expect(store.getData().tasks[0]!.title).toBe('new');
    const restored = new CortexStore('u');
    restored.importJSON({ format: 'cortex.server-export', version: 1, docs: store.exportSnapshot().docs });
    expect(restored.exportJSON()).toEqual(store.exportJSON());
  });
  it('rejects malformed backups before applying any entities or documents', () => {
    const store = new CortexStore('u');
    expect(() => store.importJSON({ tasks: [{ id: 'valid', title: 'one' }], events: [{ id: 'bad', start: 'tomorrow' }] })).toThrow();
    expect(store.getData().tasks).toEqual([]);
    expect(() => store.importJSON({ tasks: [{ id: 'null_title', title: null }] })).toThrow();
    expect(() => store.importJSON({ tasks: [{ id: 'null_tags', tags: null }] })).toThrow();
    expect(() => store.importJSON({ events: [{ id: 'reversed', start: 100, end: 1 }] })).toThrow();
    const valid = new CortexStore('u'); valid.createTask({ title: 'one' });
    const backup = valid.exportSnapshot(); backup.docs.events = '/w==';
    expect(() => store.importJSON(backup)).toThrow();
    expect(store.getData().tasks).toEqual([]);
  });
  it('claims anonymous data once, copies its tags, and consumes the source after persistence', () => {
    const local = new CortexStore('local'), a = new CortexStore('a'), b = new CortexStore('b');
    const tag = local.ensureTag('work');
    const task = local.createTask({ title: 'anonymous', tags: [tag.id] });
    a.absorbLocal(local); a.updateTask(task.id, { title: 'edited' });
    a.absorbLocal(local); b.absorbLocal(local);
    expect(a.getData().tasks[0]!.title).toBe('edited');
    expect(a.getData().tags[0]!.id).toBe(tag.id);
    expect(b.getData().tasks).toHaveLength(0);
    local.consumeLocal('a'); expect(local.getData().tasks).toHaveLength(0);
    local.createTask({ title: 'new batch' }); b.absorbLocal(local);
    expect(b.getData().tasks[0]!.title).toBe('new batch');
  });
  it('undo follows operation order across documents and divergent edits clear all redo stacks', () => {
    const store = new CortexStore('u');
    const task = store.createTask({ title: 'before' }); store.stopUndoCapture();
    store.updateTask(task.id, { title: 'one' });
    const habit = store.createHabit({ name: 'habit' });
    store.updateTask(task.id, { title: 'two' });
    store.undo();
    expect(store.getData().tasks[0]!.title).toBe('one');
    expect(store.getData().habits).toHaveLength(1);
    store.updateHabit(habit.id, { name: 'different history' });
    expect(store.canRedo()).toBe(false);
  });
  it('retains unchanged collection references when another document changes', () => {
    const store = new CortexStore('u'); store.createTask({ title: 'task', priority: 'P2' });
    const before = store.getData(); store.createHabit({ name: 'habit' });
    expect(store.getData().tasks).toBe(before.tasks);
    expect(store.getData().tasks[0]).toMatchObject({ priority: 'P2', important: false, urgent: true });
  });
});
