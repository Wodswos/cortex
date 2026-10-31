import React, { useMemo, useState } from 'react';
import { cn } from '@cortex/ui';
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
  const data = useTaskViewData();
  const store = useCortex();
  const selectTask = useUI((s) => s.selectTask);
  const [dropDay, setDropDay] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const first = startOfWeek(new Date(date.getFullYear(), date.getMonth(), 1), data.settings.weekStartsOn);
  const firstKey = dayKeyOf(first);
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
        task.dueAt == null ||
        (task.status === 'done' && data.settings.completedDisplay === 'hidden')
      )
        continue;
      append(dayKeyOf(task.dueAt), {
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
        if (!task || task.dueAt == null) return;
        store.updateTask(task.id, { dueAt: addDays(task.dueAt, delta).getTime() });
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
      <div className="calendar-month">
        {days.map((day) => {
          const key = dayKeyOf(day),
            today = key === dayKeyOf(new Date());
          const entries = items.get(key) ?? [];
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
                  'mb-1 grid h-6 w-6 place-items-center rounded-full text-xs',
                  today
                    ? 'bg-[var(--accent-solid)] font-medium text-white'
                    : day.getMonth() !== date.getMonth()
                      ? 'text-muted/60'
                      : 'text-foreground',
                )}
              >
                {day.getDate()}
              </button>
              {entries.slice(0, 3).map((item) => (
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
              {entries.length > 3 && (
                <button onClick={() => onDateChange(day)} className="px-1 py-1 text-[10px] text-muted">
                  还有 {entries.length - 3} 项
                </button>
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
