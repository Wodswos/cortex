import React, { useState } from 'react';
import { BookmarkPlus } from 'lucide-react';
import { useCortexData } from '@cortex/crdt';
import { addDays, dayKeyOf, normalizeTaskView, type SavedTaskView, type TaskViewKey } from '@cortex/core';
import { SaveViewDialog } from './SaveViewDialog';
import { TASK_VIEWS } from '../viewOptions';
import { readTaskWindow } from '../taskWindow';

export function SaveViewButton({ view }: { view: TaskViewKey }) {
  const data = useCortexData();
  const [initial, setInitial] = useState<SavedTaskView | null>(null);
  return <>
    <button aria-label="保存为快捷视图" title="保存为快捷视图" onClick={() => {
      const params = new URLSearchParams(window.location.search);
      const current = normalizeTaskView(params.get('view')) ?? view;
      const range = readTaskWindow(params, new Date(), data.settings.weekStartsOn, ['gantt', 'timeline'].includes(current));
      const scopeName = { today: '今天', week: '本周', month: '本月', all: '全局', undated: '未排期', custom: '自定义' }[range.scope];
      const project = data.tasks.find((task) => task.id === params.get('project'));
      setInitial({ id: '', name: `${project ? project.title + ' · ' : ''}${scopeName}${TASK_VIEWS.find((item) => item.key === current)!.label}`.slice(0, 60), view: current, scope: range.scope, projectId: params.get('project'), ...(range.scope === 'custom' ? { from: dayKeyOf(range.start), to: dayKeyOf(addDays(range.start, range.days - 1)) } : {}) });
    }} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:bg-[var(--surface)] hover:text-foreground"><BookmarkPlus size={15} /></button>
    {initial && <SaveViewDialog initial={initial} onClose={() => setInitial(null)} />}
  </>;
}
