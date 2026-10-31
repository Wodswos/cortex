import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import {
  CalendarDays,
  CalendarCheck,
  CalendarRange,
  ListTodo,
  Timer,
  Activity,
  Inbox,
  Plus,
  Search,
  Settings,
  CloudOff,
  Undo2,
  Redo2,
  GitBranch,
  GanttChartSquare,
  LayoutGrid,
  Menu,
  Check,
  BookOpen,
} from 'lucide-react';
import { cn } from '@cortex/ui';
import { activeTasks, inboxTasks, isProject, sortSiblings } from '@cortex/core';
import { useCortex, useCortexData } from '@cortex/crdt';
import { useAuth } from './auth';
import { useUI } from '../state/ui';
import { useTimer } from '../focus/timer';
import { CommandPalette } from './CommandPalette';
import { QuickCapture } from '../shared/QuickCapture';
import { TaskSheet } from '../shared/TaskSheet';
import { TaskMenu } from '../shared/TaskMenu';
import { isComposing } from '../shared/ime';
import { ProjectList } from './ProjectList';
import { ReviewReminder } from '../features/reviews/ReviewReminder';
const TmuxViewer = lazy(() =>
  import('../shared/TmuxViewer').then((module) => ({ default: module.TmuxViewer })),
);

function SyncStatus() {
  const { phase, syncStatus } = useAuth();
  const label =
    phase === 'local'
      ? '本地空间'
      : syncStatus === 'online'
        ? '已同步'
        : syncStatus === 'connecting'
          ? '正在同步'
          : '离线可用';
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted" title={label}>
      {phase === 'local' ? (
        <CloudOff size={12} />
      ) : (
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            syncStatus === 'online' ? 'bg-[var(--success)]' : 'bg-[var(--border-strong)]',
          )}
        />
      )}
      {label}
    </span>
  );
}
function RunningTimer() {
  const status = useTimer((s) => s.status);
  const endAt = useTimer((s) => s.endAt);
  const remaining = useTimer((s) => s.remainingMs);
  if (status === 'idle') return null;
  const seconds = Math.max(
    0,
    Math.ceil((status === 'running' && endAt ? endAt - Date.now() : remaining) / 1000),
  );
  return (
    <Link to="/focus" className="flex items-center gap-2 text-xs text-[var(--accent-solid)]">
      <Timer size={14} />
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
    </Link>
  );
}
const primary = [
  { to: '/tasks?scope=today', label: '今天', icon: CalendarCheck },
  { to: '/tasks?scope=week&view=gantt', label: '本周', icon: CalendarRange },
  { to: '/inbox', label: '收集箱', icon: Inbox },
  { to: '/tasks', label: '全部任务', icon: ListTodo },
];
const views = [
  { to: '/tasks?view=mindmap', label: '导图', icon: GitBranch },
  { to: '/tasks?view=gantt', label: '甘特图', icon: GanttChartSquare },
  { to: '/calendar', label: '日历', icon: CalendarDays },
  { to: '/tasks?view=matrix', label: '四象限', icon: LayoutGrid },
];
const tools = [
  { to: '/reviews', label: '复盘', icon: BookOpen },
  { to: '/focus', label: '专注', icon: Timer },
  { to: '/habits', label: '习惯', icon: Activity },
];

export function Layout() {
  const { phase, user, error } = useAuth();
  const data = useCortexData();
  const store = useCortex();
  const location = useLocation();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const setCommand = useUI((s) => s.setCommand);
  const setCapture = useUI((s) => s.setQuickCapture);
  const tmuxView = useUI((s) => s.tmuxView);
  const immersive = useTimer((s) => s.immersive && s.status === 'running');
  const inboxCount = useMemo(() => inboxTasks(data.tasks).length, [data.tasks]);
  const projects = useMemo(
    () =>
      activeTasks(data.tasks)
        .filter(isProject)
        .sort(sortSiblings),
    [data.tasks],
  );
  const params = new URLSearchParams(location.search);
  const active = (to: string) => {
    const [path, query = ''] = to.split('?');
    if (location.pathname !== path) return false;
    const target = new URLSearchParams(query);
    if (path !== '/tasks') return true;
    if (target.has('scope')) return target.get('scope') === params.get('scope') && !params.has('project');
    if (target.has('view')) {
      const currentView = params.get('view') ?? (params.get('scope') === 'week' ? 'gantt' : 'list');
      return target.get('view') === currentView;
    }
    return !params.has('scope') && !params.has('project');
  };
  useEffect(() => {
    setNavigationOpen(false);
  }, [location.pathname, location.search]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isComposing(event)) return;
      const target = event.target as HTMLElement | null;
      const input = !!target?.closest('input,textarea,select,[contenteditable="true"],.xterm');
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommand(true);
      } else if (
        !input &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        ['z', 'y'].includes(event.key.toLowerCase())
      ) {
        event.preventDefault();
        if (event.shiftKey || event.key.toLowerCase() === 'y') store.redo();
        else store.undo();
      } else if (
        !input &&
        event.key.toLowerCase() === 'n' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        setCapture(true);
      } else if (event.key === 'Escape' && immersive) useTimer.getState().setImmersive(false);
    };
    const capture = () => setCapture(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('cortex:quick-capture', capture);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('cortex:quick-capture', capture);
    };
  }, [setCommand, setCapture, store, immersive]);
  if (phase === 'loading')
    return (
      <div className="grid h-full place-items-center">
        <div className="space-y-3 text-center text-sm text-muted">
          <span>{error || '正在打开工作空间…'}</span>
          {error && (
            <button className="block w-full underline" onClick={() => window.location.reload()}>
              重新载入
            </button>
          )}
        </div>
      </div>
    );

  const nav = (items: typeof primary) =>
    items.map(({ to, label, icon: Icon }) => (
      <Link key={to} to={to} className="workspace-nav" aria-current={active(to) ? 'page' : undefined}>
        <Icon />
        <span>{label}</span>
        {to === '/inbox' && inboxCount > 0 && (
          <span className="ml-auto text-xs opacity-70">{inboxCount}</span>
        )}
      </Link>
    ));
  return (
    <div className="flex h-full overflow-hidden bg-[var(--background)]">
      {!immersive && (
        <>
          {navigationOpen && (
            <button
              aria-label="关闭导航"
              className="fixed inset-0 z-40 bg-black/20 md:hidden"
              onClick={() => setNavigationOpen(false)}
            />
          )}
          <aside
            className={cn(
              'workspace-sidebar flex-col px-3 py-5',
              navigationOpen ? 'fixed top-[env(safe-area-inset-top)] bottom-[env(safe-area-inset-bottom)] left-[env(safe-area-inset-left)] z-50 flex' : 'hidden md:flex',
            )}
          >
            <Link to="/" className="mb-6 flex shrink-0 items-center gap-2.5 px-3">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--accent-solid)] text-white">
                <Check size={18} strokeWidth={2} />
              </span>
              <span className="text-[16px] font-semibold tracking-tight">Cortex</span>
            </Link>
            <button
              onClick={() => setCapture(true)}
              className="mb-4 flex h-11 shrink-0 items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--background)] px-3 text-sm font-medium text-foreground hover:bg-[var(--surface)]"
            >
              <Plus size={18} className="text-[var(--accent-solid)]" />
              添加任务<span className="ml-auto text-[10px] opacity-60">N</span>
            </button>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <nav aria-label="工作导航" className="space-y-0.5">
                {nav(primary)}
              </nav>
              <ProjectList projects={projects} selectedId={params.get('project')} />
              <div className="workspace-section">视图</div>
              <nav aria-label="视图" className="space-y-0.5">
                {nav(views)}
              </nav>
              <div className="workspace-section">工具</div>
              <nav aria-label="工具" className="space-y-0.5">
                {nav(tools)}
              </nav>
            </div>
            <div className="shrink-0 border-t border-[var(--border)] pt-3">
              <Link to="/settings" className="workspace-nav">
                <Settings />
                <span>{user?.username ?? '设置与账号'}</span>
              </Link>
              <div className="flex items-center justify-between px-3 pt-2">
                <SyncStatus />
                {!user && (
                  <Link to="/login" className="text-[11px] text-muted hover:text-foreground">
                    登录
                  </Link>
                )}
              </div>
            </div>
          </aside>
        </>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {!immersive && (
          <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--border)] px-4 lg:px-6">
            <button
              aria-label="打开导航"
              onClick={() => setNavigationOpen(true)}
              className="text-muted md:hidden"
            >
              <Menu size={20} />
            </button>
            <span className="hidden text-xs text-muted md:inline">我的工作空间</span>
            <div className="ml-auto flex items-center gap-3">
              <ReviewReminder />
              <RunningTimer />
              <button
                aria-label="搜索或执行命令"
                onClick={() => setCommand(true)}
                className="flex h-7 items-center gap-2 text-xs text-muted hover:text-foreground"
              >
                <Search size={15} />
                <span className="hidden sm:inline">搜索任务</span>
                <kbd className="hidden rounded border border-[var(--border)] px-1 text-[10px] opacity-70 sm:inline">
                  ⌘ K
                </kbd>
              </button>
              <span className="h-3 w-px bg-[var(--border)]" />
              <button
                title="撤销 (⌘Z)"
                aria-label="撤销 (⌘Z)"
                disabled={!store.canUndo()}
                onClick={() => store.undo()}
                className="text-muted disabled:opacity-30"
              >
                <Undo2 size={15} />
              </button>
              <button
                title="重做 (⌘⇧Z)"
                aria-label="重做 (⌘⇧Z)"
                disabled={!store.canRedo()}
                onClick={() => store.redo()}
                className="text-muted disabled:opacity-30"
              >
                <Redo2 size={15} />
              </button>
            </div>
          </header>
        )}
        <main className="relative min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
        {!immersive && (
          <nav
            aria-label="移动导航"
            className="flex shrink-0 justify-around border-t border-[var(--border)] bg-[var(--background)] md:hidden"
          >
            {[primary[0], primary[3], views[2], primary[2]].map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-1 px-3 text-[10px]',
                  active(to) ? 'text-[var(--accent-solid)]' : 'text-muted',
                )}
              >
                <Icon size={18} strokeWidth={1.7} />
                {label}
              </Link>
            ))}
            <button
              aria-label="快速收集"
              onClick={() => setCapture(true)}
              className="px-3 text-[var(--accent-solid)]"
            >
              <Plus size={22} />
            </button>
          </nav>
        )}
      </div>
      <QuickCapture />
      <CommandPalette />
      <TaskSheet />
      <TaskMenu />
      {tmuxView && (
        <Suspense fallback={null}>
          <TmuxViewer />
        </Suspense>
      )}
    </div>
  );
}
