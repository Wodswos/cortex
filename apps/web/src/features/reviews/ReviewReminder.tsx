import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { BookOpen, X } from 'lucide-react';
import { dueReviews, reviewId } from '@cortex/core';
import { useCortex, useCortexData } from '@cortex/crdt';
import { notify } from '@cortex/platform';

export function useReviewClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = setInterval(update, 30000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => { clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, []);
  return now;
}
export function ReviewReminder() {
  const data = useCortexData();
  const store = useCortex();
  const location = useLocation();
  const now = useReviewClock();
  const [snoozes, setSnoozes] = useState<Record<string, number>>({});
  const prefix = `cortex:review-reminder:${encodeURIComponent(store.userId)}:`;
  const due = dueReviews(data.reviews, data.settings, now).find(period => {
    const key = prefix + reviewId(period);
    let until = snoozes[key] ?? 0;
    try { until = Math.max(until, Number(localStorage.getItem(key)) || 0); } catch { /* In-memory snooze remains available. */ }
    return until <= now;
  });
  const id = due ? reviewId(due) : null;
  useEffect(() => {
    if (!id || location.pathname === '/reviews') return;
    const key = `${prefix}${id}:notified`;
    try { if (localStorage.getItem(key)) return; } catch { return; }
    // Use an existing permission only; never interrupt the user with a permission dialog.
    notify(due?.kind === 'weekly' ? '留十分钟，回顾这一周' : '留三分钟，回顾今天', '打开 Cortex 的复盘，整理进展、阻碍和下一步。');
    try { localStorage.setItem(key, '1'); } catch { /* App reminder still works. */ }
  }, [prefix, id, location.pathname]);
  if (!due || location.pathname === '/reviews') return null;
  return (
    <aside aria-label="复盘提醒" className="flex shrink-0 items-center gap-1 text-xs">
      <Link aria-label="开始复盘" title={`${due.start} · ${due.kind === 'weekly' ? '周报' : '日报'}待复盘`} to={`/reviews?kind=${due.kind}&date=${due.start}`} className="flex items-center gap-1.5 rounded-md bg-[var(--surface)] px-2 py-1.5 font-medium text-[var(--accent-solid)]"><BookOpen size={13} />写{due.kind === 'weekly' ? '周报' : '日报'}</Link>
      <button aria-label="一小时后再提醒复盘" title="一小时后再提醒" className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted hover:bg-[var(--surface)]" onClick={() => {
        const key = prefix + reviewId(due), until = now + 3600000;
        setSnoozes(previous => ({ ...previous, [key]: until }));
        try { localStorage.setItem(key, String(until)); } catch { /* In-memory snooze. */ }
      }}><X size={14} /></button>
    </aside>
  );
}
