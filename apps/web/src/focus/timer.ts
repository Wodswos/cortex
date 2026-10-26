import { create } from 'zustand';
import { newId, type FocusMode } from '@cortex/core';
import type { CortexStore } from '@cortex/crdt';
import { chime, notify } from '@cortex/platform';

export type TimerStatus = 'idle' | 'running' | 'paused';
interface FinishInfo {
  sessionId: string; startedAt: number; endedAt: number; mode: FocusMode; plannedMin: number;
  actualMin: number; completed: boolean; taskId: string | null; distractions: number;
}
export interface TimerState {
  mode: FocusMode; status: TimerStatus; taskId: string | null; plannedMin: number;
  endAt: number | null; remainingMs: number; distractions: number; cycleDone: number;
  sessionId: string | null; startedAt: number | null;
  immersive: boolean; noise: 'off' | 'rain' | 'brown' | 'cafe';
  start(opts: { mode?: FocusMode; min?: number; taskId?: string | null }): void;
  pause(): void; resume(): void; abandon(commitPartial?: boolean): void; completeEarly(): void; tick(): void;
  setImmersive(value: boolean): void; setNoise(noise: TimerState['noise']): void;
  onFinish(info: FinishInfo): void;
  onNext(info: { mode: FocusMode; cycleDone: number }): void;
}
type Mirror = Pick<TimerState, 'mode' | 'status' | 'taskId' | 'plannedMin' | 'endAt' | 'remainingMs' | 'distractions' | 'cycleDone' | 'sessionId' | 'startedAt'>;
let owner: string | null = null;
let interval: ReturnType<typeof setInterval> | null = null;
let hiddenAt: number | null = null;
const defaults: Mirror = { mode: 'focus', status: 'idle', taskId: null, plannedMin: 25, endAt: null, remainingMs: 25 * 60000, distractions: 0, cycleDone: 0, sessionId: null, startedAt: null };
function key() { return `cortex-timer:${owner}`; }
function load(): Partial<Mirror> {
  try {
    const stored = sessionStorage.getItem(key());
    const legacy = stored === null ? sessionStorage.getItem('cortex-timer') : null;
    const value = JSON.parse(stored ?? legacy ?? '{}');
    if (!value || typeof value !== 'object') return {};
    if (!['focus', 'short-break', 'long-break'].includes(value.mode) || !['idle', 'running', 'paused'].includes(value.status)) return {};
    for (const field of ['plannedMin', 'remainingMs', 'distractions', 'cycleDone']) if (typeof value[field] !== 'number' || !Number.isFinite(value[field]) || value[field] < 0) return {};
    if (value.plannedMin <= 0 || value.plannedMin > 1440 || value.remainingMs > 86400000 || value.endAt != null && (typeof value.endAt !== 'number' || !Number.isFinite(value.endAt))) return {};
    if (value.status === 'running' && value.endAt == null) return {};
    if (value.taskId != null && typeof value.taskId !== 'string' || value.sessionId != null && typeof value.sessionId !== 'string' || value.startedAt != null && (typeof value.startedAt !== 'number' || !Number.isFinite(value.startedAt))) return {};
    if (legacy) { sessionStorage.setItem(key(), JSON.stringify(value)); sessionStorage.removeItem('cortex-timer'); }
    return value;
  } catch { return {}; }
}
function mirror(): void {
  if (!owner) return;
  const state = useTimer.getState();
  const value = Object.fromEntries(Object.keys(defaults).map((field) => [field, state[field as keyof Mirror]]));
  try { sessionStorage.setItem(key(), JSON.stringify(value)); } catch { /* storage may be unavailable */ }
}
function title() {
  if (typeof document === 'undefined') return;
  const state = useTimer.getState();
  const seconds = remainingSec(state);
  document.title = state.status === 'running' ? `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')} ▶ Cortex` : 'Cortex';
}
function stopInterval() { if (interval) clearInterval(interval); interval = null; }
function ensureInterval() {
  if (interval) return;
  interval = setInterval(() => useTimer.getState().tick(), 500);
}
function finish(completed: boolean, fullCredit = false) {
  const state = useTimer.getState();
  if (state.status === 'idle' || !state.sessionId || !state.startedAt) return;
  const remaining = state.status === 'running' && state.endAt ? Math.max(0, state.endAt - Date.now()) : state.remainingMs;
  const actualMin = fullCredit ? state.plannedMin : Math.max(0, Math.round((state.plannedMin * 60000 - remaining) / 6000) / 10);
  const info: FinishInfo = { sessionId: state.sessionId, startedAt: state.startedAt,
    endedAt: completed && !fullCredit && state.endAt ? Math.min(Date.now(), state.endAt) : Date.now(),
    mode: state.mode, plannedMin: state.plannedMin, actualMin, completed,
    taskId: state.taskId, distractions: state.distractions };
  const cycleDone = state.cycleDone + (completed && state.mode === 'focus' ? 1 : 0);
  // Persist the finished session first. Its stable id makes crash/reload replay idempotent.
  if (state.mode === 'focus' && actualMin >= 0.1) state.onFinish(info);
  useTimer.setState({ status: 'idle', endAt: null, remainingMs: state.plannedMin * 60000, cycleDone, immersive: false, sessionId: null, startedAt: null });
  stopInterval(); mirror(); title();
  if (completed) state.onNext({ mode: state.mode, cycleDone });
  mirror(); title();
}
export const useTimer = create<TimerState>((set, get) => ({
  ...defaults, immersive: false, noise: 'off', onFinish: () => {}, onNext: () => {},
  start: ({ mode = 'focus', min, taskId }) => {
    const state = get();
    if (state.status !== 'idle') return;
    const plannedMin = min ?? (mode === 'focus' ? state.plannedMin : mode === 'short-break' ? 5 : 15);
    if (!Number.isFinite(plannedMin) || plannedMin <= 0 || plannedMin > 1440) return;
    set({ mode, status: 'running', taskId: taskId === undefined ? state.taskId : taskId, plannedMin,
      endAt: Date.now() + plannedMin * 60000, remainingMs: plannedMin * 60000, distractions: 0,
      sessionId: newId(), startedAt: Date.now() });
    ensureInterval(); mirror(); title();
  },
  pause: () => { const state = get(); if (state.status !== 'running' || !state.endAt) return; if (state.endAt <= Date.now()) return state.tick(); set({ status: 'paused', remainingMs: state.endAt - Date.now(), endAt: null }); stopInterval(); mirror(); title(); },
  resume: () => { const state = get(); if (state.status !== 'paused') return; set({ status: 'running', endAt: Date.now() + state.remainingMs }); ensureInterval(); mirror(); title(); },
  abandon: (commit = false) => {
    if (commit) finish(false);
    else { stopInterval(); set({ status: 'idle', endAt: null, remainingMs: get().plannedMin * 60000, sessionId: null, startedAt: null, immersive: false }); mirror(); title(); }
  },
  completeEarly: () => finish(true, true),
  tick: () => {
    const state = get();
    if (state.status !== 'running' || !state.endAt) return;
    const remaining = state.endAt - Date.now();
    if (remaining <= 0) { finish(true); chime(state.mode === 'focus' ? 'done' : 'break'); notify(state.mode === 'focus' ? '专注完成' : '休息结束'); }
    else { set({ remainingMs: remaining }); mirror(); title(); }
  },
  setImmersive: (immersive) => set({ immersive }), setNoise: (noise) => set({ noise }),
}));

/** Auth owns the engine, so finishing away from /focus or changing accounts is safe. */
export function bindTimer(store: CortexStore): void {
  unbindTimer();
  owner = store.userId;
  const restored = { ...defaults, ...load() };
  if (restored.status !== 'idle') {
    restored.sessionId ??= newId();
    restored.startedAt ??= (restored.endAt ?? Date.now()) - restored.plannedMin * 60000;
  }
  useTimer.setState({ ...restored, immersive: false, noise: 'off',
    onFinish: (info) => store.addFocusSession({ taskId: info.taskId, startedAt: info.startedAt, endedAt: info.endedAt,
      plannedMin: info.plannedMin, actualMin: info.actualMin, mode: info.mode, completed: info.completed, distractions: info.distractions }, info.sessionId),
    onNext: ({ mode, cycleDone }) => {
      const settings = store.getData().settings.pomodoro;
      if (mode === 'focus' && settings.autoStartBreak) {
        const long = cycleDone % settings.longEvery === 0;
        useTimer.getState().start({ mode: long ? 'long-break' : 'short-break', min: long ? settings.longBreakMin : settings.shortBreakMin });
      } else if (mode !== 'focus') useTimer.setState({ mode: 'focus', plannedMin: settings.focusMin, remainingMs: settings.focusMin * 60000 });
    },
  });
  mirror();
  if (restored.status === 'running' && restored.endAt) { ensureInterval(); useTimer.getState().tick(); }
  else title();
}
export function unbindTimer(): void {
  mirror(); stopInterval(); owner = null; hiddenAt = null;
  useTimer.setState({ ...defaults, immersive: false, noise: 'off', onFinish: () => {}, onNext: () => {} });
  title();
}
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
  const state = useTimer.getState();
  if (state.status !== 'running') return;
  if (document.hidden) hiddenAt = Date.now();
  else { if (hiddenAt && Date.now() - hiddenAt > 60000) useTimer.setState({ distractions: state.distractions + 1 }); hiddenAt = null; state.tick(); mirror(); }
});
export function remainingSec(state: Pick<TimerState, 'status' | 'endAt' | 'remainingMs'>): number {
  return Math.max(0, Math.round((state.status === 'running' && state.endAt ? state.endAt - Date.now() : state.remainingMs) / 1000));
}
