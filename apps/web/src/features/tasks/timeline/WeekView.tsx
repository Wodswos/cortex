import React, { useMemo } from 'react';
import { Clock } from 'lucide-react';
import { cn } from '@cortex/ui';
import { addDays, startOfWeek, dayKeyOf, minutesOfDay, fmtHM, WEEKDAY_ZH, weekdayOf, activeTasks, isStructural } from '@cortex/core';
import { useCortexData } from '@cortex/crdt';
import { useUI } from '@/state/ui';
import { EVENT_KIND_STYLE } from '@/shared/components';

const PX_PER_HOUR = 44;

export function WeekView({ date, onDateChange }: { date: Date; onDateChange: (d: Date) => void }) {
  const data = useCortexData();
  const ui = useUI();
  const weekStart = startOfWeek(date, 1);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const todayKey = dayKeyOf(new Date());
  const nowMin = minutesOfDay(new Date());

  /** 本周各日的到期任务(任意层级),以虚线 ⏰ 块标在截止时刻 */
  const dueByDay = useMemo(() => {
    const map = new Map<string, typeof data.tasks>();
    for (const t of activeTasks(data.tasks)) {
      if (t.status === 'inbox' || t.status === 'done' || t.dueAt == null || isStructural(t)) continue; // 结构节点不排期
      const arr = map.get(dayKeyOf(t.dueAt)) ?? [];
      arr.push(t);
      map.set(dayKeyOf(t.dueAt), arr);
    }
    return map;
  }, [data.tasks]);

  return (
    <div className="h-full overflow-y-auto px-4 pb-24 md:px-6">
      <div className="flex min-w-[640px]">
        {/* 时刻度 */}
        <div className="w-10 shrink-0 pt-9">
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="relative text-right pr-1.5 text-[9px] text-muted/70 tabular" style={{ height: PX_PER_HOUR }}>
              <span className="absolute -top-1.5 right-1.5">{h > 0 ? `${String(h).padStart(2, '0')}:00` : ''}</span>
            </div>
          ))}
        </div>
        {days.map((d, i) => {
          const dayStart = d.getTime();
          const dayEnd = addDays(d, 1).getTime();
          const dayMinutes = (dayEnd - dayStart) / 60000;
          const events = data.events.filter((e) => !e.deletedAt && e.start < dayEnd && e.end > dayStart);
          const isToday = dayKeyOf(d) === todayKey;
          return (
            <div key={i} className="min-w-0 flex-1 px-0.5">
              <button
                onClick={() => onDateChange(d)}
                className={cn(
                  'mb-1 flex w-full flex-col items-center rounded-lg py-1.5 transition-colors',
                  isToday ? 'gradient-bg text-white' : 'text-muted hover:text-foreground',
                )}
              >
                <span className="text-[10px]">周{WEEKDAY_ZH[weekdayOf(d) - 1]}</span>
                <span className="text-sm font-semibold tabular">{d.getDate()}</span>
              </button>
              <div className="relative rounded-lg border border-[var(--border)] bg-[var(--surface)]" style={{ height: dayMinutes / 60 * PX_PER_HOUR }}>
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="absolute inset-x-0 border-t border-[var(--border)]/60" style={{ top: (h * 60 / 60) * PX_PER_HOUR }} />
                ))}
                {isToday && (
                  <div className="absolute inset-x-0 z-10 h-[2px] bg-gradient-to-r from-[var(--accent-from)] to-transparent animate-pulse-line" style={{ top: ((Date.now() - dayStart) / 3600000) * PX_PER_HOUR }} />
                )}
                {events.map((e) => {
                  const startMin = Math.max(0, (e.start - dayStart) / 60000);
                  const endMin = Math.min(dayMinutes, (e.end - dayStart) / 60000);
                  const style = EVENT_KIND_STYLE[e.kind];
                  return (
                    <div
                      key={e.id}
                      className="absolute inset-x-0.5 overflow-hidden rounded border px-1 py-0.5 text-[9px] leading-tight"
                      style={{
                        top: (startMin / 60) * PX_PER_HOUR,
                        height: Math.max(14, ((endMin - startMin) / 60) * PX_PER_HOUR),
                        background: style.dim,
                        borderColor: `${style.color}55`,
                        color: style.color,
                        opacity: e.completed ? 0.5 : 1,
                        textDecoration: e.completed ? 'line-through' : undefined,
                      }}
                      title={`${e.title} ${fmtHM(e.start)}`}
                    >
                      <div className="truncate">{e.title}</div>
                    </div>
                  );
                })}
                {(dueByDay.get(dayKeyOf(d)) ?? []).map((t) => {
                  const m = (t.dueAt! - dayStart) / 60000;
                  if (m < 0 || m >= 1440) return null;
                  return (
                    <button
                      key={t.id}
                      onClick={() => ui.selectTask(t.id)}
                      className="absolute inset-x-0.5 z-[5] flex items-center gap-1 overflow-hidden rounded border border-dashed px-1 text-left"
                      style={{
                        top: (m / 60) * PX_PER_HOUR - 8,
                        height: 16,
                        borderColor: 'color-mix(in srgb, var(--danger) 55%, transparent)',
                        background: 'color-mix(in srgb, var(--danger) 8%, transparent)',
                      }}
                      title={`截止:${fmtHM(t.dueAt!)} · ${t.title || 'Untitled'}`}
                    >
                      <Clock className="h-2.5 w-2.5 shrink-0 text-[var(--danger)]" />
                      <span className="truncate text-[9px] font-medium">{t.title || 'Untitled'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
