import React, { useState } from 'react';
import { DayView } from './DayView';
import { WeekView } from './WeekView';
import { MonthView } from './MonthView';
import { CalendarTaskDraft, type TaskDraftAnchor } from './CalendarTaskDraft';
import { useTaskWindow } from '../TaskWindowControls';
import { isCalendarMonth } from '../taskWindow';

/** The calendar is a task workspace view; the former /calendar route redirects here. */
export function CalendarView() {
  const { range, setRange } = useTaskWindow(true);
  const [taskDraft, setTaskDraft] = useState<TaskDraftAnchor | null>(null);
  const viewProps = {
    date: new Date(range.start),
    onDateChange: (next: Date) => setRange(next.getTime(), 1),
    onCreateTask: (dueAt: number, event: { clientX: number; clientY: number }) => setTaskDraft({ dueAt, x: event.clientX, y: event.clientY }),
  };
  return <div className="flex h-full flex-col">
    <div className="min-h-0 flex-1">
      {range.days === 1 ? <DayView {...viewProps} /> : isCalendarMonth(range) ? <MonthView {...viewProps} /> : <WeekView {...viewProps} rangeStart={new Date(range.start)} dayCount={range.days} />}
    </div>
    {taskDraft && <CalendarTaskDraft key={`${taskDraft.dueAt}:${taskDraft.x}:${taskDraft.y}`} anchor={taskDraft} onDismiss={() => setTaskDraft(null)} onCreated={() => setTaskDraft(null)} />}
  </div>;
}
