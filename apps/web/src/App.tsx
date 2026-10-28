import React, { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { Routes, Route, Navigate } from 'react-router';
import { AuthProvider } from './app/auth';
import { Layout } from './app/Layout';
const DashboardPage = lazy(() => import('./features/dashboard/page'));
const CalendarPage = lazy(() => import('./features/calendar/page'));
const TasksPage = lazy(() => import('./features/tasks/TasksPage'));
const InboxPage = lazy(() => import('./features/inbox/page'));
const FocusPage = lazy(() => import('./features/focus/page'));
const HabitsPage = lazy(() => import('./features/habits/page'));
const SettingsPage = lazy(() => import('./features/settings/page'));
const LoginPage = lazy(() => import('./features/auth/page'));
const GalleryPage = lazy(() => import('./features/gallery/GalleryPage'));
const TmuxPage = lazy(() => import('./shared/TmuxViewer').then((module) => ({ default: module.TmuxPage })));
function page(Component: LazyExoticComponent<ComponentType>) {
  return (
    <Suspense
      fallback={
        <div role="status" className="p-6 text-sm text-muted">
          正在载入…
        </div>
      }
    >
      <Component />
    </Suspense>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/tasks" replace />} />
          <Route path="/overview" element={page(DashboardPage)} />
          <Route path="/tasks" element={page(TasksPage)} />
          <Route path="/calendar" element={page(CalendarPage)} />
          <Route path="/inbox" element={page(InboxPage)} />
          <Route path="/focus" element={page(FocusPage)} />
          <Route path="/habits" element={page(HabitsPage)} />
          <Route path="/settings" element={page(SettingsPage)} />
          <Route path="/gallery" element={page(GalleryPage)} />
        </Route>
        <Route path="/login" element={page(LoginPage)} />
        <Route path="/tmux" element={page(TmuxPage)} />
      </Routes>
    </AuthProvider>
  );
}
