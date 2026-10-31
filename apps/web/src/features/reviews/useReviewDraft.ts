import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useCortex, useCortexData } from '@cortex/crdt';
import { reviewId, type Review, type ReviewPeriod } from '@cortex/core';

export type ReviewTextField = 'highlights' | 'friction' | 'nextSteps';
type Patch = Partial<Pick<Review, ReviewTextField>>;

export function useReviewDraft(period: ReviewPeriod) {
  const store = useCortex();
  const data = useCortexData();
  const id = reviewId(period);
  const review = data.reviews.find(value => value.id === id);
  const pending = useRef<Patch>({});
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const composing = useRef(false);
  const alive = useRef(false);
  const revision = useRef(0);
  const saved = useRef<Promise<void>>(Promise.resolve());
  const [status, setStatus] = useState('');
  const [, redraw] = useState(0);
  const commit = useCallback((notify = true) => {
    clearTimeout(timer.current);
    const patch = pending.current;
    if (!Object.keys(patch).length) return saved.current;
    pending.current = {};
    const latest = store.getData().reviews.find(value => value.id === id);
    const changed = Object.fromEntries(Object.entries(patch).filter(([field, value]) => value !== (latest?.[field as ReviewTextField] ?? '')));
    if (!Object.keys(changed).length) return saved.current;
    store.updateReview(period, changed);
    store.stopUndoCapture();
    const generation = ++revision.current;
    if (notify && alive.current) setStatus('正在保存…');
    const persisted = store.flushPersistence();
    saved.current = persisted;
    void persisted.then(() => {
      if (notify && alive.current && generation === revision.current) setStatus('已保存');
    }, () => {
      if (alive.current && generation === revision.current) setStatus('本地保存失败，请保留页面并导出备份');
    });
    return persisted;
  }, [store, id, period.kind, period.start, period.end]);
  useLayoutEffect(() => {
    alive.current = true;
    const flush = () => { void commit(); };
    const hidden = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      alive.current = false;
      void commit(false);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [commit]);
  const schedule = () => {
    clearTimeout(timer.current);
    if (!composing.current) timer.current = setTimeout(() => { void commit(); }, 600);
  };
  return {
    review, status,
    value: (field: ReviewTextField) => pending.current[field] ?? review?.[field] ?? '',
    change: (field: ReviewTextField, value: string) => {
      pending.current = { ...pending.current, [field]: value };
      revision.current++;
      setStatus('编辑中…');
      redraw(value => value + 1);
      schedule();
    },
    dirty: Object.keys(pending.current).length > 0,
    commit: () => commit(),
    compositionStart: () => { composing.current = true; clearTimeout(timer.current); },
    compositionEnd: () => { composing.current = false; schedule(); },
  };
}
