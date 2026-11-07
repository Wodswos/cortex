import React, { useState } from 'react';
import { BookmarkPlus } from 'lucide-react';
import { useCortexData } from '@cortex/crdt';
import { addDays, dayKeyOf, normalizeTaskView, type SavedTaskView, type TaskViewKey } from '@cortex/core';
import { SaveViewDialog } from './SaveViewDialog';
import { TASK_VIEWS } from '../viewOptions';
import { isScheduledOnlyWorkspace, readTaskWindow } from '../taskWindow';
import { readTaskFilters } from '../taskFilters';

export function SaveViewButton({ view, trigger, restoreFocus }: { view: TaskViewKey; trigger?: (open: () => void) => React.ReactNode; restoreFocus?: () => void }) {
  const data = useCortexData();
  const [initial, setInitial] = useState<SavedTaskView | null>(null);
  const open = () => {
      const params = new URLSearchParams(window.location.search);
      const current = normalizeTaskView(params.get('view')) ?? view;
      const range = readTaskWindow(params, new Date(), data.settings.weekStartsOn, false, !isScheduledOnlyWorkspace(params, data.settings));
      const filters = readTaskFilters(params);
      const scopeName = { today: '今天', week: '本周', month: '本月', all: '全局', undated: '未排期', custom: '自定义' }[range.scope];
      const project = data.tasks.find((task) => task.id === params.get('project'));
      const focusName = { current: '当前工作', doing: '进行中', overdue: '逾期', unscheduled: '重要未排期', week: '本周', all: '' }[filters.focus];
      setInitial({ id: '', name: `${project ? project.title + ' · ' : ''}${focusName || scopeName}${TASK_VIEWS.find((item) => item.key === current)!.label}`.slice(0, 60), view: current, scope: range.scope, projectId: params.get('project'), work: filters.focus, taskStatus: filters.status, taskPriority: filters.priority, taskTag: filters.tagId, ...(range.scope === 'custom' ? { from: dayKeyOf(range.start), to: dayKeyOf(addDays(range.start, range.days - 1)) } : {}) });
    };
  return <>
    {trigger ? trigger(open) : <button aria-label="保存为快捷视图" title="保存为快捷视图" onClick={open} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:bg-[var(--surface)] hover:text-foreground"><BookmarkPlus size={15} /></button>}
    {initial && <SaveViewDialog initial={initial} onClose={() => setInitial(null)} restoreFocus={restoreFocus} />}
  </>;
}
