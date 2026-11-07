import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCortexData } from '@cortex/crdt';
import { addDays, calendarDaysBetween, dayKeyOf } from '@cortex/core';
import { isCalendarMonth, isDatedWindow, MAX_WINDOW_DAYS, readTaskWindow, type WindowScope } from './taskWindow';
import { workspaceCanvasWindow } from './taskFilters';

export function useTaskWindow(temporal = false) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const data = useCortexData();
  const { settings } = data;
  const [clock, setClock] = useState(0);
  useEffect(() => {
    const refresh = () => setClock((value) => value + 1);
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);
  const now = useMemo(() => new Date(), [clock, location.key]);
  const range = useMemo(() => {
    const initial = readTaskWindow(params, now, settings.weekStartsOn, temporal);
    return temporal ? workspaceCanvasWindow(data, params, now, initial) : initial;
  }, [params, data, temporal, now]);
  const setRange = useCallback((start: number, days: number) => {
    if (window.location.pathname !== '/tasks') return;
    // Suspense can retain the previous view while the next one loads. Its render-time
    // search params are stale; amend the actual BrowserRouter URL without reverting the view.
    const next = new URLSearchParams(window.location.search);
    next.set('scope', 'custom');
    next.set('from', dayKeyOf(start));
    next.set('to', dayKeyOf(addDays(start, Math.max(1, Math.min(MAX_WINDOW_DAYS, days)) - 1)));
    setParams(next, { replace: true });
  }, [setParams]);
  const setScope = (scope: WindowScope) => {
    if (scope === 'custom') { setRange(range.start, range.days); return; }
    if (window.location.pathname !== '/tasks') return;
    const next = new URLSearchParams(window.location.search);
    next.set('scope', scope);
    next.delete('from'); next.delete('to');
    setParams(next, { replace: true });
  };
  return { range, setRange, setScope, now };
}

export function TaskWindowControls({ temporal = false }: { temporal?: boolean }) {
  const [params] = useSearchParams();
  const { range, setRange, setScope } = useTaskWindow(temporal);
  const selectedScope = ['all', 'undated'].includes(params.get('scope') ?? '') ? params.get('scope')! : range.scope;
  const dated = isDatedWindow(range);
  const shift = (direction: number) => {
    if (['timeline', 'calendar'].includes(params.get('view') ?? '') && isCalendarMonth(range)) {
      const current = new Date(range.start);
      const next = new Date(current.getFullYear(), current.getMonth() + direction, 1);
      setRange(next.getTime(), new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate());
    } else setRange(addDays(range.start, direction * range.days).getTime(), range.days);
  };
  const field = 'h-8 min-w-0 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs text-foreground outline-none focus:border-[var(--accent-solid)]';
  return (
    <div aria-label="任务时间区间" className="flex min-w-0 flex-wrap items-center gap-2">
      <select aria-label="任务时间范围" value={selectedScope} onChange={(event) => setScope(event.target.value as WindowScope)} className={field}>
        <option value="today">今天</option>
        <option value="week">本周</option>
        <option value="month">本月</option>
        <option value="custom">自定义区间</option>
        <option value="all">全部时间</option>
        <option value="undated">未排期</option>
      </select>
      {dated && <>{temporal && ['all', 'undated'].includes(selectedScope) && <span className="text-[11px] text-muted">画布</span>}<div className="flex w-[330px] max-w-full items-center gap-1">
        <button aria-label="上一个时间段" title={`向前 ${range.days} 天`} onClick={() => shift(-1)} className="grid h-8 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-[var(--surface)] hover:text-foreground"><ChevronLeft size={15} /></button>
        <input aria-label="区间开始日期" type="date" value={dayKeyOf(range.start)} onChange={(event) => {
          const value = event.target.valueAsNumber;
          if (Number.isFinite(value)) setRange(new Date(`${event.target.value}T00:00:00`).getTime(), range.days);
        }} className={`${field} flex-1`} />
        <span className="shrink-0 text-xs text-muted">—</span>
        <input aria-label="区间结束日期" type="date" value={dayKeyOf(addDays(range.start, range.days - 1))} min={dayKeyOf(range.start)} max={dayKeyOf(addDays(range.start, MAX_WINDOW_DAYS - 1))} onChange={(event) => {
          if (event.target.value) setRange(range.start, calendarDaysBetween(range.start, new Date(`${event.target.value}T00:00:00`)) + 1);
        }} className={`${field} flex-1`} />
        <button aria-label="下一个时间段" title={`向后 ${range.days} 天`} onClick={() => shift(1)} className="grid h-8 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-[var(--surface)] hover:text-foreground"><ChevronRight size={15} /></button>
      </div></>}
    </div>
  );
}
