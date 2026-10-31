import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { isProject } from '@cortex/core';
import { CortexStore, DOC_IDS } from '../src/store';

describe('project identity through edits, sync, undo and export', () => {
  it('creates a project root in sibling order and protects it from drag or type changes', () => {
    const store = new CortexStore('u');
    store.createTask({ title: 'existing', order: 30, status: 'todo' });
    const project = store.createProject('  Project A  ');
    const other = store.createProject('Project B');
    expect(project).toMatchObject({ title: 'Project A', project: true, kind: 'node', parentId: null, status: 'todo', order: 31 });
    store.reparent(project.id, other.id, 0);
    store.setTaskKind(project.id, 'todo');
    store.updateTask(project.id, { project: false });
    expect(store.getData().tasks.find((task) => task.id === project.id)).toMatchObject({ project: true, kind: 'node', parentId: null });
    expect(() => store.createProject(' ')).toThrow();
    store.destroy();
  });
  it('keeps an internal group ordinary when outdented and preserves a legacy project on its first edit', () => {
    const store = new CortexStore('u');
    store.importJSON({ tasks: [
      { id: 'legacy', title: 'old project', kind: 'node', parentId: null, status: 'todo' },
      { id: 'group', title: 'inner group', kind: 'node', parentId: 'legacy', status: 'todo' },
    ] });
    store.reparent('group', null, 2);
    store.updateTask('legacy', { title: 'renamed project' });
    expect(store.getData().tasks.find((task) => task.id === 'legacy')).toMatchObject({ project: true, parentId: null, title: 'renamed project' });
    const group = store.getData().tasks.find((task) => task.id === 'group')!;
    expect(group).toMatchObject({ project: false, kind: 'node', parentId: null });
    expect(isProject(group)).toBe(false);
    store.destroy();
  });
  it('retains the project ID, children and root invariant across remote legacy writes and backup restore', () => {
    const a = new CortexStore('u');
    const project = a.createProject('Project');
    const child = a.createTask({ title: 'work', status: 'todo', parentId: project.id });
    const b = new CortexStore('u');
    for (const id of DOC_IDS) Y.applyUpdate(b.docs[id], Y.encodeStateAsUpdate(a.docs[id]), 'remote');
    // Simulate an older client which does not know the project root invariant.
    const raw = b.docs.tasks.getMap<Y.Map<unknown>>('items').get(project.id)!;
    raw.set('parentId', child.id);
    Y.applyUpdate(a.docs.tasks, Y.encodeStateAsUpdate(b.docs.tasks), 'remote');
    expect(a.getData().tasks.find((task) => task.id === project.id)?.parentId).toBeNull();
    const restored = new CortexStore('u');
    restored.importJSON(a.exportSnapshot());
    expect(restored.getData().tasks).toEqual(a.getData().tasks);
    expect(restored.getData().tasks.find((task) => task.id === child.id)?.parentId).toBe(project.id);
    a.destroy(); b.destroy(); restored.destroy();
  });
  it('archives and restores a project with undo without changing its child tasks', () => {
    const store = new CortexStore('u');
    const project = store.createProject('Project');
    const child = store.createTask({ title: 'work', status: 'todo', parentId: project.id });
    store.stopUndoCapture();
    store.setTaskStatus(project.id, 'archived');
    store.stopUndoCapture();
    store.undo();
    expect(store.getData().tasks.find((task) => task.id === project.id)).toMatchObject({ status: 'todo', project: true });
    expect(store.getData().tasks.find((task) => task.id === child.id)).toMatchObject({ status: 'todo', parentId: project.id });
    store.destroy();
  });
});
