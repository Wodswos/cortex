import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { CortexStore } from '@cortex/crdt';
import { bindTimer, unbindTimer, useTimer } from '../src/focus/timer';
vi.mock('@cortex/platform', () => ({ chime: vi.fn(), notify: vi.fn() }));
let storage: Map<string, string>;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T08:00:00Z'));
  storage = new Map();
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
});
afterEach(() => { unbindTimer(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('account-scoped timer recovery', () => {
  it('restores its scheduler and finishes once after reloading', () => {
    const store = new CortexStore('a'); bindTimer(store);
    useTimer.getState().start({ min: 0.1 }); vi.advanceTimersByTime(3000);
    unbindTimer(); bindTimer(store); vi.advanceTimersByTime(3000);
    expect(store.getData().sessions).toHaveLength(1);
    expect(store.getData().sessions[0]).toMatchObject({ completed: true, actualMin: 0.1, ownerId: 'a' });
    bindTimer(store); vi.advanceTimersByTime(6000);
    expect(store.getData().sessions).toHaveLength(1);
  });
  it('records expiration while closed and deduplicates a replay of the unfinished mirror', () => {
    const store = new CortexStore('a'); bindTimer(store); useTimer.getState().start({ min: 0.1 });
    unbindTimer(); const unfinished = storage.get('cortex-timer:a')!;
    vi.advanceTimersByTime(10000); bindTimer(store);
    expect(store.getData().sessions).toHaveLength(1);
    unbindTimer(); storage.set('cortex-timer:a', unfinished); bindTimer(store);
    expect(store.getData().sessions).toHaveLength(1);
  });
  it('keeps each account timer and completion records isolated', () => {
    const a = new CortexStore('a'), b = new CortexStore('b');
    bindTimer(a); useTimer.getState().start({ min: 0.1, taskId: 'a-task' });
    bindTimer(b); expect(useTimer.getState().status).toBe('idle');
    useTimer.getState().start({ min: 0.1 }); vi.advanceTimersByTime(6000);
    expect(a.getData().sessions).toHaveLength(0); expect(b.getData().sessions).toHaveLength(1);
    bindTimer(a); expect(a.getData().sessions[0]).toMatchObject({ taskId: 'a-task', ownerId: 'a' });
    expect(b.getData().sessions).toHaveLength(1);
  });
  it('does not silently replace an active session and excludes paused time from partial credit', () => {
    const a = new CortexStore('a'); bindTimer(a); useTimer.getState().start({ min: 25 });
    const id = useTimer.getState().sessionId;
    useTimer.getState().start({ min: 90 }); expect(useTimer.getState().sessionId).toBe(id);
    vi.advanceTimersByTime(60000); useTimer.getState().pause();
    vi.advanceTimersByTime(60000); useTimer.getState().resume();
    vi.advanceTimersByTime(60000); useTimer.getState().abandon(true);
    expect(a.getData().sessions[0]!.actualMin).toBe(2);
  });
});
