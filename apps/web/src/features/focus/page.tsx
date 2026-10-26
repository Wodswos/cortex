import React, { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { Pause, Play, Square, CheckCheck, Maximize2, Minimize2, Coffee, Volume2, VolumeX, Flame, Target } from 'lucide-react';
import { cn, Button, Badge, Segmented, SegmentedList, SegmentedTrigger } from '@cortex/ui';
import { computeFocusStats, pomodoroCountToday, fmtDuration, habitsDueToday, isDoneOn, dayKeyOf } from '@cortex/core';
import { useCortex, useCortexData } from '@cortex/crdt';
import { useTimer, remainingSec } from '@/focus/timer';
import '@/focus/noise'; // 激活白噪音订阅

const PRESETS = [25, 50, 90];
const NOISES = [
  { key: 'off', label: '关' },
  { key: 'rain', label: '雨' },
  { key: 'brown', label: '棕噪' },
  { key: 'cafe', label: '咖啡' },
] as const;

export default function FocusPage() {
  const data = useCortexData();
  const store = useCortex();
  const navigate = useNavigate();
  const timer = useTimer();
  const stats = useMemo(() => computeFocusStats(data.sessions), [data.sessions]);
  const todayCount = pomodoroCountToday(data.sessions);
  const task = timer.taskId ? data.tasks.find((t) => t.id === timer.taskId) : null;

  const total = timer.mode === 'focus' ? timer.plannedMin * 60 : timer.plannedMin * 60;
  const remain = remainingSec(timer);
  const progress = 1 - remain / Math.max(1, total);
  const mm = String(Math.floor(remain / 60)).padStart(2, '0');
  const ss = String(remain % 60).padStart(2, '0');

  // 沉浸模式
  if (timer.immersive) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-8">
        <div className="text-sm text-muted">{task ? task.title : timer.mode === 'focus' ? '自由专注' : '休息'}</div>
        <div className="relative">
          <ProgressRing progress={progress} size={Math.min(380, window.innerWidth - 64)} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-6xl font-bold tabular md:text-7xl">{mm}:{ss}</div>
            <div className="mt-2 text-xs text-muted">{timer.mode === 'focus' ? '专注中' : '休息中'} · 分心 {timer.distractions}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="lg" onClick={timer.pause} disabled={timer.status !== 'running'}>
            <Pause className="h-4 w-4" /> 暂停
          </Button>
          {timer.status === 'paused' && (
            <Button variant="primary" size="lg" onClick={timer.resume}>
              <Play className="h-4 w-4" /> 继续
            </Button>
          )}
          <Button variant="ghost" size="lg" onClick={() => timer.setImmersive(false)}>
            <Minimize2 className="h-4 w-4" /> 退出沉浸
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-5xl gap-6 px-4 py-4 pb-28 md:px-6 lg:grid-cols-[1fr_320px]">
        {/* 计时区 */}
        <div className="flex flex-col items-center gap-6 pt-4">
          <div className="flex items-center gap-2">
            <Badge variant={timer.status === 'running' ? 'success' : 'default'}>
              {timer.status === 'running' ? '● 进行中' : timer.status === 'paused' ? '⏸ 已暂停' : '○ 待命'}
            </Badge>
            {task && (
              <button className="text-xs text-muted hover:text-foreground" onClick={() => navigate('/tasks')}>
                🎯 {task.title}
              </button>
            )}
          </div>

          <div className="relative">
            <ProgressRing progress={progress} size={300} paused={timer.status !== 'running'} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-5xl font-bold tabular">{mm}:{ss}</div>
              <div className="mt-1 text-[11px] text-muted">
                {timer.mode === 'focus' ? `专注 ${timer.plannedMin}m` : timer.mode === 'short-break' ? '短休息' : '长休息'}
                {timer.status === 'running' && <span className="ml-1 animate-breathe">·</span>}
              </div>
              {timer.distractions > 0 && <div className="mt-1 text-[10px] text-[var(--warning)]">分心 {timer.distractions} 次</div>}
            </div>
          </div>

          {/* 控制 */}
          <div className="flex items-center gap-2">
            {timer.status === 'idle' ? (
              <Button variant="primary" size="lg" onClick={() => timer.start({ mode: 'focus', min: timer.plannedMin })}>
                <Play className="h-4 w-4" /> 开始专注
              </Button>
            ) : timer.status === 'running' ? (
              <Button variant="secondary" size="lg" onClick={timer.pause}>
                <Pause className="h-4 w-4" /> 暂停
              </Button>
            ) : (
              <Button variant="primary" size="lg" onClick={timer.resume}>
                <Play className="h-4 w-4" /> 继续
              </Button>
            )}
            {timer.status !== 'idle' && (
              <>
                {timer.mode === 'focus' && (
                  <Button variant="outline" size="lg" onClick={timer.completeEarly} title="按完整会话记账">
                    <CheckCheck className="h-4 w-4" /> 提前完成
                  </Button>
                )}
                <Button variant="danger" size="lg" onClick={() => timer.abandon(true)} title="保留已专注部分">
                  <Square className="h-4 w-4" /> 放弃
                </Button>
                <Button variant="ghost" size="icon" onClick={() => timer.setImmersive(true)} title="沉浸模式">
                  <Maximize2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>

          {/* 预设 + 休息 + 噪音 */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {PRESETS.map((m) => (
              <button
                key={m}
                disabled={timer.status !== 'idle'}
                onClick={() => {
                  useTimer.setState({ plannedMin: m });
                  if (timer.status === 'idle') useTimer.setState({ remainingMs: m * 60000 });
                }}
                className={cn(
                  'rounded-full px-3 py-1 text-xs transition-all',
                  timer.plannedMin === m ? 'gradient-bg text-white' : 'glass text-muted hover:text-foreground',
                )}
              >
                {m} 分钟
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-[var(--border)]" />
            <Button variant="ghost" size="sm" onClick={() => timer.start({ mode: 'short-break' })} disabled={timer.status !== 'idle'}>
              <Coffee className="h-3.5 w-3.5" /> 短休
            </Button>
            <Button variant="ghost" size="sm" onClick={() => timer.start({ mode: 'long-break' })} disabled={timer.status !== 'idle'}>
              ☕ 长休
            </Button>
          </div>

          <div className="flex items-center gap-1.5">
            {NOISES.map((n) => (
              <button
                key={n.key}
                onClick={() => useTimer.setState({ noise: n.key })}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs',
                  timer.noise === n.key ? 'gradient-bg text-white' : 'glass text-muted hover:text-foreground',
                )}
              >
                {n.key === 'off' ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
                {n.label}
              </button>
            ))}
          </div>
        </div>

        {/* 统计区 */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="glass rounded-xl p-3">
              <div className="text-[10px] text-muted">今日专注</div>
              <div className="mt-1 text-xl font-semibold tabular">{fmtDuration(stats.todayMin)}</div>
            </div>
            <div className="glass rounded-xl p-3">
              <div className="text-[10px] text-muted">今日番茄</div>
              <div className="mt-1 text-xl font-semibold tabular">🍅 {todayCount}</div>
            </div>
            <div className="glass rounded-xl p-3">
              <div className="flex items-center gap-1 text-[10px] text-muted"><Flame className="h-3 w-3 text-[var(--warning)]" />连续</div>
              <div className="mt-1 text-xl font-semibold tabular">{stats.streakDays} 天</div>
            </div>
            <div className="glass rounded-xl p-3">
              <div className="flex items-center gap-1 text-[10px] text-muted"><Target className="h-3 w-3" />累计</div>
              <div className="mt-1 text-xl font-semibold tabular">{fmtDuration(stats.totalMin)}</div>
            </div>
          </div>

          <div className="glass rounded-2xl p-4">
            <div className="mb-2 text-xs font-semibold text-muted">近 7 天</div>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.last7.map((d) => ({ name: d.dayKey.slice(5), 分钟: d.minutes }))}>
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={{ fill: 'var(--surface)' }}
                    contentStyle={{ background: 'var(--surface-solid)', border: '1px solid var(--border-strong)', borderRadius: 12, fontSize: 12 }}
                  />
                  <Bar dataKey="分钟" fill="var(--accent-from)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 今日习惯迷你条 */}
          <div className="glass rounded-2xl p-4">
            <div className="mb-2 text-xs font-semibold text-muted">今日习惯</div>
            <HabitMini />
          </div>
        </div>
      </div>
    </div>
  );
}

function ProgressRing({ progress, size, paused }: { progress: number; size: number; paused?: boolean }) {
  const r = size / 2 - 14;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className={cn(!paused && 'animate-breathe')}>
      <defs>
        <linearGradient id="ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--accent-from)" />
          <stop offset="100%" stopColor="var(--accent-to)" />
        </linearGradient>
      </defs>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={8} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="url(#ring-grad)"
        strokeWidth={8}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(1, Math.max(0, progress)))}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.4s linear', filter: 'drop-shadow(0 0 6px color-mix(in srgb, var(--accent-from) 60%, transparent))' }}
      />
      {/* 外圈装饰虚线 */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r + 12}
        fill="none"
        stroke="var(--border-strong)"
        strokeWidth={1}
        strokeDasharray="2 10"
        className="origin-center animate-[spin_60s_linear_infinite]"
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
      />
    </svg>
  );
}

function HabitMini() {
  const data = useCortexData();
  const store = useCortex();
  const today = dayKeyOf(new Date());
  const due = habitsDueToday(data.habits);
  if (due.length === 0) return <div className="text-xs text-muted/60">还没有习惯,去习惯面板创建</div>;
  return (
    <div className="space-y-1.5">
      {due.slice(0, 5).map((h) => {
        const done = isDoneOn(h, data.habitLogs, today);
        return (
          <button
            key={h.id}
            onClick={() => store.logHabit(h.id, today, done ? -1 : 1, h.targetPerDay ?? 1)}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-all',
              done ? 'text-[var(--success)]' : 'text-muted hover:text-foreground',
            )}
          >
            <span
              className={cn('h-2.5 w-2.5 rounded-full border transition-all', done ? 'border-transparent' : 'border-[var(--border-strong)]')}
              style={done ? { background: h.color } : undefined}
            />
            <span className={cn('flex-1 text-left', done && 'line-through opacity-70')}>{h.name}</span>
            {done && '✓'}
          </button>
        );
      })}
    </div>
  );
}
