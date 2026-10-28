import { addMonths } from 'date-fns';
import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Segmented, SegmentedList, SegmentedTrigger, Button } from '@cortex/ui';
import { addDays, dayKeyOf, WEEKDAY_ZH, weekdayOf } from '@cortex/core';
import { DayView } from './DayView';
import { WeekView } from './WeekView';
import { MonthView } from './MonthView';
import { CalendarTaskDraft, type TaskDraftAnchor } from './CalendarTaskDraft';

type Mode = 'day' | 'week' | 'month';

export function TimelineView({ initialMode = 'day' }: { initialMode?: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [date, setDate] = useState(() => new Date());
  const [taskDraft, setTaskDraft] = useState<TaskDraftAnchor | null>(null);
  const openTaskDraft = (dueAt: number, event: { clientX: number; clientY: number }) => {
    setTaskDraft({ dueAt, x: event.clientX, y: event.clientY });
  };

  const today = new Date();
  const isToday = dayKeyOf(date) === dayKeyOf(today);

  const dateLabel = () => {
    const d = date;
    if (mode === 'month') return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
    const base = `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${WEEKDAY_ZH[weekdayOf(d) - 1]}`;
    return `${base} · ${isToday ? '今天' : `${d.getFullYear()}`}`;
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-3 md:px-6">
        <Segmented value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <SegmentedList>
            <SegmentedTrigger value="day">日</SegmentedTrigger>
            <SegmentedTrigger value="week">周</SegmentedTrigger>
            <SegmentedTrigger value="month">月</SegmentedTrigger>
          </SegmentedList>
        </Segmented>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="上一个时间段"
            onClick={() =>
              setDate(mode === 'month' ? addMonths(date, -1) : addDays(date, mode === 'week' ? -7 : -1))
            }
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[150px] text-center text-sm font-medium">{dateLabel()}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="下一个时间段"
            onClick={() =>
              setDate(mode === 'month' ? addMonths(date, 1) : addDays(date, mode === 'week' ? 7 : 1))
            }
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {
            <Button variant="ghost" size="sm" onClick={() => setDate(new Date())}>
              今天
            </Button>
          }
        </div>
        <input
          type="date"
          aria-label="选择日期"
          value={`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`}
          onChange={(e) => e.target.value && setDate(new Date(`${e.target.value}T00:00:00`))}
          className="ml-auto h-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-foreground outline-none"
        />
      </div>
      <div className="min-h-0 flex-1">
        {mode === 'day' && (
          <DayView
            date={date}
            onCreateTask={openTaskDraft}
            onDateChange={(next) => {
              setDate(next);
              setMode('day');
            }}
          />
        )}
        {mode === 'week' && (
          <WeekView
            date={date}
            onCreateTask={openTaskDraft}
            onDateChange={(next) => {
              setDate(next);
              setMode('day');
            }}
          />
        )}
        {mode === 'month' && (
          <MonthView
            date={date}
            onCreateTask={openTaskDraft}
            onDateChange={(next) => {
              setDate(next);
              setMode('day');
            }}
          />
        )}
      </div>
      {taskDraft && (
        <CalendarTaskDraft
          key={`${taskDraft.dueAt}:${taskDraft.x}:${taskDraft.y}`}
          anchor={taskDraft}
          onDismiss={() => setTaskDraft(null)}
          onCreated={() => setTaskDraft(null)}
        />
      )}
    </div>
  );
}
