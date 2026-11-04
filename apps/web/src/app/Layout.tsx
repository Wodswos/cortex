import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import {
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
  Menu,
  Check,
  BookOpen,
  Trash2,
} from 'lucide-react';
import { cn } from '@cortex/ui';
import { activeTasks, inboxTasks, isProject, savedViewHref, sortSiblings } from '@cortex/core';
import { useCortex, useCortexData } from '@cortex/crdt';
import { useAuth } from './auth';
import { useUI } from '../state/ui';
import { useTimer } from '../focus/timer';
import { CommandPalette } from './CommandPalette';
import { QuickCapture } from '../shared/QuickCapture';
import { TaskSheet } from '../shared/TaskSheet';
import { TaskMenu } from '../shared/TaskMenu';
import { TaskDeletionDialog } from '../shared/TaskDeletionDialog';
import { isComposing } from '../shared/ime';
import { ProjectList } from './ProjectList';
import { SidebarResize, useSidebarWidth } from './SidebarResize';
import { ReviewReminder } from '../features/reviews/ReviewReminder';
import { HabitReminder } from '../features/habits/HabitReminder';
import { SavedViewsNav } from '../features/tasks/savedViews/SavedViewsNav';
import { TASK_VIEWS } from '../features/tasks/viewOptions';
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
  { to: '/tasks?scope=week', label: '当前任务', icon: ListTodo },
  { to: '/inbox', label: '收集箱', icon: Inbox },
];
const tools = [
  { to: '/reviews', label: '复盘', icon: BookOpen },
  { to: '/focus', label: '专注', icon: Timer },
  { to: '/habits', label: '习惯', icon: Activity },
];

function blankSidebarSwipeTarget(target: EventTarget | null, frame: HTMLElement): boolean {
  if (!(target instanceof HTMLElement) || !target.closest('main, header')) return false;
  if (target.closest('button, a, input, textarea, select, label, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"]), [role="button"], [role="dialog"], [role="slider"], [role="separator"], [draggable="true"], [data-row], [data-habit-row], [data-inspector], [data-destructive-dialog], [data-sidebar-swipe-ignore], [data-gantt-scroll], [data-calendar-week-date], [data-calendar-event], .react-flow, .xterm, svg, canvas, img, video')) return false;
  // Text and controls retain their own selection, drag and tap behavior. Only
  // the uncovered container surface may start the navigation gesture.
  if ([...target.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())) return false;
  for (let element: HTMLElement | null = target; element && element !== frame; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (['auto', 'scroll'].includes(style.overflowX) && element.scrollWidth > element.clientWidth + 1) return false;
    if (style.touchAction === 'none' || /\bpan-(x|left|right)\b/.test(style.touchAction)) return false;
  }
  return true;
}

export function Layout() {
  const { phase, user, error } = useAuth();
  const data = useCortexData();
  const store = useCortex();
  const location = useLocation();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const sidebar = useSidebarWidth();
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
    const [path, query] = to.split('?');
    if (location.pathname !== path) return false;
    if (path !== '/tasks') return true;
    const target = new URLSearchParams(query);
    if (target.has('saved')) return params.get('saved') === target.get('saved');
    return !params.has('project') && !data.settings.savedViews.some((view) => view.id === params.get('saved'));
  };
  useEffect(() => {
    setNavigationOpen(false);
  }, [location.pathname, location.search]);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || navigationOpen || immersive || phase === 'loading') return;
    let swipe: { id: number; x: number; y: number; time: number; horizontal: boolean } | null = null;
    const cancel = () => { swipe = null; };
    const start = (event: TouchEvent) => {
      cancel();
      if (event.defaultPrevented || !window.matchMedia('(width < 48rem)').matches || event.touches.length !== 1 || !blankSidebarSwipeTarget(event.target, frame)) return;
      const touch = event.touches[0]!;
      swipe = { id: touch.identifier, x: touch.clientX, y: touch.clientY, time: performance.now(), horizontal: false };
    };
    const move = (event: TouchEvent) => {
      if (!swipe || event.touches.length !== 1) { cancel(); return; }
      const touch = event.touches[0]!;
      const dx = touch.clientX - swipe.x, dy = Math.abs(touch.clientY - swipe.y);
      if (touch.identifier !== swipe.id || dx < -12 || dy > (swipe.horizontal ? 36 : 14)) { cancel(); return; }
      if (dx > 18 && dx > dy * 2) swipe.horizontal = true;
      // Leave vertical scrolling alone. Suppress browser handling only after
      // a blank-area gesture has a clear horizontal intent.
      if (swipe.horizontal && event.cancelable) event.preventDefault();
    };
    const end = (event: TouchEvent) => {
      const current = swipe;
      cancel();
      if (!current || event.touches.length || performance.now() - current.time > 700) return;
      const touch = [...event.changedTouches].find(item => item.identifier === current.id);
      if (!touch) return;
      const dx = touch.clientX - current.x, dy = Math.abs(touch.clientY - current.y);
      if (dx < 64 || dy > 36 || dx < dy * 2) return;
      if (event.cancelable) event.preventDefault();
      setNavigationOpen(true);
    };
    frame.addEventListener('touchstart', start, { passive: true });
    frame.addEventListener('touchmove', move, { passive: false });
    frame.addEventListener('touchend', end, { passive: false });
    frame.addEventListener('touchcancel', cancel);
    return () => {
      frame.removeEventListener('touchstart', start);
      frame.removeEventListener('touchmove', move);
      frame.removeEventListener('touchend', end);
      frame.removeEventListener('touchcancel', cancel);
    };
  }, [navigationOpen, immersive, phase]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isComposing(event)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-destructive-dialog]')) return;
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
      } else if (event.key === 'Escape' && navigationOpen) setNavigationOpen(false);
      else if (event.key === 'Escape' && immersive) useTimer.getState().setImmersive(false);
    };
    const capture = () => setCapture(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('cortex:quick-capture', capture);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('cortex:quick-capture', capture);
    };
  }, [setCommand, setCapture, store, immersive, navigationOpen]);
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
    <div ref={frameRef} className="flex h-full overflow-hidden bg-[var(--background)]">
      {!immersive && (
        <>
          <button
            aria-label="关闭导航"
            tabIndex={navigationOpen ? 0 : -1}
            className={cn('workspace-navigation-backdrop fixed inset-x-0 top-0 z-40 h-[var(--app-height,100dvh)] bg-black/20 md:hidden', navigationOpen && 'workspace-navigation-backdrop-open')}
            onClick={() => setNavigationOpen(false)}
          />
          <aside
            id="workspace-sidebar"
            style={{ '--sidebar-width': `${sidebar.width}px` } as React.CSSProperties}
            className={cn(
              'workspace-sidebar flex flex-col px-3 py-5',
              navigationOpen && 'workspace-sidebar-open',
            )}
          >
            <SidebarResize width={sidebar.width} onChange={sidebar.setWidth} />
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
              <SavedViewsNav key={store.userId} />
              <ProjectList key={store.userId} projects={projects} selectedId={params.has('saved') ? null : params.get('project')} />
              <div className="workspace-section">工具</div>
              <nav aria-label="工具" className="space-y-0.5">
                {nav(tools)}
              </nav>
            </div>
            <div className="shrink-0 border-t border-[var(--border)] pt-3">
              <Link to="/trash" className="workspace-nav" aria-current={location.pathname === '/trash' ? 'page' : undefined}>
                <Trash2 />
                <span>回收站</span>
                {data.tasks.some((task) => task.deletedAt != null) && <span className="ml-auto text-xs opacity-70">{data.tasks.filter((task) => task.deletedAt != null).length}</span>}
              </Link>
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
              aria-controls="workspace-sidebar"
              aria-expanded={navigationOpen}
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
            {[...primary, ...data.settings.savedViews.slice(0, 1).map((view) => ({ to: savedViewHref(view), label: view.name, icon: TASK_VIEWS.find((item) => item.key === view.view)!.icon }))].map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className={cn(
                  'flex min-h-14 min-w-0 max-w-28 flex-col items-center justify-center gap-1 px-3 text-[10px]',
                  active(to) ? 'text-[var(--accent-solid)]' : 'text-muted',
                )}
              >
                <Icon size={18} strokeWidth={1.7} />
                <span className="max-w-full truncate">{label}</span>
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
      <TaskDeletionDialog />
      <HabitReminder key={store.userId} />
      {tmuxView && (
        <Suspense fallback={null}>
          <TmuxViewer />
        </Suspense>
      )}
    </div>
  );
}
