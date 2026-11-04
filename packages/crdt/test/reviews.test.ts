import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CortexStore, DOC_IDS } from '../src/store';
import { reviewPeriod } from '@cortex/core';

const period = reviewPeriod('daily', new Date(2026, 9, 25));
const sync = (a: CortexStore, b: CortexStore) => {
  for (const id of DOC_IDS) {
    const first = Y.encodeStateAsUpdate(a.docs[id]), second = Y.encodeStateAsUpdate(b.docs[id]);
    Y.applyUpdate(a.docs[id], second, 'remote'); Y.applyUpdate(b.docs[id], first, 'remote');
  }
};

describe('account review records', () => {
  it('merges different fields when devices independently start the same review offline', () => {
    const a = new CortexStore('u'), b = new CortexStore('u');
    a.updateReview(period, { highlights: 'Finished the prototype' });
    b.updateReview(period, { friction: 'Waiting for feedback', resolution: 'Prealign with the reviewer', nextSteps: 'Ask for a decision' });
    sync(a, b);
    expect(a.getData().reviews).toHaveLength(1);
    expect(a.getData().reviews[0]).toMatchObject({ highlights: 'Finished the prototype', friction: 'Waiting for feedback', resolution: 'Prealign with the reviewer', nextSteps: 'Ask for a decision' });
    expect(b.getData().reviews).toEqual(a.getData().reviews);
  });
  it('keeps finalized facts unchanged when tasks change, supports reopen and undo', () => {
    const store = new CortexStore('u');
    const task = store.createTask({ title: 'Original title', status: 'done', completedAt: new Date(2026, 9, 25, 10).getTime() });
    store.updateReview(period, { highlights: 'Shipped' }); store.stopUndoCapture();
    const completed = store.completeReview(period); store.stopUndoCapture();
    expect(completed.facts?.completed[0]!.title).toBe('Original title');
    store.updateTask(task.id, { title: 'Renamed later', status: 'todo', completedAt: null });
    expect(store.getData().reviews[0]!.facts?.completed[0]!.title).toBe('Original title');
    store.stopUndoCapture(); store.updateReview(period, { completedAt: null }); store.stopUndoCapture();
    expect(store.getData().reviews[0]!.completedAt).toBeNull();
    store.undo(); expect(store.getData().reviews[0]!.completedAt).not.toBeNull();
  });
  it('restores reports from both backup formats and migrates anonymous reports once', () => {
    const local = new CortexStore('local');
    local.updateReview(period, { highlights: 'Local reflection', resolution: 'Talk earlier' }); local.completeReview(period);
    const restored = new CortexStore('restored'); restored.importJSON(local.exportSnapshot());
    expect(restored.getData().reviews).toEqual(local.getData().reviews);
    const legacy = new CortexStore('legacy'); legacy.importJSON({ reviews: local.exportJSON().reviews });
    expect(legacy.getData().reviews[0]!.ownerId).toBe('legacy');
    expect(legacy.getData().reviews[0]!.resolution).toBe('Talk earlier');
    const account = new CortexStore('u'); account.absorbLocal(local); local.consumeLocal('u');
    expect(account.getData().reviews[0]!.highlights).toBe('Local reflection');
    expect(account.getData().reviews[0]!.resolution).toBe('Talk earlier');
    expect(local.getData().reviews).toEqual([]);
    const other = new CortexStore('other'); other.absorbLocal(local);
    expect(other.getData().reviews).toEqual([]);
    expect(other.getData().settings.reviewDailyTime).toBe('21:30');
  });
  it('rejects invalid input without partial writes and refuses an empty completion', () => {
    const store = new CortexStore('u');
    expect(() => store.updateReview(period, { highlights: 'Valid', friction: 'x'.repeat(100001) })).toThrow();
    expect(store.getData().reviews).toEqual([]);
    expect(() => store.updateReview(period, { highlights: 'Valid', resolution: 'x'.repeat(100001) })).toThrow();
    expect(store.getData().reviews).toEqual([]);
    expect(() => store.completeReview(period)).toThrow();
    store.updateReview(period, { highlights: 'draft' });
    const before = store.exportSnapshot().docs.root;
    const invalid = { ...store.exportJSON().reviews[0], facts: { capturedAt: 1, completed: [], pending: [], focusMin: -1, projects: [] } };
    expect(() => store.importJSON({ reviews: [invalid] })).toThrow();
    expect(store.exportSnapshot().docs.root).toBe(before);
  });
  it('reads and imports older reviews without losing their completion or facts', () => {
    const source = new CortexStore('u');
    source.updateReview(period, { friction: 'An earlier blocker' });
    const completed = source.completeReview(period);
    const { resolution: _resolution, ...oldReview } = completed;
    const legacy = new CortexStore('u'); legacy.importJSON({ reviews: [oldReview] });
    expect(legacy.getData().reviews[0]).toEqual({ ...completed, resolution: '' });
    const snapshot = source.exportSnapshot();
    const restored = new CortexStore('u'); restored.importJSON(snapshot);
    expect(restored.getData().reviews[0]!.resolution).toBe('');
  });
  it('can complete a solution-only review and reopens it when the solution changes', () => {
    const store = new CortexStore('u');
    store.updateReview(period, { resolution: 'Ask for help earlier' });
    store.stopUndoCapture();
    const completed = store.completeReview(period); store.stopUndoCapture();
    expect(completed.completedAt).not.toBeNull();
    store.updateReview(period, { resolution: 'Set a daily feedback slot' }); store.stopUndoCapture();
    expect(store.getData().reviews[0]).toMatchObject({ resolution: 'Set a daily feedback slot', completedAt: null });
    store.undo();
    expect(store.getData().reviews[0]).toMatchObject({ resolution: 'Ask for help earlier', completedAt: completed.completedAt });
  });
});
