import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { SlidersHorizontal } from 'lucide-react';
import { cn } from '@cortex/ui';
import { useCortexData } from '@cortex/crdt';
import { readTaskFilters, TASK_STATUSES, TASK_PRIORITIES } from './taskFilters';
import { useTaskWindow } from './TaskWindowControls';

export function TaskFilterControls() {
  const [params, setParams] = useSearchParams();
  const filters = readTaskFilters(params);
  const { range } = useTaskWindow();
  const selected = filters.focus === 'current' ? 'current' : filters.focus === 'overdue' ? 'overdue' : filters.focus === 'week' || filters.focus === 'all' && range.scope === 'week' ? 'week' : filters.focus === 'all' && range.scope === 'all' ? 'all' : null;
  const presets = [
    ['all', '全部', '全部任务，不限制日期或工作状态'],
    ['current', '当前工作', '所有手动标为进行中的任务，以及所有未完成的逾期任务'],
    ['week', '本周', '本周有开始、截止或关联日程的任务'],
    ['overdue', '逾期', '截止时间已过且尚未完成的任务'],
  ] as const;
  return <div role="region" aria-label="工作概览" className="flex shrink-0 items-center gap-1 text-xs">{presets.map(([key, label, hint]) => <button key={key} type="button" aria-pressed={selected === key} title={hint} onClick={() => {
    const next = new URLSearchParams(window.location.search);
    next.set('work', key === 'week' ? 'all' : key);
    next.set('scope', key === 'week' ? 'week' : 'all');
    next.delete('from'); next.delete('to'); next.delete('mindFocus');
    // A preset is a fresh starting point; avoid hidden contradictory conditions.
    next.delete('taskStatus'); next.delete('taskPriority'); next.delete('taskTag');
    setParams(next, { replace: true });
  }} className={cn('h-8 shrink-0 whitespace-nowrap rounded-md px-2.5 transition-colors', selected === key ? 'bg-[var(--selection)] font-medium text-[var(--accent-solid)]' : 'text-muted hover:bg-[var(--surface)] hover:text-foreground')}>{label}</button>)}</div>;
}

export function MoreTaskFilters() {
  const [params, setParams] = useSearchParams();
  const data = useCortexData();
  const filters = readTaskFilters(params);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 0 });
  const count = Number(filters.status !== 'all') + Number(filters.priority !== 'all') + Number(!!filters.tagId);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!(event.target instanceof Node) || !ref.current?.contains(event.target)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); ref.current?.querySelector('button')?.focus(); } };
    const resize = () => setOpen(false);
    window.addEventListener('pointerdown', outside, true); window.addEventListener('keydown', escape, true); window.addEventListener('resize', resize);
    return () => { window.removeEventListener('pointerdown', outside, true); window.removeEventListener('keydown', escape, true); window.removeEventListener('resize', resize); };
  }, [open]);
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(window.location.search);
    if (value && value !== 'all') next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  const field = 'h-8 w-full min-w-0 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs';
  const statusLabels = { all: '全部状态', unfinished: '未完成', todo: '待办', doing: '进行中', done: '已完成' };
  return <div ref={ref} className="relative shrink-0">
    <button type="button" aria-label="更多任务筛选" aria-expanded={open} onClick={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      setPosition({ left: Math.max(12, Math.min(rect.right - 240, window.innerWidth - 252)), top: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 300)) });
      setOpen(value => !value);
    }} className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs', count ? 'bg-[var(--selection)] text-[var(--accent-solid)]' : 'text-muted hover:bg-[var(--surface)] hover:text-foreground')}><SlidersHorizontal size={13} />筛选{count > 0 && <span className="tabular-nums">{count}</span>}</button>
    {open && <div role="dialog" aria-label="更多任务筛选" style={position} className="fixed z-40 max-h-[calc(100dvh-24px)] w-60 max-w-[calc(100vw-24px)] space-y-3 overflow-y-auto rounded-xl border border-[var(--border-strong)] bg-[var(--background)] p-3 shadow-lg">
      <label className="block space-y-1 text-xs"><span className="text-muted">状态</span><select aria-label="筛选任务状态" className={field} value={filters.status} onChange={event => change('taskStatus', event.target.value)}>{TASK_STATUSES.map(value => <option key={value} value={value}>{statusLabels[value]}</option>)}</select></label>
      <label className="block space-y-1 text-xs"><span className="text-muted">优先级</span><select aria-label="筛选任务优先级" className={field} value={filters.priority} onChange={event => change('taskPriority', event.target.value)}>{TASK_PRIORITIES.map(value => <option key={value} value={value}>{value === 'all' ? '全部优先级' : value === 'high' ? '高优先级 · P0 / P1' : value}</option>)}</select></label>
      <label className="block space-y-1 text-xs"><span className="text-muted">标签</span><select aria-label="筛选任务标签" className={field} value={filters.tagId ?? ''} onChange={event => change('taskTag', event.target.value)}><option value="">全部标签</option>{data.tags.filter(tag => !tag.deletedAt).map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}{filters.tagId && !data.tags.some(tag => tag.id === filters.tagId && !tag.deletedAt) && <option value={filters.tagId}>已移除的标签</option>}</select></label>
      {count > 0 && <button type="button" className="text-xs text-muted hover:text-foreground" onClick={() => {
        const next = new URLSearchParams(params); next.delete('taskStatus'); next.delete('taskPriority'); next.delete('taskTag'); setParams(next, { replace: true });
      }}>清除额外条件</button>}
    </div>}
  </div>;
}
