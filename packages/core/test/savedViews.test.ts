import { describe, expect, it } from 'vitest';
import { DEFAULT_SAVED_VIEWS, normalizeTaskView, savedViewHref, validateCortexData, validateSavedViews } from '../src';

describe('saved task workspace views', () => {
  it('keeps relative months and weeks relative, and preserves fixed ranges and project boundaries', () => {
    const month = new URL(savedViewHref(DEFAULT_SAVED_VIEWS[0]!), 'https://cortex.test');
    expect(month.searchParams.get('scope')).toBe('month');
    expect(month.searchParams.has('from')).toBe(false);
    const fixed = { id: 'range', name: '项目日历', view: 'timeline' as const, scope: 'custom' as const, projectId: 'project', from: '2026-11-01', to: '2026-11-30' };
    validateSavedViews([fixed]);
    const url = new URL(savedViewHref(fixed), 'https://cortex.test');
    expect(url.pathname).toBe('/tasks');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ project: 'project', from: '2026-11-01', to: '2026-11-30', saved: 'range' });
    expect(normalizeTaskView('calendar')).toBe('timeline');
    expect(normalizeTaskView('timeline')).toBe('timeline');
  });
  it('rejects invalid records, impossible dates and duplicate IDs before importing', () => {
    const item = DEFAULT_SAVED_VIEWS[0]!;
    for (const value of [[{ ...item, name: ' ' }], [{ ...item, view: 'javascript:alert(1)' }], [item, item], [{ ...item, work: 'invalid' }], [{ ...item, taskStatus: 'archived' }], [{ ...item, taskPriority: 'urgent' }], [{ ...item, taskTag: 'https://foreign.test' }], [{ ...item, projectId: 'https://foreign.test' }], [{ ...item, scope: 'custom', from: '2026-02-31', to: '2026-03-05' }], [{ ...item, scope: 'custom', from: '2026-11-03', to: '2026-11-01' }], [{ ...item, scope: 'custom', from: '2026-11-03', to: '2028-12-01' }]]) {
      expect(() => validateCortexData({ settings: { savedViews: value } })).toThrow();
    }
    expect(() => validateCortexData({ settings: { savedViews: [] } })).not.toThrow();
  });
  it('round trips shared filters and all-time temporal views while accepting legacy presets', () => {
    const item = { id: 'work', name: '历史工作', view: 'gantt' as const, scope: 'all' as const, work: 'current' as const, taskStatus: 'unfinished' as const, taskPriority: 'high' as const, taskTag: 'tag' };
    validateSavedViews([item, DEFAULT_SAVED_VIEWS[0]!]);
    expect(Object.fromEntries(new URL(savedViewHref(item), 'https://cortex.test').searchParams)).toEqual({ saved: 'work', view: 'gantt', scope: 'all', work: 'current', taskStatus: 'unfinished', taskPriority: 'high', taskTag: 'tag' });
    expect(() => validateSavedViews([{ ...item, scope: 'undated' }])).not.toThrow();
  });
});
