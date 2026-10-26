import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Check, Flame, Trash2 } from 'lucide-react';
import { cn, Button, Input, Badge, Dialog, DialogContent, EmptyState, Progress } from '@cortex/ui';
import {
  Habit, Cadence, dayKeyOf, habitStreak, heatmapWeeks, isDueOn, weekDone,
  logCountOn, heatmapDays,
} from '@cortex/core';
import { useCortex, useCortexData } from '@cortex/crdt';

const CADENCE_LABEL = (c: Cadence) =>
  c.type === 'daily'
    ? '每天'
    : c.type === 'weekly'
      ? c.days?.length
        ? `每周 ${c.days.length} 天`
        : `每周 ${c.timesPerWeek} 次`
      : c.type === 'interval'
        ? `每 ${c.everyNDays} 天`
        : '自定义';

export default function HabitsPage() {
  const data = useCortexData();
  const today = dayKeyOf(new Date());
  const [creating, setCreating] = useState(false);
  const habits = data.habits.filter((h) => !h.deletedAt && !h.archivedAt);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 px-4 pt-4 md:px-6">
        <h1 className="text-lg font-semibold">习惯</h1>
        <Badge>{habits.length} 个进行中</Badge>
        <Button size="sm" variant="primary" className="ml-auto" onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5" /> 新习惯
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-24 md:px-6">
        {habits.length === 0 ? (
          <EmptyState icon={<Flame className="h-7 w-7" />} title="种下第一个习惯" sub="每天一点,复利惊人" />
        ) : (
          <div className="mx-auto grid max-w-5xl gap-3 md:grid-cols-2">
            {habits.map((h) => (
              <HabitCard key={h.id} habit={h} todayKey={today} />
            ))}
          </div>
        )}
      </div>

      <CreateHabitDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function HabitCard({ habit, todayKey }: { habit: Habit; todayKey: string }) {
  const data = useCortexData();
  const store = useCortex();
  const [open, setOpen] = useState(false);
  const count = logCountOn(data.habitLogs, habit.id, todayKey);
  const target = habit.targetPerDay ?? 1;
  const done = count >= target;
  const streak = habitStreak(habit, data.habitLogs);
  const due = isDueOn(habit, todayKey);

  return (
    <motion.div layout className="glass rounded-2xl p-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => store.logHabit(habit.id, todayKey, done ? -1 : 1, target)}
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 transition-all active:scale-90',
            done ? 'border-transparent text-white' : 'border-[var(--border-strong)] text-transparent hover:border-[var(--accent-from)]',
          )}
          style={done ? { background: habit.color, boxShadow: `0 0 16px ${habit.color}55` } : undefined}
          aria-label="打卡"
        >
          <Check className="h-5 w-5" strokeWidth={3} />
        </button>
        <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(true)}>
          <div className="truncate text-sm font-medium">{habit.name}</div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted">
            <span>{CADENCE_LABEL(habit.cadence)}</span>
            {streak > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[var(--warning)]">
                <Flame className="h-3 w-3" />
                {streak}
              </span>
            )}
            {!due && habit.cadence.type === 'weekly' && (
              <span>本周 {weekDone(habit, data.habitLogs, new Date())}/{(habit.cadence as { timesPerWeek?: number }).timesPerWeek ?? 0}</span>
            )}
          </div>
        </button>
        {target > 1 && (
          <div className="shrink-0 text-right">
            <div className="text-sm font-semibold tabular">{count}/{target}</div>
            <div className="mt-0.5 w-14"><Progress value={count / target} /></div>
          </div>
        )}
      </div>
      <AnimatePresence>
        {open && (
          <HabitExpand habit={habit} onClose={() => setOpen(false)} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function HabitExpand({ habit, onClose }: { habit: Habit; onClose: () => void }) {
  const data = useCortexData();
  const store = useCortex();
  const weeks = useMemo(() => heatmapWeeks(habit, data.habitLogs, 18), [habit, data.habitLogs]);
  const days30 = useMemo(() => heatmapDays(habit, data.habitLogs, 30), [habit, data.habitLogs]);
  const done30 = days30.filter((d) => d.ratio >= 1).length;
  const streak = habitStreak(habit, data.habitLogs);
  const maxStreak = useMemo(() => {
    // 近一年最长连续(粗略:从热力周算)
    const weeks52 = heatmapWeeks(habit, data.habitLogs, 52);
    const flat = weeks52.flat();
    let best = 0, cur = 0;
    for (const d of flat) {
      if (d.ratio >= 1) { cur++; best = Math.max(best, cur); } else if (!d.future) cur = 0;
    }
    return best;
  }, [habit, data.habitLogs]);

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      className="overflow-hidden"
    >
      <div className="mt-3 border-t border-[var(--border)] pt-3">
        <div className="no-scrollbar overflow-x-auto pb-1">
          <div className="flex gap-[3px]">
            {weeks.map((col, i) => (
              <div key={i} className="flex flex-col gap-[3px]">
                {col.map((d) => (
                  <div
                    key={d.dayKey}
                    title={`${d.dayKey} · ${d.count} 次`}
                    className="h-3 w-3 rounded-[3px] transition-colors"
                    style={{
                      background: d.future
                        ? 'transparent'
                        : d.ratio >= 1
                          ? habit.color
                          : d.ratio > 0
                            ? `${habit.color}66`
                            : d.due
                              ? 'var(--border)'
                              : 'transparent',
                      border: d.future || (!d.due && d.ratio === 0) ? '1px dashed var(--border)' : undefined,
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-2 flex items-center gap-3 text-[10px] text-muted">
          <span>30 天完成 {done30}/30</span>
          <span>当前 streak {streak}</span>
          <span>最长 {maxStreak}</span>
          <button className="ml-auto inline-flex items-center gap-1 hover:text-[var(--danger)]" onClick={() => { store.deleteHabit(habit.id); onClose(); }}>
            <Trash2 className="h-3 w-3" /> 删除
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function CreateHabitDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useCortex();
  const [name, setName] = useState('');
  const [target, setTarget] = useState(1);
  const [color, setColor] = useState('#22d3ee');
  const [cadence, setCadence] = useState<Cadence>({ type: 'daily' });
  const [cadenceType, setCadenceType] = useState<'daily' | 'weekly-times' | 'weekly-days' | 'interval'>('daily');
  const [timesPerWeek, setTimesPerWeek] = useState(3);
  const [intervalDays, setIntervalDays] = useState(2);
  const [weekDays, setWeekDays] = useState<number[]>([1, 3, 5]);

  const submit = () => {
    if (!name.trim()) return;
    let c: Cadence = { type: 'daily' };
    if (cadenceType === 'weekly-times') c = { type: 'weekly', timesPerWeek };
    else if (cadenceType === 'weekly-days') c = { type: 'weekly', timesPerWeek: weekDays.length, days: weekDays };
    else if (cadenceType === 'interval') c = { type: 'interval', everyNDays: intervalDays };
    setCadence(c);
    store.createHabit({ name: name.trim(), color, cadence: c, targetPerDay: target });
    setName('');
    setTarget(1);
    onClose();
  };

  const COLORS = ['#22d3ee', '#8b5cf6', '#34d399', '#fbbf24', '#fb7185', '#38bdf8'];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="新习惯">
        <div className="space-y-4">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="习惯名称,如:喝水 8 杯" />
          <div className="flex items-center gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={cn('h-7 w-7 rounded-full transition-all', color === c && 'ring-2 ring-offset-2 ring-offset-transparent')}
                style={{ background: c, boxShadow: color === c ? `0 0 12px ${c}` : undefined }}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-muted">每日目标次数</span>
              <Input type="number" min={1} max={20} className="mt-1" value={target} onChange={(e) => setTarget(Math.max(1, Number(e.target.value) || 1))} />
            </label>
            <label className="block">
              <span className="text-xs text-muted">频率</span>
              <select
                className="mt-1 h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-sm outline-none"
                value={cadenceType}
                onChange={(e) => setCadenceType(e.target.value as typeof cadenceType)}
              >
                <option value="daily">每天</option>
                <option value="weekly-times">每周 N 次(弹性)</option>
                <option value="weekly-days">指定周几</option>
                <option value="interval">每 N 天</option>
              </select>
            </label>
          </div>
          {cadenceType === 'weekly-times' && (
            <label className="block">
              <span className="text-xs text-muted">每周次数</span>
              <Input type="number" min={1} max={7} className="mt-1" value={timesPerWeek} onChange={(e) => setTimesPerWeek(Math.max(1, Number(e.target.value) || 1))} />
            </label>
          )}
          {cadenceType === 'weekly-days' && (
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <button
                  key={d}
                  onClick={() => setWeekDays((ws) => (ws.includes(d) ? ws.filter((x) => x !== d) : [...ws, d]))}
                  className={cn('h-8 w-8 rounded-lg text-xs', weekDays.includes(d) ? 'gradient-bg text-white' : 'glass text-muted')}
                >
                  {['一', '二', '三', '四', '五', '六', '日'][d - 1]}
                </button>
              ))}
            </div>
          )}
          {cadenceType === 'interval' && (
            <label className="block">
              <span className="text-xs text-muted">间隔天数</span>
              <Input type="number" min={2} max={30} className="mt-1" value={intervalDays} onChange={(e) => setIntervalDays(Math.max(2, Number(e.target.value) || 2))} />
            </label>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
            <Button variant="primary" size="sm" onClick={submit}>创建</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HabitDetailSheet() {
  return null; // 详情通过卡片展开实现(HabitExpand)
}
