import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, Dialog, DialogContent } from '@cortex/ui';
import { useCortexData } from '@cortex/crdt';
import { addDays, calendarDaysBetween, dayKeyOf } from '@cortex/core';
import { isCalendarMonth, isDatedWindow, MAX_WINDOW_DAYS, readTaskWindow, type WindowScope } from './taskWindow';

export function useTaskWindow(temporal = false) {
  const [params, setParams] = useSearchParams();
  const { settings } = useCortexData();
  const [, setClock] = useState(0);
  useEffect(() => {
    const refresh = () => setClock((value) => value + 1);
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);
  const allowUndated = !!params.get('project') || settings.savedViews.some(view => view.id === params.get('saved'));
  const range = { ...readTaskWindow(params, new Date(), settings.weekStartsOn, temporal, allowUndated), scheduledOnly: !allowUndated };
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
  return { range, setRange, setScope };
}

export function TaskWindowControls({ temporal = false }: { temporal?: boolean }) {
  const [params] = useSearchParams();
  const { range, setRange, setScope } = useTaskWindow(temporal);
  const dated = isDatedWindow(range);
  const [mobile, setMobile] = useState(() => window.matchMedia('(width < 48rem)').matches);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ from: '', to: '' });
  const scopeRef = useRef<HTMLSelectElement>(null);
  const rangeFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const query = window.matchMedia('(width < 48rem)');
    const change = () => { setMobile(query.matches); if (!query.matches) setEditing(false); };
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  const editRange = (trigger: HTMLElement) => {
    rangeFocus.current = trigger;
    setDraft({ from: dayKeyOf(range.start), to: dayKeyOf(addDays(range.start, range.days - 1)) });
    setEditing(true);
  };
  const end = addDays(range.start, range.days - 1);
  const startYear = new Date(range.start).getFullYear();
  const endYear = end.getFullYear();
  const crossYear = startYear !== endYear;
  const shortDate = (value: number | Date, year: boolean) => dayKeyOf(value).slice(year ? 2 : 5).replaceAll('-', '/');
  const startLabel = shortDate(range.start, crossYear || startYear !== new Date().getFullYear());
  const endLabel = shortDate(end, crossYear);
  const shift = (direction: number) => {
    if (['timeline', 'calendar'].includes(params.get('view') ?? '') && isCalendarMonth(range)) {
      const current = new Date(range.start);
      const next = new Date(current.getFullYear(), current.getMonth() + direction, 1);
      setRange(next.getTime(), new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate());
    } else setRange(addDays(range.start, direction * range.days).getTime(), range.days);
  };
  const field = 'h-8 min-w-0 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs text-foreground outline-none focus:border-[var(--accent-solid)]';
  return (
    <div aria-label="任务时间区间" data-task-period className="flex min-w-0 items-center gap-1.5 md:flex-wrap md:gap-2">
      <select ref={scopeRef} aria-label="任务时间范围" value={range.scope} onChange={(event) => {
        const scope = event.target.value as WindowScope;
        if (mobile && scope === 'custom') editRange(event.currentTarget);
        else setScope(scope);
      }} className={`${field} w-24 shrink-0 md:w-auto`}>
        <option value="today">今天</option>
        <option value="week">本周</option>
        <option value="month">本月</option>
        <option value="custom">{mobile ? '自选' : '自定义区间'}</option>
        {!temporal && <option value="all">{mobile ? '全部' : '全部时间'}</option>}
        {!temporal && !range.scheduledOnly && <option value="undated">未排期</option>}
      </select>
      {dated && <div className="flex min-w-0 flex-1 items-center gap-0.5 md:w-[330px] md:max-w-full md:flex-none md:gap-1">
        <button aria-label="上一个时间段" title={`向前 ${range.days} 天`} onClick={() => shift(-1)} className="grid h-8 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-[var(--surface)] hover:text-foreground"><ChevronLeft size={15} /></button>
        {mobile ? <button aria-label={`编辑日期区间：${dayKeyOf(range.start)} 至 ${dayKeyOf(end)}`} title={`${dayKeyOf(range.start)} 至 ${dayKeyOf(end)}`} onClick={(event) => editRange(event.currentTarget)} className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-1 text-[11px] tabular-nums text-foreground hover:bg-[var(--surface)]">
          {!crossYear && <CalendarDays className="h-3 w-3 shrink-0" />}
          <span className="truncate">{startLabel}{range.days > 1 && <>–{endLabel}</>}</span>
        </button> : <>
        <input aria-label="区间开始日期" type="date" value={dayKeyOf(range.start)} onChange={(event) => {
          const value = event.target.valueAsNumber;
          if (Number.isFinite(value)) setRange(new Date(`${event.target.value}T00:00:00`).getTime(), range.days);
        }} className={`${field} flex-1`} />
        <span className="shrink-0 text-xs text-muted">—</span>
        <input aria-label="区间结束日期" type="date" value={dayKeyOf(addDays(range.start, range.days - 1))} min={dayKeyOf(range.start)} max={dayKeyOf(addDays(range.start, MAX_WINDOW_DAYS - 1))} onChange={(event) => {
          if (event.target.value) setRange(range.start, calendarDaysBetween(range.start, new Date(`${event.target.value}T00:00:00`)) + 1);
        }} className={`${field} flex-1`} />
        </>}
        <button aria-label="下一个时间段" title={`向后 ${range.days} 天`} onClick={() => shift(1)} className="grid h-8 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-[var(--surface)] hover:text-foreground"><ChevronRight size={15} /></button>
      </div>}
      {mobile && editing && <Dialog open onOpenChange={setEditing}>
        <DialogContent title="选择日期区间" className="top-[16%] w-[min(92vw,360px)]" onCloseAutoFocus={(event) => {
          event.preventDefault();
          const trigger = rangeFocus.current;
          (trigger?.isConnected ? trigger : scopeRef.current)?.focus();
          rangeFocus.current = null;
        }}>
          <form onSubmit={(event) => {
            event.preventDefault();
            if (!draft.from || !draft.to || draft.to < draft.from) return;
            const start = new Date(`${draft.from}T00:00:00`).getTime();
            setRange(start, calendarDaysBetween(start, new Date(`${draft.to}T00:00:00`)) + 1);
            setEditing(false);
          }} className="space-y-4">
            <label className="block space-y-1 text-xs text-muted"><span>开始日期</span><input aria-label="区间开始日期" required type="date" value={draft.from} onChange={(event) => setDraft((current) => ({ from: event.target.value, to: current.to < event.target.value ? event.target.value : current.to }))} className="h-10 w-full min-w-0 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-base text-foreground outline-none focus:border-[var(--accent-solid)]" /></label>
            <label className="block space-y-1 text-xs text-muted"><span>结束日期</span><input aria-label="区间结束日期" required type="date" value={draft.to} min={draft.from} max={draft.from ? dayKeyOf(addDays(new Date(`${draft.from}T00:00:00`), MAX_WINDOW_DAYS - 1)) : undefined} onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))} className="h-10 w-full min-w-0 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-base text-foreground outline-none focus:border-[var(--accent-solid)]" /></label>
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setEditing(false)}>取消</Button><Button type="submit">应用日期</Button></div>
          </form>
        </DialogContent>
      </Dialog>}
    </div>
  );
}
