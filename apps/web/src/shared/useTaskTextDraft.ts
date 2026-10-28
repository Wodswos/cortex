import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { Task } from '@cortex/core';
import { useCortex } from '@cortex/crdt';

type TextField = 'title' | 'notes';
type Draft = Partial<Record<TextField, string>>;

/** Only dirty fields are written; closing a panel cannot discard its text draft. */
export function useTaskTextDraft(task: Task | null) {
  const store = useCortex();
  const pending = useRef(new Map<string, Draft>());
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const composing = useRef(false);
  const alive = useRef(false);
  const sequence = useRef(0);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const [, redraw] = useState(0);
  const [status, setStatus] = useState('');
  const id = task?.id ?? null;
  const commit = useCallback(
    (taskId: string | null, notify = true) => {
      clearTimeout(timer.current);
      if (!taskId) return saving.current;
      const patch = pending.current.get(taskId);
      if (!patch) return saving.current;
      pending.current.delete(taskId);
      const latest = store.getData().tasks.find((item) => item.id === taskId);
      if (!latest || latest.deletedAt) return saving.current;
      const changed = Object.fromEntries(
        Object.entries(patch).filter(([key, value]) => value !== (latest[key as TextField] ?? '')),
      );
      if (!Object.keys(changed).length) return saving.current;
      store.updateTask(taskId, changed);
      store.stopUndoCapture();
      const generation = ++sequence.current;
      if (notify && alive.current) setStatus('正在保存…');
      const persisted = store.flushPersistence();
      saving.current = persisted;
      void persisted.then(
        () => {
          if (notify && alive.current && generation === sequence.current) setStatus('已保存');
        },
        () => {
          if (alive.current && generation === sequence.current)
            setStatus('本地保存失败，请保留页面并从设置导出备份');
        },
      );
      return persisted;
    },
    [store],
  );
  useLayoutEffect(() => {
    alive.current = true;
    composing.current = false;
    setStatus('');
    const flush = () => commit(id);
    const hidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      alive.current = false;
      commit(id, false);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [id, commit]);
  const schedule = () => {
    clearTimeout(timer.current);
    if (!composing.current) timer.current = setTimeout(() => commit(id), 600);
  };
  return {
    status,
    value: (field: TextField) => (id ? pending.current.get(id)?.[field] : undefined) ?? task?.[field] ?? '',
    change: (field: TextField, value: string) => {
      if (!id) return;
      pending.current.set(id, { ...pending.current.get(id), [field]: value });
      sequence.current++;
      setStatus('编辑中…');
      redraw((revision) => revision + 1);
      schedule();
    },
    commit: () => commit(id),
    close: (onClose: () => void) => {
      void commit(id).then(onClose, () => {});
    },
    compositionStart: () => {
      composing.current = true;
      clearTimeout(timer.current);
    },
    compositionEnd: () => {
      composing.current = false;
      schedule();
    },
  };
}
