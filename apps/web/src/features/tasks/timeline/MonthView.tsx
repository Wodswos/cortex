import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { cn, Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from '@cortex/ui';
import { activeTasks, addDays, startOfWeek, dayKeyOf, WEEKDAY_ZH, isStructural, calendarDaysBetween } from '@cortex/core';
import { useCortex } from '@cortex/crdt';
import { useTaskViewData } from '../useTaskViewData';
import { useUI } from '@/state/ui';
import { EVENT_KIND_STYLE } from '@/shared/components';

type CalendarItem = { id: string; type: 'task' | 'event'; title: string; done: boolean; color: string };
export function MonthView({
  date,
  onDateChange,
  onCreateTask,
}: {
  date: Date;
  onDateChange: (d: Date) => void;
  onCreateTask?: (dueAt: number, event: React.MouseEvent) => void;
}) {
  const data = useTaskViewData({ ancestors: false });
  const store = useCortex();
  const selectTask = useUI((s) => s.selectTask);
  const [dropDay, setDropDay] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const openingTask = useRef(false);
  const grid = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState({ full: 3, overflow: 2 });
  const first = startOfWeek(new Date(date.getFullYear(), date.getMonth(), 1), data.settings.weekStartsOn);
  const firstKey = dayKeyOf(first);
  useEffect(() => setExpandedDay(null), [firstKey]);
  useLayoutEffect(() => {
    const element = grid.current;
    if (!element) return;
    const measure = () => {
      const cell = element.querySelector<HTMLElement>('[data-calendar-date]');
      if (!cell) return;
      const style = getComputedStyle(cell);
      const metric = (name: string) => parseFloat(style.getPropertyValue(`--calendar-${name}`));
      const available = cell.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - metric('date-size') - metric('date-gap');
      const step = metric('entry-height') + metric('entry-gap');
      const full = Math.max(0, Math.floor(available / step));
      const overflow = Math.max(0, Math.floor((available - metric('more-height')) / step));
      setCapacity(previous => previous.full === full && previous.overflow === overflow ? previous : { full, overflow });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const days = useMemo(
    () => Array.from({ length: 42 }, (_, i) => addDays(new Date(`${firstKey}T00:00:00`), i)),
    [firstKey],
  );
  const weekdayLabels =
    data.settings.weekStartsOn === 0 ? [WEEKDAY_ZH[6], ...WEEKDAY_ZH.slice(0, 6)] : WEEKDAY_ZH;
  const items = useMemo(() => {
    const result = new Map<string, CalendarItem[]>();
    const append = (key: string, item: CalendarItem) => result.set(key, [...(result.get(key) ?? []), item]);
    for (const event of data.events) {
      if (event.deletedAt) continue;
      for (const day of days)
        if (event.start < addDays(day, 1).getTime() && event.end > day.getTime())
          append(dayKeyOf(day), {
            id: event.id,
            type: 'event',
            title: event.title,
            done: !!event.completed,
            color: EVENT_KIND_STYLE[event.kind].color,
          });
    }
    for (const task of activeTasks(data.tasks)) {
      if (
        task.deletedAt ||
        task.status === 'archived' ||
        task.status === 'inbox' ||
        isStructural(task) ||
        task.dueAt == null && task.startAt == null ||
        (task.status === 'done' && data.settings.completedDisplay === 'hidden')
      )
        continue;
      append(dayKeyOf((task.dueAt ?? task.startAt)!), {
        id: task.id,
        type: 'task',
        title: task.title || '未命名任务',
        done: task.status === 'done',
        color: 'var(--accent-solid)',
      });
    }
    return result;
  }, [data.tasks, data.events, data.settings.completedDisplay, days]);
  const move = (event: React.DragEvent, target: Date) => {
    event.preventDefault();
    setDropDay(null);
    try {
      const payload = JSON.parse(event.dataTransfer.getData('application/x-cortex-calendar')) as {
        id?: string;
        type?: string;
        day?: string;
      };
      if (!payload.id || !payload.day || !/^\d{4}-\d{2}-\d{2}$/.test(payload.day)) return;
      const delta = calendarDaysBetween(new Date(`${payload.day}T00:00:00`), target);
      if (!Number.isFinite(delta) || !delta) return;
      if (payload.type === 'task') {
        const task = data.tasks.find((t) => t.id === payload.id);
        if (!task) return;
        if (task.dueAt != null) store.updateTask(task.id, { dueAt: addDays(task.dueAt, delta).getTime() });
        else if (task.startAt != null) store.updateTask(task.id, { startAt: addDays(task.startAt, delta).getTime() });
      } else if (payload.type === 'event') {
        const item = data.events.find((e) => e.id === payload.id);
        if (!item) return;
        const start = addDays(item.start, delta).getTime();
        store.updateEvent(item.id, { start, end: start + item.end - item.start });
      } else return;
      setMessage(`已移至 ${target.getMonth() + 1} 月 ${target.getDate()} 日`);
    } catch {
      setMessage('无法移动此项目，请在详情中调整日期');
    }
  };
  return (
    <div className="flex h-full flex-col overflow-y-auto" data-testid="calendar-month">
      <div className="grid shrink-0 grid-cols-7 border-y border-[var(--calendar-grid)]">
        {weekdayLabels.map((label) => (
          <div key={label} className="px-2 py-2 text-center text-[11px] text-muted">
            周{label}
          </div>
        ))}
      </div>
      <div ref={grid} className="calendar-month">
        {days.map((day) => {
          const key = dayKeyOf(day),
            today = key === dayKeyOf(new Date());
          const entries = items.get(key) ?? [];
          const visibleCount = entries.length > capacity.full ? capacity.overflow : capacity.full;
          return (
            <div
              key={key}
              data-calendar-date={key}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest('button')) return;
                const due = new Date(day);
                due.setHours(18, 0, 0, 0);
                onCreateTask?.(due.getTime(), event);
              }}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes('application/x-cortex-calendar')) {
                  event.preventDefault();
                  setDropDay(key);
                }
              }}
              onDragLeave={() => setDropDay((old) => (old === key ? null : old))}
              onDrop={(event) => move(event, day)}
              className={cn(
                'calendar-cell',
                day.getMonth() !== date.getMonth() && 'bg-[var(--surface)]/50',
                dropDay === key && 'bg-[var(--selection)]',
              )}
            >
              <button
                aria-label={`${key}，查看日程`}
                onClick={() => onDateChange(day)}
                className={cn(
                  'calendar-date grid place-items-center rounded-full text-[11px]',
                  today
                    ? 'bg-[var(--accent-solid)] font-medium text-white'
                    : day.getMonth() !== date.getMonth()
                      ? 'text-muted/60'
                      : 'text-foreground',
                )}
              >
                {day.getDate()}
              </button>
              {entries.slice(0, visibleCount).map((item) => (
                <button
                  key={`${item.type}:${item.id}`}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(
                      'application/x-cortex-calendar',
                      JSON.stringify({ id: item.id, type: item.type, day: key }),
                    );
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => setDropDay(null)}
                  onClick={() => {
                    if (item.type === 'task') selectTask(item.id);
                    else onDateChange(day);
                  }}
                  className={cn('calendar-item', item.done && 'text-muted line-through')}
                  title={`${item.type === 'task' ? '到期任务' : '日程'} · ${item.title}`}
                  style={
                    item.type === 'event'
                      ? { background: `color-mix(in srgb, ${item.color} 9%, transparent)` }
                      : undefined
                  }
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 shrink-0',
                      item.type === 'task' ? 'rounded-full' : 'rounded-sm',
                    )}
                    style={{ background: item.done ? 'var(--muted-foreground)' : item.color }}
                  />
                  <span className="truncate">{item.title}</span>
                </button>
              ))}
              {entries.length > visibleCount && (
                <Dropdown open={expandedDay === key} onOpenChange={open => { if (open) openingTask.current = false; setExpandedDay(open ? key : null); }}>
                  <DropdownTrigger asChild>
                    <button type="button" aria-label={`${key}，还有 ${entries.length - visibleCount} 项`} className="calendar-more max-w-full truncate rounded px-1 text-left text-[10px] text-muted hover:bg-[var(--selection)] hover:text-foreground">
                      还有 {entries.length - visibleCount} 项
                    </button>
                  </DropdownTrigger>
                  <DropdownContent
                    aria-label={`${key} 的全部项目`}
                    aria-labelledby={undefined}
                    align="start"
                    collisionPadding={12}
                    className="flex max-h-[min(420px,var(--radix-dropdown-menu-content-available-height),calc(100dvh-24px))] w-[min(360px,calc(100vw-24px))] flex-col overflow-hidden p-0"
                    onClick={event => event.stopPropagation()}
                    onCloseAutoFocus={event => { if (openingTask.current) event.preventDefault(); openingTask.current = false; }}
                  >
                    <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2.5">
                      <span className="text-sm font-medium">{day.getMonth() + 1} 月 {day.getDate()} 日 · 周{WEEKDAY_ZH[(day.getDay() + 6) % 7]}</span>
                      <span className="text-xs text-muted">共 {entries.length} 项</span>
                      <button type="button" aria-label="关闭当日项目列表" onClick={() => setExpandedDay(null)} className="ml-auto rounded p-1 text-muted hover:bg-[var(--surface)] hover:text-foreground"><X size={14} /></button>
                    </div>
                    <div data-calendar-day-items className="min-h-0 overflow-y-auto overscroll-contain p-1.5">
                      {entries.map(item => <DropdownItem key={`${item.type}:${item.id}`} textValue={item.title} aria-label={`${item.title} ${item.type === 'task' ? '任务' : '日程'}${item.done ? ' · 已完成' : ''}`} className="items-start gap-2 py-1.5" onSelect={() => {
                        if (item.type === 'task') { openingTask.current = true; selectTask(item.id); }
                        else onDateChange(day);
                      }}>
                        <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0', item.type === 'task' ? 'rounded-full' : 'rounded-sm')} style={{ background: item.done ? 'var(--muted-foreground)' : item.color }} />
                        <span className={cn('min-w-0 flex-1 break-words text-[13px] leading-5', item.done && 'text-muted line-through')}>{item.title}</span>
                        <span className="mt-0.5 shrink-0 text-[10px] leading-4 text-muted">{item.type === 'task' ? '任务' : '日程'}{item.done ? ' · 已完成' : ''}</span>
                      </DropdownItem>)}
                    </div>
                  </DropdownContent>
                </Dropdown>
              )}
            </div>
          );
        })}
      </div>
      <div
        role="status"
        aria-label="日历操作状态"
        aria-live="polite"
        className="flex min-h-9 shrink-0 items-center border-t border-[var(--border)] px-4 text-[11px] text-muted"
      >
        {message || '点击空白处新建任务 · 拖动可改期 · 点击日期数字查看当日日程'}
      </div>
    </div>
  );
}
