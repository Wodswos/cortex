import { describe, expect, it } from 'vitest';
import { taskBranchIds, trashRoots, type Task } from '../src';
const task = (id: string, parentId: string | null, deletedAt?: number): Task => ({ id, title: id, parentId, deletedAt, status: 'todo', tags: [], important: false, urgent: false, ownerId: 'u', order: 0, createdAt: 1, updatedAt: 1 });
describe('trash tree projection', () => {
  it('groups deleted branches, retains live-parent context and orders the newest deletion first', () => {
    const tasks = [task('project', null, 100), task('child', 'project', 100), task('live', null), task('new', 'live', 200)];
    expect(trashRoots(tasks).map((row) => row.id)).toEqual(['new', 'project']);
    expect(trashRoots(tasks)[0]?.parentId).toBe('live');
    expect([...taskBranchIds(tasks, ['project', 'child', 'missing'])].sort()).toEqual(['child', 'project']);
  });
  it('normalizes broken imported hierarchies without dropping deleted content or looping', () => {
    const tasks = [task('a', 'b', 100), task('b', 'a', 100), task('orphan', 'missing', 200)];
    expect(trashRoots(tasks).map((row) => row.id)).toEqual(['orphan', 'a']);
    expect([...taskBranchIds(tasks, ['a'])].sort()).toEqual(['a', 'b']);
  });
});
