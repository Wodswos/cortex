import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { CortexStore } from '../src/store';
import { logCountOn } from '@cortex/core';

it('edits schedules in place, preserves check-ins and interval anchors, and syncs/backups without account leakage', () => {
  const store = new CortexStore('a'), peer = new CortexStore('a'), restored = new CortexStore('a'), outsider = new CortexStore('b');
  try {
    const habit = store.createHabit({ name: '阅读', reminderAt: '20:00', reminderEnabled: true, cadence: { type: 'interval', everyNDays: 2 }, targetPerDay: 2 });
    store.logHabit(habit.id, '2026-11-04', 1, 2);
    store.stopUndoCapture();
    store.updateHabit(habit.id, { name: '认真阅读', reminderAt: '21:30', reminderEnabled: false, targetPerDay: 3 });
    store.stopUndoCapture();
    expect(store.getData().habits[0]).toMatchObject({ id: habit.id, name: '认真阅读', createdAt: habit.createdAt, reminderAt: '21:30', reminderEnabled: false });
    expect(logCountOn(store.getData().habitLogs, habit.id, '2026-11-04')).toBe(1);
    for (const doc of ['habits', 'habitLogs'] as const) Y.applyUpdate(peer.docs[doc], Y.encodeStateAsUpdate(store.docs[doc]), 'remote');
    expect(peer.getData().habits).toEqual(store.getData().habits);
    expect(peer.getData().habitLogs).toEqual(store.getData().habitLogs);
    expect(outsider.getData().habits).toHaveLength(0);
    restored.importJSON(store.exportSnapshot());
    expect(restored.getData().habits).toEqual(store.getData().habits);
    expect(restored.getData().habitLogs).toEqual(store.getData().habitLogs);
    store.undo();
    expect(store.getData().habits[0]?.name).toBe('阅读');
    expect(logCountOn(store.getData().habitLogs, habit.id, '2026-11-04')).toBe(1);
  } finally { store.destroy(); peer.destroy(); restored.destroy(); outsider.destroy(); }
});
it('validates before writes and rejects invalid imports atomically', () => {
  const store = new CortexStore('a');
  try {
    expect(() => store.createHabit({ name: 'bad', reminderAt: '99:99' })).toThrow();
    expect(store.getData().habits).toHaveLength(0);
    const habit = store.createHabit({ name: 'old' });
    expect(() => store.updateHabit(habit.id, { name: 'new', reminderAt: '99:99' })).toThrow();
    expect(store.getData().habits[0]?.name).toBe('old');
    expect(() => store.importJSON({ tasks: [{ id: 'unexpected' }], habits: [{ ...habit, reminderEnabled: 'invalid' }] })).toThrow();
    expect(store.getData().tasks).toHaveLength(0);
  } finally { store.destroy(); }
});
it('soft deletion retains check-ins and a single undo restores the habit and its complete history', () => {
  const store = new CortexStore('a');
  try {
    const habit = store.createHabit({ name: '阅读' });
    store.logHabit(habit.id, '2026-11-04', 1);
    store.stopUndoCapture(); store.deleteHabit(habit.id); store.stopUndoCapture();
    expect(store.getData().habits[0]?.deletedAt).toBeTruthy();
    expect(logCountOn(store.getData().habitLogs, habit.id, '2026-11-04')).toBe(1);
    store.undo();
    expect(store.getData().habits[0]?.deletedAt).toBeNull();
    expect(logCountOn(store.getData().habitLogs, habit.id, '2026-11-04')).toBe(1);
  } finally { store.destroy(); }
});
it('syncs ordering as one undoable preference, isolates accounts and preserves it in binary and JSON backups', () => {
  const store = new CortexStore('a'), peer = new CortexStore('a'), restored = new CortexStore('a'), other = new CortexStore('b');
  try {
    store.stopUndoCapture(); store.updateSettings({ habitSort: 'manual', habitOrder: ['b', 'a'] }); store.stopUndoCapture();
    Y.applyUpdate(peer.docs.root, Y.encodeStateAsUpdate(store.docs.root), 'remote');
    expect(peer.getData().settings).toMatchObject({ habitSort: 'manual', habitOrder: ['b', 'a'] });
    expect(other.getData().settings).toMatchObject({ habitSort: 'time', habitOrder: [] });
    restored.importJSON(store.exportSnapshot());
    expect(restored.getData().settings).toMatchObject({ habitSort: 'manual', habitOrder: ['b', 'a'] });
    store.undo();
    expect(store.getData().settings).toMatchObject({ habitSort: 'time', habitOrder: [] });
    store.redo();
    store.importJSON({ settings: { habitSort: 'time', habitOrder: ['a', 'c'] } });
    expect(store.getData().settings).toMatchObject({ habitSort: 'manual', habitOrder: ['b', 'a', 'c'] });
    expect(() => store.updateSettings({ habitSort: 'time', habitOrder: ['dup', 'dup'] })).toThrow();
    expect(store.getData().settings.habitSort).toBe('manual');
    expect(() => store.importJSON({ tasks: [{ id: 'unexpected' }], settings: { habitOrder: [false] } })).toThrow();
    expect(store.getData().tasks).toHaveLength(0);
  } finally { store.destroy(); peer.destroy(); restored.destroy(); other.destroy(); }
});
