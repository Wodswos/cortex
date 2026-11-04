import React, { lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger, Segmented, SegmentedList, SegmentedTrigger } from '@cortex/ui';
import {
  BookmarkPlus,
  Check,
  Inbox,
  Library,
  MoreHorizontal,
} from 'lucide-react';
import { useCortex, useCortexData } from '@cortex/crdt';
import { activeTasks, isProject, normalizeTaskView, workProgress } from '@cortex/core';
import { useUI } from '@/state/ui';
import { isTaskView, projectView, rememberProjectView, useProjectViewMemory } from './projectViews';
import { TaskWindowControls } from './TaskWindowControls';
import { TASK_VIEWS } from './viewOptions';
import { SaveViewButton } from './savedViews/SaveViewButton';
const ListView = lazy(() => import('./list/ListView').then((module) => ({ default: module.ListView })));
const MatrixView = lazy(() =>
  import('./matrix/MatrixView').then((module) => ({ default: module.MatrixView })),
);
const MindMapView = lazy(() =>
  import('./mindmap/MindMapView').then((module) => ({ default: module.MindMapView })),
);
const CalendarView = lazy(() =>
  import('./timeline/TimelineView').then((module) => ({ default: module.CalendarView })),
);
const GanttView = lazy(() => import('./gantt/GanttView').then((module) => ({ default: module.GanttView })));

export default function TasksPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('view');
  const scope = params.get('scope');
  const data = useCortexData();
  const store = useCortex();
  const memory = useProjectViewMemory();
  const projectId = params.get('project');
  const saved = data.settings.savedViews.find((item) => item.id === params.get('saved'));
  const project = data.tasks.find((task) => task.id === projectId && !task.deletedAt && task.status !== 'archived' && isProject(task));
  const view = normalizeTaskView(requested) ?? (
    projectId ? projectView(memory, projectId) : scope === 'week' ? 'gantt' : 'list');
  useEffect(() => {
    const unsupportedUndated = !projectId && !saved && scope === 'undated';
    const needsTimeRange = (!projectId || !!saved) && ['gantt', 'timeline'].includes(view) && !['today', 'week', 'month', 'custom'].includes(scope ?? '');
    if (isTaskView(requested) && !needsTimeRange && !unsupportedUndated) return;
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set('view', view);
      if (needsTimeRange || unsupportedUndated) { next.set('scope', 'week'); next.delete('from'); next.delete('to'); }
      return next;
    }, { replace: true });
  }, [requested, view, projectId, saved?.id, scope, setParams]);
  useEffect(() => {
    if (project && !saved) rememberProjectView(store.userId, project.id, view);
  }, [store.userId, project?.id, saved?.id, view]);
  const progress = useMemo(() => workProgress(activeTasks(data.tasks)), [data.tasks]);
  const projectProgress = project ? progress.get(project.id) : null;
  const title = saved?.name || project?.title || '当前任务';
  const display = data.settings.completedDisplay ?? 'inline-gray';
  const ui = useUI();
  const moreRef = useRef<HTMLButtonElement>(null);
  const savingView = useRef(false);

  if (projectId && !project) return (
    <div className="space-y-3 p-6 text-sm text-muted">
      <p>项目不存在或已归档。</p>
      <Link to="/tasks?scope=week" className="text-[var(--accent-solid)]">返回当前任务</Link>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <div data-task-toolbar className="flex min-h-12 shrink-0 items-center gap-1 border-b border-[var(--border)] px-3 py-1.5 md:min-h-16 md:flex-wrap md:gap-3 md:px-5 md:py-3 lg:px-7">
        <div className="flex min-w-0 shrink items-center gap-2 md:w-40 md:shrink-0">
          <h1 title={title} aria-label={title} className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight md:text-lg">
            {project && !saved ? <button className="block w-full truncate text-left" aria-label={`编辑项目 ${title}`} onClick={() => ui.selectTask(project.id)}>{title}</button> : title}
          </h1>
        </div>
        <Segmented
          className="flex shrink-0"
          value={view}
          onValueChange={(v) => {
            const next = new URLSearchParams(window.location.search);
            next.set('view', v);
            if (projectId && !saved) {
              next.delete('scope');
              next.delete('from');
              next.delete('to');
              next.delete('mindFocus');
              next.delete('root');
            }
            setParams(next, { replace: true });
          }}
        >
          <SegmentedList aria-label="任务视图" className="gap-0 md:gap-0.5">
            {TASK_VIEWS.map(({ key, label, icon: Icon }) => (
              <SegmentedTrigger
                key={key}
                value={key}
                aria-label={label}
                title={label}
                className="inline-flex h-8 w-8 items-center justify-center gap-1.5 p-0 text-xs md:w-auto md:px-3 md:text-xs"
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden md:inline">{label}</span>
              </SegmentedTrigger>
            ))}
          </SegmentedList>
        </Segmented>

        <div className="ml-auto shrink-0 md:hidden">
          <SaveViewButton key={store.userId} view={view} restoreFocus={() => moreRef.current?.focus()} trigger={(openSave) => (
          <Dropdown>
            <DropdownTrigger asChild><button ref={moreRef} aria-label="任务更多操作" title="任务更多操作" className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-[var(--surface)] hover:text-foreground"><MoreHorizontal size={17} /></button></DropdownTrigger>
            <DropdownContent align="end" collisionPadding={12} aria-label="任务更多操作" onCloseAutoFocus={(event) => {
              if (savingView.current) { event.preventDefault(); savingView.current = false; }
            }}>
              {projectProgress && projectProgress.total > 0 && <DropdownLabel>项目进度 {projectProgress.done}/{projectProgress.total}</DropdownLabel>}
              <DropdownItem role="menuitemcheckbox" aria-checked={display === 'hidden'} onSelect={() => store.updateSettings({ completedDisplay: display === 'hidden' ? 'inline-gray' : 'hidden' })}><Check size={15} className={display === 'hidden' ? '' : 'opacity-0'} />隐藏已完成</DropdownItem>
              <DropdownItem onSelect={() => { savingView.current = true; openSave(); }}><BookmarkPlus size={15} />保存为快捷视图</DropdownItem>
              {project && <DropdownItem onSelect={() => {
                const rect = moreRef.current?.getBoundingClientRect();
                if (rect) ui.openTaskMenu(project.id, rect.left, rect.bottom + 4);
              }}><MoreHorizontal size={15} />项目操作</DropdownItem>}
              <DropdownSeparator />
              <DropdownItem asChild><Link to="/gallery"><Library size={15} />模板</Link></DropdownItem>
              <DropdownItem asChild><Link to="/inbox"><Inbox size={15} />收集箱</Link></DropdownItem>
            </DropdownContent>
          </Dropdown>
          )} />
        </div>

        {/* 右上角:已完成任务展现 + Gallery 入口 */}
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <SaveViewButton key={store.userId} view={view} />
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
      <div className="shrink-0 border-b border-[var(--border)] px-3 py-1 md:px-5 md:py-2 lg:px-7"><TaskWindowControls temporal={['gantt', 'timeline'].includes(view)} /></div>
      <div className="min-h-0 flex-1">
        <Suspense
          fallback={
            <div role="status" className="p-6 text-sm text-muted">
              正在载入视图…
            </div>
          }
        >
          {view === 'list' && <ListView key={`list:${projectId ?? 'all'}`} />}
          {view === 'timeline' && <CalendarView key={`timeline:${projectId ?? 'all'}`} />}
          {view === 'gantt' && <GanttView key={`gantt:${projectId ?? 'all'}`} />}
          {view === 'matrix' && <MatrixView key={`matrix:${projectId ?? 'all'}`} />}
          {view === 'mindmap' && <MindMapView key={`mindmap:${projectId ?? 'all'}`} />}
        </Suspense>
      </div>
    </div>
  );
}
