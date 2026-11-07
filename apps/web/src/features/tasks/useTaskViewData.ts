import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useCortexData } from '@cortex/crdt';
import { useTaskWindow } from './TaskWindowControls';
import { selectWorkspaceTasks } from './taskFilters';

/** Shared project boundary for task views; unrelated personal events stay in the global calendar. */
export function useTaskViewData(options?: { window?: boolean; ancestors?: boolean; context?: boolean }) {
  const data = useCortexData();
  const [params] = useSearchParams();
  const { range, now } = useTaskWindow();
  const { scope, start, days } = range;
  return useMemo(() => {
    const selection = selectWorkspaceTasks(data, params, now);
    const ids = options?.ancestors === false ? selection.matching : selection.context;
    // Mind maps retain the time-filtered tree and fade work/status/priority
    // mismatches, preserving the user's mental map while sharing the predicate.
    const contextParams = new URLSearchParams(params);
    contextParams.delete('work'); contextParams.delete('mindFocus'); contextParams.delete('taskStatus'); contextParams.delete('taskPriority'); contextParams.delete('taskTag');
    const mapContext = options?.context ? selectWorkspaceTasks(data, contextParams, now) : null;
    let tasks = selection.tasks.filter(task => (mapContext?.context ?? ids).has(task.id));
    if (selection.projectId && options?.ancestors !== false && !tasks.some(task => task.id === selection.projectId)) {
      const root = selection.tasks.find(task => task.id === selection.projectId);
      if (root) tasks = [root, ...tasks];
    }
    const extra = selection.filters.focus !== 'all' || selection.filters.status !== 'all' || selection.filters.priority !== 'all' || !!selection.filters.tagId;
    const events = options?.context ? selection.events : selection.events.filter(event => event.taskId ? selection.matching.has(event.taskId) : !selection.projectId && !extra);
    return { ...data, tasks, events, matchingTaskIds: selection.matching, taskFilters: selection.filters, hasTaskFilters: selection.narrowed };
  }, [data, params, options?.ancestors, options?.context, scope, start, days, now]);
}
