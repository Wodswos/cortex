import React, { useMemo } from 'react';
import { cn } from '@cortex/ui';
import {
  addDays, startOfWeek, dayKeyOf, WEEKDAY_ZH, activeTasks,
} from '@cortex/core';
import { useCortexData } from '@cortex/crdt';
import { EVENT_KIND_STYLE } from '@/shared/components';

export function MonthView({ date, onDateChange }: { date: Date; onDateChange: (d: Date) => void }) {
  const data = useCortexData();
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
  const gridStart = startOfWeek(monthStart, 1);
  const days = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart]);
  const todayKey = dayKeyOf(new Date());

  const eventsByDay = useMemo(() => {
    const map = new Map<string, { total: number; done: number; items: { title: string; color: string; done: boolean }[] }>();
    for (const e of data.events) {
      if (e.deletedAt) continue;
      const key = dayKeyOf(e.start);
      const cell = map.get(key) ?? { total: 0, done: 0, items: [] };
      cell.total++;
      if (e.completed) cell.done++;
      if (cell.items.length < 3) {
        cell.items.push({ title: e.title, color: EVENT_KIND_STYLE[e.kind].color, done: !!e.completed });
      }
      map.set(key, cell);
    }
    return map;
  }, [data.events]);

  const dueByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of activeTasks(data.tasks)) {
      if (t.dueAt == null || t.status === 'done') continue;
      const key = dayKeyOf(t.dueAt);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [data.tasks]);

  return (
    <div className="h-full overflow-y-auto px-4 py-2 pb-24 md:px-6">
      <div className="mb-1 grid grid-cols-7 gap-1">
        {WEEKDAY_ZH.map((w) => (
          <div key={w} className="py-1 text-center text-[10px] font-semibold uppercase tracking-wider text-muted">
            周{w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d, i) => {
          const key = dayKeyOf(d);
          const cell = eventsByDay.get(key);
          const due = dueByDay.get(key) ?? 0;
          const inMonth = d.getMonth() === date.getMonth();
          const isToday = key === todayKey;
          const heat = cell && cell.total > 0 ? cell.done / cell.total : 0;
          const isFuture = key > todayKey;
          return (
            <button
              key={i}
              onClick={() => onDateChange(d)}
              className={cn(
                'flex min-h-[86px] flex-col gap-1 rounded-xl border p-1.5 text-left transition-all md:min-h-[104px]',
                inMonth ? 'glass' : 'opacity-35',
                isToday && 'glow-border',
                'hover:border-[var(--border-strong)]',
              )}
              style={
                inMonth && heat > 0
                  ? { background: `color-mix(in srgb, var(--success) ${Math.round(heat * 16)}%, var(--surface))` }
                  : undefined
              }
            >
              <div className="flex items-center justify-between">
                <span className={cn('text-xs font-semibold tabular', isToday && 'gradient-text')}>{d.getDate()}</span>
                {due > 0 && (
                  <span className="rounded-full bg-[var(--danger)]/15 px-1.5 text-[9px] text-[var(--danger)]">{due}</span>
                )}
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
                {cell?.items.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-1 text-[9px] leading-tight">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: item.color }} />
                    <span className={cn('truncate text-muted', item.done && 'line-through opacity-60', isFuture && '')}>{item.title}</span>
                  </div>
                ))}
                {cell && cell.total > 3 && (
                  <span className="text-[9px] text-muted/60">+{cell.total - 3} 更多</span>
                )}
              </div>
              {cell && cell.total > 0 && (
                <div className="text-[8px] text-muted/60">
                  {cell.done}/{cell.total} 完成
                </div>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-3 text-[10px] text-muted/70">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: 'color-mix(in srgb, var(--success) 16%, var(--surface))' }} />完成度热力</span>
        <span>红点数 = 当日到期任务</span>
        <span>点击任意日期 → 日视图(可拖排程)</span>
      </div>
    </div>
  );
}
