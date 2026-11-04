import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { MIND_APPEARANCE_FIELDS, MIND_FONT_KEYS, RESET_MIND_APPEARANCE, validateCortexData } from '@cortex/core';
import { CortexStore, DOC_IDS } from '../src/store';

function sync(a: CortexStore, b: CortexStore) {
  for (const id of DOC_IDS) {
    const left = Y.encodeStateAsUpdate(a.docs[id]), right = Y.encodeStateAsUpdate(b.docs[id]);
    Y.applyUpdate(a.docs[id], right, 'remote');
    Y.applyUpdate(b.docs[id], left, 'remote');
  }
}

describe('mind-map appearance', () => {
  it('changes a batch in one update, keeps task content and undoes independently from earlier edits', () => {
    const store = new CortexStore('u');
    const a = store.createTask({ title: 'A', status: 'todo', mindBackground: 'sage' });
    const b = store.createTask({ title: 'B', status: 'doing', mindFontSize: 12 });
    const deleted = store.createTask({ title: 'deleted' });
    store.softDeleteTask(deleted.id);
    store.updateTask(a.id, { notes: 'keep me', dueAt: 1000 });
    const before = store.getData().tasks;
    let updates = 0;
    store.onDocUpdate = (id) => { if (id === 'tasks') updates++; };
    store.setMindAppearance([a.id, b.id, a.id, deleted.id, 'missing'], { mindBackground: 'blue', mindFontSize: 20, mindBold: true });
    expect(updates).toBe(1);
    const styled = store.getData().tasks;
    expect(styled.find((task) => task.id === a.id)).toMatchObject({ title: 'A', notes: 'keep me', dueAt: 1000, mindBackground: 'blue', mindFontSize: 20, mindBold: true });
    expect(styled.find((task) => task.id === b.id)).toMatchObject({ title: 'B', status: 'doing', mindBackground: 'blue', mindFontSize: 20 });
    expect(styled.find((task) => task.id === deleted.id)?.mindBackground).toBeUndefined();
    expect(store.undo()).toBe(true);
    expect(store.getData().tasks).toEqual(before);
    store.redo();
    expect(store.getData().tasks).toEqual(styled);
    store.destroy();
  });

  it('merges concurrent style fields and title edits, resets styles, and round-trips both backup formats', () => {
    const a = new CortexStore('u'), b = new CortexStore('u');
    const task = a.createTask({ title: 'original', status: 'todo', mindItalic: true });
    sync(a, b);
    a.setMindAppearance([task.id], { mindBackground: '#abc123' });
    b.setMindAppearance([task.id], { mindFontFamily: 'serif', mindFontSize: 24 });
    b.updateTask(task.id, { title: 'remote title' });
    sync(a, b);
    const expected = a.getData().tasks[0]!;
    expect(expected).toMatchObject({ title: 'remote title', mindBackground: '#abc123', mindFontFamily: 'serif', mindFontSize: 24, mindItalic: true });
    expect(b.getData().tasks).toEqual(a.getData().tasks);
    for (const backup of [a.exportJSON(), a.exportSnapshot()]) {
      const restored = new CortexStore('u');
      restored.importJSON(backup);
      expect(restored.getData().tasks).toEqual(a.getData().tasks);
      restored.destroy();
    }
    a.setMindAppearance([task.id], RESET_MIND_APPEARANCE);
    expect(a.getData().tasks[0]).toMatchObject(RESET_MIND_APPEARANCE);
    expect(a.getData().tasks[0]?.title).toBe('remote title');
    a.undo();
    expect(a.getData().tasks[0]).toEqual(expected);
    a.destroy(); b.destroy();
  });

  it('syncs and exports every licensed font and the expanded size range', () => {
    const a = new CortexStore('u'), b = new CortexStore('u');
    for (const mindFontFamily of MIND_FONT_KEYS) a.createTask({ title: mindFontFamily, mindFontFamily, mindFontSize: 32 });
    sync(a, b);
    expect(b.getData().tasks).toEqual(a.getData().tasks);
    const restored = new CortexStore('u');
    restored.importJSON(a.exportJSON());
    expect(restored.getData().tasks).toEqual(a.getData().tasks);
    a.destroy(); b.destroy(); restored.destroy();
  });

  it('rejects unsafe or malformed styles before any mutation and accepts old data and explicit resets', () => {
    const store = new CortexStore('u');
    const task = store.createTask({ title: 'existing', status: 'todo' });
    const before = store.exportJSON();
    for (const patch of [
      { mindBackground: 'url(https://example.com)' }, { mindTextColor: '#123' },
      { mindFontFamily: 'arbitrary-font' }, { mindFontSize: 100 }, { mindFontSize: 14.5 },
      { mindBold: 'true' }, { mindItalic: {} },
    ]) {
      expect(() => store.setMindAppearance([task.id], patch as any)).toThrow();
      expect(() => store.updateTask(task.id, patch as any)).toThrow();
      expect(() => store.createTask({ title: 'bad', ...patch } as any)).toThrow();
      expect(() => store.importJSON({ tasks: [{ id: 'new', title: 'valid' }, { id: 'bad', ...patch }] })).toThrow();
      expect(store.exportJSON()).toEqual(before);
    }
    expect(() => validateCortexData({ tasks: [{ id: 'old', title: 'legacy' }] })).not.toThrow();
    for (const field of MIND_APPEARANCE_FIELDS) expect(() => validateCortexData({ tasks: [{ id: 'reset', [field]: null }] })).not.toThrow();
    store.destroy();
  });
});
