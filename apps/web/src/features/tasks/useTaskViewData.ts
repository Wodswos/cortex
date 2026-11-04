import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { activeTasks, tasksInProject } from '@cortex/core';
import { useCortexData } from '@cortex/crdt';
import { useTaskWindow } from './TaskWindowControls';
import { tasksInWindow } from './taskWindow';

/** Shared project boundary for task views; unrelated personal events stay in the global calendar. */
export function useTaskViewData(options?: { window?: boolean; ancestors?: boolean }) {
  const data = useCortexData();
  const [params] = useSearchParams();
  const projectId = params.get('project');
  const { range } = useTaskWindow();
  const currentWorkspace = range.scheduledOnly;
  const { scope, start, days } = range;
  return useMemo(() => {
    let tasks = projectId ? tasksInProject(data.tasks, projectId) : data.tasks;
    if (options?.window || currentWorkspace) tasks = tasksInWindow(activeTasks(tasks).filter((task) => task.status !== 'inbox'), options?.window ? { scope, start, days } : { scope: 'all', start, days }, options?.ancestors, currentWorkspace);
    if (projectId && options?.window && options.ancestors !== false && !tasks.some((task) => task.id === projectId)) {
      const root = data.tasks.find((task) => task.id === projectId);
      if (root) tasks = [root, ...tasks];
    }
    if (!projectId) return { ...data, tasks };
    const ids = new Set(tasks.map((task) => task.id));
    return { ...data, tasks, events: data.events.filter((event) => event.taskId && ids.has(event.taskId)) };
  }, [data, projectId, currentWorkspace, options?.window, options?.ancestors, scope, start, days]);
}
