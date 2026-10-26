import React, { lazy, Suspense, useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, ListTodo, Timer, Activity, Inbox as InboxIcon, Plus,
  Search, Settings, ZapOff, CloudOff, User, Undo2, Redo2,
} from 'lucide-react';
import { cn } from '@cortex/ui';
import { inboxTasks } from '@cortex/core';
import { useCortex, useCortexData } from '@cortex/crdt';
import { useAuth } from './auth';
import { useUI } from '../state/ui';
import { useTimer } from '../focus/timer';
import { CommandPalette } from './CommandPalette';
import { QuickCapture } from '../shared/QuickCapture';
import { TaskSheet } from '../shared/TaskSheet';
import { TaskMenu } from '../shared/TaskMenu';
const TmuxViewer = lazy(() => import('../shared/TmuxViewer').then((module) => ({ default: module.TmuxViewer })));

/** 品牌标记:神经元突触(与 favicon.svg 一致;透明底,随 currentColor 变色) */
function CortexLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden fill="none">
      <circle cx="32" cy="32" r="4.4" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M32 24 L32 8" />
        <path d="M32 40 L32 56" />
        <path d="M40 32 L56 32" />
        <path d="M24 32 L8 32" />
        <path d="M37 27 L44 20 L47 17" />
        <path d="M37 37 L44 44 L47 47" />
        <path d="M27 37 L20 44 L17 47" />
        <path d="M27 27 L20 20 L17 17" />
      </g>
      <g fill="currentColor">
        <circle cx="32" cy="8" r="1.8" /><circle cx="32" cy="56" r="1.8" />
        <circle cx="56" cy="32" r="1.8" /><circle cx="8" cy="32" r="1.8" />
        <circle cx="47" cy="17" r="1.8" /><circle cx="47" cy="47" r="1.8" />
        <circle cx="17" cy="47" r="1.8" /><circle cx="17" cy="17" r="1.8" />
      </g>
    </svg>
  );
}

function SyncDot() {
  const { phase, syncStatus, serverReachable } = useAuth();
  if (phase === 'local') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted" title={serverReachable ? '本地模式 — 登录后开启多端同步' : '服务器不可达,本地模式'}>
        <CloudOff className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">本地</span>
      </span>
    );
  }
  const color =
    syncStatus === 'online' ? 'bg-[var(--success)]' : syncStatus === 'connecting' ? 'bg-[var(--warning)] animate-breathe' : 'bg-muted/50';
  const label = syncStatus === 'online' ? '已同步' : syncStatus === 'connecting' ? '连接中' : '离线(本地可用)';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" title={label}>
      <span className={cn('h-2 w-2 rounded-full', color)} />
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

const NAV = [
  { to: '/', icon: LayoutDashboard, label: '概览', end: true, mobile: false },
  { to: '/tasks', icon: ListTodo, label: '任务', mobile: true },
  { to: '/focus', icon: Timer, label: '专注', mobile: true },
  { to: '/habits', icon: Activity, label: '习惯', mobile: true },
  { to: '/inbox', icon: InboxIcon, label: '收集箱', mobile: true, badge: true },
];

export function Layout() {
  const { phase, user, error } = useAuth();
  const data = useCortexData();
  const store = useCortex();
  const ui = useUI();
  const timer = useTimer();
  const location = useLocation();
  const navigate = useNavigate();
  const inboxCount = inboxTasks(data.tasks).length;

  // 全局快捷键:⌘K = 命令面板,⌘Z/⌘⇧Z/⌘Y = 撤销/重做
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ui.setCommand(true);
      } else if (
        (e.metaKey || e.ctrlKey) && !e.altKey &&
        (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')
      ) {
        // 输入框/文本域内保留浏览器原生文本撤销,不抢
        const t = e.target as HTMLElement | null;
        if (t?.closest('input, textarea, select') || t?.isContentEditable) return;
        e.preventDefault();
        if (e.key.toLowerCase() === 'y' || e.shiftKey) store.redo();
        else store.undo();
      } else if (e.key === 'Escape' && timer.immersive) {
        timer.setImmersive(false);
      } else if (e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement | null;
        if (target?.closest('input, textarea, select, [contenteditable="true"], .xterm')) return;
        e.preventDefault();
        ui.setQuickCapture(true);
      }
    };
    const quickCapture = () => ui.setQuickCapture(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('cortex:quick-capture', quickCapture);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('cortex:quick-capture', quickCapture);
    };
  }, [ui, timer, store]);

  if (phase === 'loading') {
    return (
      <div className="flex h-dvh items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl glass glow-border">
            <CortexLogo className="h-8 w-8 text-[var(--accent-from)] animate-breathe" />
          </div>
          <div className="text-sm text-muted">{error || 'Cortex 启动中…'}</div>
          {error && <button onClick={() => window.location.reload()} className="text-sm underline">重新载入</button>}
        </div>
      </div>
    );
  }

  const immersive = timer.immersive && timer.status === 'running';

  return (
    <div className="relative z-10 flex h-dvh overflow-hidden">
      {/* 桌面 rail */}
      <aside className="hidden md:flex w-[76px] shrink-0 flex-col items-center gap-1 border-r border-[var(--border)] py-4">
        <NavLink to="/" className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl gradient-bg text-white shadow-lg" title="Cortex">
          <CortexLogo className="h-6 w-6" />
        </NavLink>
        {NAV.map(({ to, icon: Icon, label, end, badge }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            title={label}
            className={({ isActive }) =>
              cn(
                'relative flex h-11 w-11 items-center justify-center rounded-xl transition-all',
                isActive
                  ? 'glass glow-border text-[var(--accent-from)]'
                  : 'text-muted hover:text-foreground hover:bg-[var(--surface)]',
              )
            }
          >
            <Icon className="h-5 w-5" />
            {badge && inboxCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full gradient-bg px-1 text-[10px] font-bold text-white">
                {inboxCount}
              </span>
            )}
          </NavLink>
        ))}
        <div className="mt-auto flex flex-col items-center gap-1">
          <SyncDot />
          <NavLink
            to="/settings"
            title="设置"
            className={({ isActive }) =>
              cn(
                'mt-2 flex h-11 w-11 items-center justify-center rounded-xl transition-all',
                isActive ? 'glass glow-border text-[var(--accent-from)]' : 'text-muted hover:text-foreground hover:bg-[var(--surface)]',
              )
            }
          >
            {user ? <User className="h-5 w-5" /> : <Settings className="h-5 w-5" />}
          </NavLink>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* 顶栏(沉浸模式隐藏) */}
        <AnimatePresence>
          {!immersive && (
            <motion.header
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--border)] px-4 md:px-6"
            >
              <button
                onClick={() => ui.setCommand(true)}
                className="flex h-9 flex-1 max-w-md items-center gap-2 rounded-xl glass px-3 text-sm text-muted/70 transition-colors hover:text-foreground"
              >
                <Search className="h-4 w-4" />
                <span>搜索或执行命令…</span>
                <span className="ml-auto hidden md:inline font-mono text-[10px] opacity-60">⌘K</span>
              </button>
              <div className="ml-auto flex items-center gap-3">
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={() => store.undo()}
                    disabled={!store.canUndo()}
                    className="grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-[var(--surface)] hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                    title="撤销 (⌘Z)"
                  >
                    <Undo2 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => store.redo()}
                    disabled={!store.canRedo()}
                    className="grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-[var(--surface)] hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                    title="重做 (⌘⇧Z)"
                  >
                    <Redo2 className="h-4 w-4" />
                  </button>
                </div>
                <span className="md:hidden"><SyncDot /></span>
                {timer.status === 'running' && (
                  <button
                    onClick={() => navigate('/focus')}
                    className="rounded-full glass px-3 py-1 text-xs font-medium gradient-text"
                    title="回到专注"
                  >
                    {Math.floor(Math.max(0, (timer.endAt ?? 0) - Date.now()) / 60000)} 分钟后休息
                  </button>
                )}
              </div>
            </motion.header>
          )}
        </AnimatePresence>

        <main className={cn('relative flex-1 overflow-y-auto overflow-x-hidden', immersive && 'overflow-hidden')}>
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="h-full"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>

        {/* 手机底部栏 */}
        {!immersive && (
          <nav className="md:hidden flex shrink-0 items-stretch justify-around border-t border-[var(--border)] bg-[var(--surface-raised)] pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
            {NAV.filter((n) => n.mobile).map(({ to, icon: Icon, label, end, badge }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'relative flex min-h-[56px] min-w-[64px] flex-col items-center justify-center gap-0.5 text-[10px]',
                    isActive ? 'text-[var(--accent-from)]' : 'text-muted',
                  )
                }
              >
                <span className="relative">
                  <Icon className="h-5 w-5" />
                  {badge && inboxCount > 0 && (
                    <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full gradient-bg px-1 text-[9px] font-bold text-white">
                      {inboxCount}
                    </span>
                  )}
                </span>
                {label}
              </NavLink>
            ))}
          </nav>
        )}

        {/* 手机 FAB */}
        {!immersive && (
          <button
            onClick={() => ui.setQuickCapture(true)}
            className="md:hidden fixed bottom-[76px] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-2xl gradient-bg text-white shadow-[0_8px_24px_-6px_color-mix(in_srgb,var(--accent-from)_60%,transparent)] active:scale-95 transition-transform"
            aria-label="快速收集"
          >
            <Plus className="h-6 w-6" />
          </button>
        )}
      </div>

      <QuickCapture />
      <CommandPalette />
      <TaskSheet />
      <TaskMenu />
      {ui.tmuxView && <Suspense fallback={null}><TmuxViewer /></Suspense>}
      {phase === 'local' && location.pathname !== '/login' && !user && (
        <button
          onClick={() => navigate('/login')}
          className="fixed bottom-[76px] left-4 z-30 md:bottom-6 md:left-[92px] flex items-center gap-2 rounded-full glass-raised px-3.5 py-2 text-xs text-muted hover:text-foreground transition-colors"
        >
          <ZapOff className="h-3.5 w-3.5" />
          本地模式 · 登录开启多端同步
        </button>
      )}
    </div>
  );
}
