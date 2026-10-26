import React, { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Inbox, ChevronRight, Clock, Flame, Timer, Activity, CalendarClock } from 'lucide-react';
import { cn, Badge, EmptyState } from '@cortex/ui';
import {
  Task, activeTasks, listGroupOf, computeFocusStats, habitsDueToday, isDoneOn, dayKeyOf,
  endOfDay, fmtHM, fmtDuration,
} from '@cortex/core';
import { useCortex, useCortexData } from '@cortex/crdt';
import { useUI } from '@/state/ui';
import { TaskCheckbox, DueBadge, StatTile, EVENT_KIND_STYLE } from '@/shared/components';

export default function DashboardPage() {
  const data = useCortexData();
  const ui = useUI();
  const navigate = useNavigate();
  const now = new Date();
  const todayKey = dayKeyOf(now);

  const todayTasks = useMemo(
    () =>
      activeTasks(data.tasks)
        .filter((t) => t.status !== 'inbox' && t.status !== 'done' && (listGroupOf(t, now) === 'today' || listGroupOf(t, now) === 'overdue' || t.status === 'doing'))
        .sort((a, b) => (a.status === 'doing' ? -1 : 0) - (b.status === 'doing' ? -1 : 0)),
    [data.tasks, now],
  );

  const nextEvents = useMemo(() => {
    const t = Date.now();
    return data.events
      .filter((e) => !e.deletedAt && e.end > t && e.start < endOfDay(now).getTime())
      .sort((a, b) => a.start - b.start)
      .slice(0, 4);
  }, [data.events, now]);

  const focus = useMemo(() => computeFocusStats(data.sessions), [data.sessions]);
  const dueHabits = habitsDueToday(data.habits);
  const doneHabits = dueHabits.filter((h) => isDoneOn(h, data.habitLogs, todayKey)).length;
  const inboxCount = data.tasks.filter((t) => t.status === 'inbox' && !t.deletedAt).length;
  const taskById = useMemo(() => new Map(data.tasks.map((t) => [t.id, t])), [data.tasks]);

  const hour = now.getHours();
  const greet = hour < 5 ? '夜深了' : hour < 9 ? '早上好' : hour < 12 ? '上午好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : hour < 23 ? '晚上好' : '夜深了';

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-5 pb-24 md:px-6">
        {/* 头部问候 */}
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold">
              {greet}
              <span className="gradient-text"> ,今天也要支棱起来</span>
            </h1>
            <p className="mt-1 text-xs text-muted">
              {now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}
            </p>
          </div>
        </div>

        {/* 统计条 */}
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          <button className="text-left transition-transform active:scale-[0.98]" onClick={() => navigate('/tasks')}>
            <StatTile label="今日待办" value={todayTasks.filter((t) => t.status !== 'done').length} sub={`${todayTasks.filter((t) => t.status === 'done').length} 已完成`} />
          </button>
          <button className="text-left transition-transform active:scale-[0.98]" onClick={() => navigate('/focus')}>
            <StatTile label="今日专注" value={fmtDuration(focus.todayMin)} sub={`连续 ${focus.streakDays} 天`} />
          </button>
          <button className="text-left transition-transform active:scale-[0.98]" onClick={() => navigate('/habits')}>
            <StatTile label="今日习惯" value={`${doneHabits}/${dueHabits.length}`} sub={dueHabits.length === 0 ? '还没有习惯' : doneHabits === dueHabits.length ? '全部达成 🎉' : '继续加油'} />
          </button>
          <button className="text-left transition-transform active:scale-[0.98]" onClick={() => navigate('/inbox')}>
            <StatTile label="收集箱" value={inboxCount} sub={inboxCount > 0 ? '待整理' : '清空 ✓'} />
          </button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          {/* 今日任务 */}
          <section className="glass rounded-2xl p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <Clock className="h-4 w-4 text-[var(--accent-from)]" /> 今日任务
              </h2>
              <button className="flex items-center text-xs text-muted hover:text-foreground" onClick={() => navigate('/tasks')}>
                全部 <ChevronRight className="h-3 w-3" />
              </button>
            </div>
            {todayTasks.length === 0 ? (
              <EmptyState icon={<Activity className="h-6 w-6" />} title="今天没有安排" sub="用 ⌘K 打开命令面板,或去时间线排一天" />
            ) : (
              <div className="space-y-0.5">
                {todayTasks.slice(0, 8).map((t) => (
                  <DashboardTaskRow key={t.id} task={t} onOpen={() => ui.selectTask(t.id)} />
                ))}
                {todayTasks.length > 8 && (
                  <button className="w-full py-1.5 text-center text-xs text-muted hover:text-foreground" onClick={() => navigate('/tasks')}>
                    还有 {todayTasks.length - 8} 项…
                  </button>
                )}
              </div>
            )}
          </section>

          {/* 接下来 + 习惯 */}
          <div className="space-y-4">
            <section className="glass rounded-2xl p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                  <CalendarClock className="h-4 w-4 text-[var(--accent-to)]" /> 接下来
                </h2>
                <button className="flex items-center text-xs text-muted hover:text-foreground" onClick={() => navigate('/tasks?view=timeline')}>
                  时间线 <ChevronRight className="h-3 w-3" />
                </button>
              </div>
              {nextEvents.length === 0 ? (
                <div className="py-4 text-center text-xs text-muted/60">今天没有日程,拖任务进时间线安排</div>
              ) : (
                <div className="space-y-1.5">
                  {nextEvents.map((e) => {
                    const style = EVENT_KIND_STYLE[e.kind];
                    const task = e.taskId ? taskById.get(e.taskId) : null;
                    const past = e.start < Date.now();
                    return (
                      <button
                        key={e.id}
                        onClick={() => navigate('/tasks?view=timeline')}
                        className={cn('flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs transition-colors hover:bg-[var(--surface)]', past && 'opacity-60')}
                      >
                        <span className="tabular text-muted">{fmtHM(e.start)}</span>
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: style.color }} />
                        <span className={cn('min-w-0 flex-1 truncate', e.completed && 'line-through opacity-60')}>{e.title}</span>
                        {task && <Badge className="!py-0 !text-[9px]">任务</Badge>}
                        {e.start < Date.now() && e.end > Date.now() && (
                          <Badge variant="accent" className="!py-0 !text-[9px]">进行中</Badge>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="glass rounded-2xl p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                  <Flame className="h-4 w-4 text-[var(--warning)]" /> 今日习惯
                </h2>
                <button className="flex items-center text-xs text-muted hover:text-foreground" onClick={() => navigate('/habits')}>
                  管理 <ChevronRight className="h-3 w-3" />
                </button>
              </div>
              {dueHabits.length === 0 ? (
                <div className="py-3 text-center text-xs text-muted/60">
                  <Inbox className="mx-auto mb-1 h-5 w-5 opacity-40" />
                  还没有习惯
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {dueHabits.map((h) => {
                    const done = isDoneOn(h, data.habitLogs, todayKey);
                    return (
                      <span
                        key={h.id}
                        className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs', done ? 'text-white' : 'text-muted border-[var(--border)]')}
                        style={done ? { background: h.color, borderColor: 'transparent' } : undefined}
                      >
                        {h.name} {done ? '✓' : ''}
                      </span>
                    );
                  })}
                </div>
              )}
            </section>

            <button
              onClick={() => navigate('/focus')}
              className="flex w-full items-center gap-3 rounded-2xl glass p-4 text-left transition-all hover:glow-border"
            >
              <Timer className="h-8 w-8 text-[var(--accent-from)]" />
              <div>
                <div className="text-sm font-medium">开始一轮专注?</div>
                <div className="text-[11px] text-muted">25 分钟 · 一个番茄 · 一件小事</div>
              </div>
              <ChevronRight className="ml-auto h-4 w-4 text-muted" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardTaskRow({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const store = useCortex();
  return (
    <div className="group flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-[var(--surface)]">
      <TaskCheckbox
        done={task.status === 'done'}
        onChange={() => {
          store.toggleTaskDone(task.id);
        }}
      />
      <button onClick={onOpen} className={cn('min-w-0 flex-1 truncate text-left text-sm', task.status === 'done' && 'text-muted line-through')}>
        {task.status === 'doing' && <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-breathe rounded-full bg-[var(--warning)]" />}
        {task.title || 'Untitled'}
      </button>
      <DueBadge task={task} />
    </div>
  );
}
