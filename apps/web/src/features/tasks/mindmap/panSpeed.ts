import { useCallback, useEffect, useState } from 'react';

export const DEFAULT_PAN_SPEED = 1;
export const MIN_PAN_SPEED = 0.5;
export const MAX_PAN_SPEED = 3;
const keyFor = (userId: string) => `cortex:mindmap-pan-speed:v1:${encodeURIComponent(userId)}`;
const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= MIN_PAN_SPEED && value <= MAX_PAN_SPEED;
function read(userId: string): number {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(keyFor(userId)) ?? 'null');
    return valid(value) ? value : DEFAULT_PAN_SPEED;
  } catch { return DEFAULT_PAN_SPEED; }
}

/** Pointer feel is device-specific; keep it local and separate from synced task edits. */
export function usePanSpeed(userId: string) {
  const [speed, setSpeed] = useState(() => read(userId));
  useEffect(() => {
    setSpeed(read(userId));
    const changed = (event: StorageEvent) => { if (event.key === keyFor(userId) || event.key === null) setSpeed(read(userId)); };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [userId]);
  const change = useCallback((value: number) => {
    if (!valid(value)) return;
    setSpeed(value);
    try { localStorage.setItem(keyFor(userId), JSON.stringify(value)); } catch { /* Still usable when local storage is unavailable. */ }
  }, [userId]);
  return [speed, change] as const;
}
