import React from 'react';
import { TimelineView } from '../tasks/timeline/TimelineView';
export default function CalendarPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-16 shrink-0 items-center border-b border-[var(--border)] px-5 lg:px-7">
        <h1 className="text-xl font-semibold tracking-tight">日历</h1>
        <span className="ml-3 text-xs text-muted">任务与日程</span>
      </header>
      <div className="min-h-0 flex-1">
        <TimelineView initialMode="month" />
      </div>
    </div>
  );
}
