import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { tasksInProject } from '@cortex/core';
import { useCortexData } from '@cortex/crdt';

/** Shared project boundary for task views; unrelated personal events stay in the global calendar. */
export function useTaskViewData() {
  const data = useCortexData();
  const [params] = useSearchParams();
  const projectId = params.get('project');
  return useMemo(() => {
    if (!projectId) return data;
    const tasks = tasksInProject(data.tasks, projectId);
    const ids = new Set(tasks.map((task) => task.id));
    return { ...data, tasks, events: data.events.filter((event) => event.taskId && ids.has(event.taskId)) };
  }, [data, projectId]);
}
