import React, { lazy, Suspense, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Segmented, SegmentedList, SegmentedTrigger } from '@cortex/ui';
import {
  ListTodo,
  LayoutGrid,
  GitBranch,
  CalendarRange,
  GanttChartSquare,
  Library,
  MoreHorizontal,
} from 'lucide-react';
import { useCortex, useCortexData } from '@cortex/crdt';
import { activeTasks, isProject, workProgress } from '@cortex/core';
import { useUI } from '@/state/ui';
import { isTaskView, projectView, rememberProjectView, useProjectViewMemory } from './projectViews';
const ListView = lazy(() => import('./list/ListView').then((module) => ({ default: module.ListView })));
const MatrixView = lazy(() =>
  import('./matrix/MatrixView').then((module) => ({ default: module.MatrixView })),
);
const MindMapView = lazy(() =>
  import('./mindmap/MindMapView').then((module) => ({ default: module.MindMapView })),
);
const TimelineView = lazy(() =>
  import('./timeline/TimelineView').then((module) => ({ default: module.TimelineView })),
);
const GanttView = lazy(() => import('./gantt/GanttView').then((module) => ({ default: module.GanttView })));

const VIEWS = [
  { key: 'list', label: '列表', icon: ListTodo },
  { key: 'mindmap', label: '导图', icon: GitBranch },
  { key: 'matrix', label: '四象限', icon: LayoutGrid },
  { key: 'gantt', label: '甘特图', icon: GanttChartSquare },
  { key: 'timeline', label: '时间线', icon: CalendarRange },
] as const;

export default function TasksPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('view');
  const scope = params.get('scope');
  const data = useCortexData();
  const store = useCortex();
  const memory = useProjectViewMemory();
  const projectId = params.get('project');
  const project = data.tasks.find((task) => task.id === projectId && !task.deletedAt && task.status !== 'archived' && isProject(task));
  const view = isTaskView(requested) ? requested
    : projectId ? projectView(memory, projectId)
    : scope === 'week' ? 'gantt' : 'list';
  useEffect(() => {
    if (project) rememberProjectView(store.userId, project.id, view);
  }, [store.userId, project?.id, view]);
  const progress = useMemo(() => workProgress(activeTasks(data.tasks)), [data.tasks]);
  const projectProgress = project ? progress.get(project.id) : null;
  const title = project?.title || (scope === 'today' ? '今天' : scope === 'week' ? '本周' : '全部任务');
  const display = data.settings.completedDisplay ?? 'inline-gray';
  const ui = useUI();

  if (projectId && !project) return (
    <div className="space-y-3 p-6 text-sm text-muted">
      <p>项目不存在或已归档。</p>
      <Link to="/tasks" className="text-[var(--accent-solid)]">返回全部任务</Link>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b border-[var(--border)] px-5 py-3 lg:px-7">
        <div className="flex w-full shrink-0 items-center gap-2 sm:w-40">
          <h1 title={title} aria-label={title} className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">
            {project ? <button className="block w-full truncate text-left" aria-label={`编辑项目 ${title}`} onClick={() => ui.selectTask(project.id)}>{title}</button> : title}
          </h1>
        </div>
        <Segmented
          value={view}
          onValueChange={(v) => {
            const next = new URLSearchParams(params);
            next.set('view', v);
            if (projectId) {
              next.delete('scope');
              next.delete('mindFocus');
              next.delete('root');
            }
            setParams(next, { replace: true });
          }}
        >
          <SegmentedList aria-label="任务视图">
            {VIEWS.map(({ key, label, icon: Icon }) => (
              <SegmentedTrigger
                key={key}
                value={key}
                aria-label={label}
                className="inline-flex items-center justify-center gap-1.5 px-2.5 text-xs md:px-3 md:text-xs"
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">{label}</span>
              </SegmentedTrigger>
            ))}
          </SegmentedList>
        </Segmented>

        {/* 右上角:已完成任务展现 + Gallery 入口 */}
        <div className="ml-auto flex items-center gap-2">
          {projectProgress && projectProgress.total > 0 && <span aria-label="项目进度" className="text-xs tabular-nums text-muted">{projectProgress.done}/{projectProgress.total}</span>}
          {project && <button aria-label="项目菜单" title="项目菜单" className="text-muted hover:text-foreground" onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            ui.openTaskMenu(project.id, rect.left, rect.bottom + 4);
          }}><MoreHorizontal size={16} /></button>}
          <label className="inline-flex h-8 cursor-pointer select-none items-center gap-2 rounded-md px-2 text-xs text-muted hover:text-foreground">
            <input
              type="checkbox"
              checked={display === 'hidden'}
              onChange={(event) => store.updateSettings({ completedDisplay: event.target.checked ? 'hidden' : 'inline-gray' })}
              className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent-solid)]"
            />
            隐藏已完成
          </label>
          <Link
            to="/gallery"
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted transition-colors hover:text-foreground"
            title="Gallery 精选路线图"
          >
            <Library className="h-3.5 w-3.5" /> 模板
          </Link>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <Suspense
          fallback={
            <div role="status" className="p-6 text-sm text-muted">
              正在载入视图…
            </div>
          }
        >
          {view === 'list' && <ListView key={`list:${projectId ?? scope ?? 'all'}`} />}
          {view === 'timeline' && <TimelineView key={`timeline:${projectId ?? 'all'}`} initialMode={projectId ? 'week' : 'day'} />}
          {view === 'gantt' && <GanttView key={`gantt:${projectId ?? 'all'}`} />}
          {view === 'matrix' && <MatrixView key={`matrix:${projectId ?? 'all'}`} />}
          {view === 'mindmap' && <MindMapView key={`mindmap:${projectId ?? 'all'}`} />}
        </Suspense>
      </div>
    </div>
  );
}
