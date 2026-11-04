import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CortexStore } from '../src/store';

const matrix = { id: 'matrix', name: '全局四象限', view: 'matrix' as const, scope: 'all' as const, projectId: null };
describe('account workspace presets', () => {
  it('syncs configuration, restores backups, merges plain JSON and preserves an intentionally empty sidebar', () => {
    const a = new CortexStore('a'), other = new CortexStore('other'), peer = new CortexStore('a'), restored = new CortexStore('a');
    try {
      a.updateSettings({ savedViews: [matrix] });
      Y.applyUpdate(peer.docs.root, Y.encodeStateAsUpdate(a.docs.root), 'remote');
      expect(peer.getData().settings.savedViews).toEqual([matrix]);
      expect(other.getData().settings.savedViews).not.toContainEqual(matrix);
      restored.importJSON(a.exportSnapshot());
      expect(restored.getData().settings.savedViews).toEqual([matrix]);
      a.importJSON({ settings: { savedViews: [{ id: 'month', name: '本月日历', view: 'timeline', scope: 'month' }] } });
      expect(a.getData().settings.savedViews.map((view) => view.id)).toEqual(['matrix', 'month']);
      a.stopUndoCapture(); a.updateSettings({ savedViews: [] }); a.stopUndoCapture();
      expect(a.getData().settings.savedViews).toEqual([]);
      a.undo(); expect(a.getData().settings.savedViews.map((view) => view.id)).toEqual(['matrix', 'month']);
    } finally { a.destroy(); other.destroy(); peer.destroy(); restored.destroy(); }
  });
  it('validates malformed imports before changing any tasks or settings', () => {
    const store = new CortexStore('a');
    try {
      expect(() => store.importJSON({ tasks: [{ id: 'unexpected', title: 'must not import' }], settings: { savedViews: [{ ...matrix, scope: 'custom', from: 'bad', to: 'bad' }] } })).toThrow();
      expect(store.getData().tasks).toHaveLength(0);
      expect(() => store.updateSettings({ savedViews: [{ ...matrix, name: '' }] })).toThrow();
      expect(store.getData().settings.savedViews[0]?.id).toBe('calendar-month');
    } finally { store.destroy(); }
  });
});
