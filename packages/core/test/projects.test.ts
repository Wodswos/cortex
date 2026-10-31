import { describe, expect, it } from 'vitest';
import { activeTasks, buildChildrenMap, canReparent, isProject, isStructural, normalizeTaskForest, tasksInProject } from '../src/tree';
import { validateCortexData } from '../src/validation';
import type { Task } from '../src/types';

const task = (id: string, patch: Partial<Task> = {}): Task => ({
  id, title: id, parentId: null, status: 'todo', order: 0, important: false, urgent: false,
  ownerId: 'u', tags: [], createdAt: 1, updatedAt: 1, ...patch,
});

describe('project roots and internal groups', () => {
  it('recognizes legacy project roots while keeping explicit ordinary groups separate', () => {
    expect(isProject(task('legacy', { kind: 'node' }))).toBe(true);
    expect(isProject(task('group', { kind: 'node', project: false }))).toBe(false);
    expect(isProject(task('nested', { kind: 'node', parentId: 'legacy' }))).toBe(false);
    expect(isProject(task('action'))).toBe(false);
    expect(isStructural(task('project', { project: true }))).toBe(true);
  });
  it('projects concurrent or imported attempts to nest a project back to its root', () => {
    const normalized = normalizeTaskForest([
      task('a', { kind: 'node', project: true, parentId: 'b' }),
      task('b', { kind: 'node', project: true, parentId: 'a' }),
      task('child', { parentId: 'a' }),
    ]);
    expect(normalized.map((value) => [value.id, value.parentId])).toEqual([['a', null], ['b', null], ['child', 'a']]);
  });
  it('allows root sorting and group moves but prevents nesting project roots', () => {
    const children = buildChildrenMap([
      task('legacy', { kind: 'node' }), task('new', { kind: 'node', project: true }),
      task('group', { kind: 'node', project: false }), task('child', { parentId: 'group' }),
    ]);
    expect(canReparent('legacy', 'new', children)).toBe(false);
    expect(canReparent('new', null, children)).toBe(true);
    expect(canReparent('group', 'new', children)).toBe(true);
    expect(canReparent('group', 'child', children)).toBe(false);
  });
  it('keeps the complete project subtree without pulling in unrelated or missing projects', () => {
    const tasks = [task('a'), task('a1', { parentId: 'a' }), task('a2', { parentId: 'a1' }), task('b'), task('b1', { parentId: 'b' })];
    expect(tasksInProject(tasks, 'a').map((value) => value.id)).toEqual(['a', 'a1', 'a2']);
    expect(tasksInProject(tasks, 'missing')).toEqual([]);
    expect(tasksInProject(tasks, null)).toBe(tasks);
  });
  it('validates project identity in JSON backups without requiring a field on legacy tasks', () => {
    expect(() => validateCortexData({ tasks: [task('new', { project: true }), task('legacy', { kind: 'node' })] })).not.toThrow();
    expect(() => validateCortexData({ tasks: [{ ...task('invalid'), project: 'true' }] })).toThrow();
  });
  it('hides the contents of archived projects without changing or deleting their tasks', () => {
    const tasks = [task('a', { kind: 'node', project: true, status: 'archived' }), task('a1', { parentId: 'a' }), task('a2', { parentId: 'a1' }), task('b')];
    expect(activeTasks(tasks).map((value) => value.id)).toEqual(['b']);
    expect(tasks[1]!.status).toBe('todo');
    expect(tasks[2]!.deletedAt).toBeUndefined();
  });
});
