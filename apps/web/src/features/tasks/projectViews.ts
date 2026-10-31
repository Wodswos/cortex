import { useSyncExternalStore } from 'react';
import { useCortex } from '@cortex/crdt';

export const TASK_VIEW_KEYS = ['list', 'mindmap', 'matrix', 'gantt', 'timeline'] as const;
export type TaskViewKey = (typeof TASK_VIEW_KEYS)[number];
export const isTaskView = (value: unknown): value is TaskViewKey =>
  TASK_VIEW_KEYS.includes(value as TaskViewKey);

type Preferences = { projects: Record<string, TaskViewKey> };
const cache = new Map<string, Preferences>();
const listeners = new Set<() => void>();
const prefix = 'cortex:project-views:';
const keyOf = (userId: string) => prefix + encodeURIComponent(userId);

function read(userId: string): Preferences {
  const cached = cache.get(userId);
  if (cached) return cached;
  let value: Preferences = { projects: {} };
  try {
    const raw = JSON.parse(localStorage.getItem(keyOf(userId)) ?? 'null');
    if (raw && typeof raw === 'object') {
      value = {
        projects: Object.fromEntries(Object.entries(raw.projects ?? {}).filter(([, view]) => isTaskView(view))) as Preferences['projects'],
      };
    }
  } catch { /* View preferences must never prevent opening a project. */ }
  cache.set(userId, value);
  return value;
}

export function projectView(memory: Preferences, id: string): TaskViewKey {
  return Object.hasOwn(memory.projects, id) ? memory.projects[id]! : 'list';
}

export function rememberProjectView(userId: string, id: string, view: TaskViewKey): void {
  const previous = read(userId);
  if (Object.hasOwn(previous.projects, id) && previous.projects[id] === view) return;
  const next = { projects: { ...previous.projects, [id]: view } };
  cache.set(userId, next);
  try { localStorage.setItem(keyOf(userId), JSON.stringify(next)); } catch { /* Retain in memory. */ }
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

if (typeof window !== 'undefined') window.addEventListener('storage', (event) => {
  if (event.key !== null && !event.key.startsWith(prefix)) return;
  for (const userId of cache.keys()) if (event.key === null || event.key === keyOf(userId)) cache.delete(userId);
  for (const listener of listeners) listener();
});

/** Presentation preferences are local to the current account and never enter task undo history. */
export function useProjectViewMemory(): Preferences {
  const { userId } = useCortex();
  return useSyncExternalStore(subscribe, () => read(userId));
}
