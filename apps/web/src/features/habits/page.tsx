import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { Plus, Check, Flame, Trash2, Pencil, ChevronDown, Clock, Bell, Minus, GripVertical } from 'lucide-react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn, Button, Dialog, DialogContent, EmptyState } from '@cortex/ui';
import { dayKeyOf, habitStreak, heatmapWeeks, isDueOn, weekDone, logCountOn, heatmapDays, habitReminderTimes, sortedHabits, habitOrderAfterMove, type Habit, type Cadence, type HabitLog, type Settings } from '@cortex/core';
import { useCortex, useCortexData } from '@cortex/crdt';
import { HabitDialog } from './HabitDialog';
import { useHabitClock } from './clock';

const EMPTY_LOGS: HabitLog[] = [];
const cadenceLabel = (cadence: Cadence) => cadence.type === 'daily' ? '每天' : cadence.type === 'weekly' ? cadence.days?.length ? `每周${[...cadence.days].sort((a, b) => a - b).map(day => ['一', '二', '三', '四', '五', '六', '日'][day - 1]).join('、')}` : `每周 ${cadence.timesPerWeek} 次` : cadence.type === 'interval' ? `每 ${cadence.everyNDays} 天` : '自定义频率';

export default function HabitsPage() {
  const store = useCortex();
  return <HabitWorkspace key={store.userId} />;
}
function HabitWorkspace() {
  const store = useCortex();
  const data = useCortexData();
  const now = useHabitClock();
  const today = dayKeyOf(now);
  const [params] = useSearchParams();
  const location = useLocation();
  const handledRequest = useRef<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Habit | null>(null);
  const [deleting, setDeleting] = useState<Habit | null>(null);
  const [sortError, setSortError] = useState('');
  const habits = useMemo(() => sortedHabits(data.habits, data.settings), [data.habits, data.settings.habitSort, data.settings.habitOrder]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const saveOrdering = async (patch: Pick<Partial<Settings>, 'habitSort' | 'habitOrder'>) => {
    try {
      setSortError('');
      store.stopUndoCapture(); store.updateSettings(patch); store.stopUndoCapture();
      await store.flushPersistence();
    } catch { setSortError('排序保存失败，请保留页面并重试。'); }
  };
  const reorder = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const current = store.getData();
    const order = habitOrderAfterMove(current.habits, current.settings, String(active.id), String(over.id));
    if (order) void saveOrdering({ habitSort: 'manual', habitOrder: order });
  };
  const logsByHabit = useMemo(() => {
    const byId = new Map<string, HabitLog[]>();
    for (const log of data.habitLogs) { const list = byId.get(log.habitId) ?? []; list.push(log); byId.set(log.habitId, list); }
    return byId;
  }, [data.habitLogs]);
  const requested = params.get('habit');
  useEffect(() => {
    if (!requested || handledRequest.current === location.key || !data.habits.some(habit => habit.id === requested && !habit.deletedAt && !habit.archivedAt)) return;
    handledRequest.current = location.key;
    setExpanded(requested);
    const frame = requestAnimationFrame(() => document.getElementById(`habit-${requested}`)?.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [requested, location.key, data.habits]);
  return <div className="flex h-full flex-col">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-4 sm:gap-3 md:px-6"><h1 className="text-lg font-semibold">习惯</h1><span className="hidden text-xs text-muted sm:inline">{habits.length} 个习惯</span><select aria-label="习惯排序方式" title="未设时间的习惯排在最后；拖动会切换为手动排序" value={data.settings.habitSort} onChange={event => void saveOrdering({ habitSort: event.target.value as Settings['habitSort'] })} className="ml-auto h-8 min-w-0 max-w-36 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs text-muted outline-none focus:border-[var(--accent-solid)]"><option value="time">按提醒时间</option><option value="manual">手动排序</option></select><Button size="sm" variant="primary" onClick={() => setCreating(true)}><Plus size={14} />新习惯</Button></div>
    {sortError && <p role="alert" className="px-4 py-2 text-xs text-[var(--danger)]">{sortError}</p>}
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 pb-24 md:px-6">
      {!habits.length ? <EmptyState icon={<Flame className="h-7 w-7" />} title="种下第一个习惯" sub="设置时间，逐日记录，慢慢积累。" /> : <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorder} accessibility={{
        screenReaderInstructions: { draggable: '按空格开始排序，用上下方向键移动，再按空格确认；按 Esc 取消。拖动后切换为手动排序。' },
        announcements: {
          onDragStart: ({ active }) => `开始移动习惯 ${habits.find(habit => habit.id === active.id)?.name ?? ''}`,
          onDragOver: ({ active, over }) => over ? `习惯 ${habits.find(habit => habit.id === active.id)?.name ?? ''} 移到 ${habits.find(habit => habit.id === over.id)?.name ?? ''} 位置` : '已离开习惯列表',
          onDragEnd: () => '习惯排序完成', onDragCancel: () => '已取消习惯排序',
        },
      }}><SortableContext items={habits.map(habit => habit.id)} strategy={verticalListSortingStrategy}><div aria-label="习惯列表" className="mx-auto max-w-5xl divide-y divide-[var(--border)]">{habits.map(habit => <HabitRow key={habit.id} habit={habit} logs={logsByHabit.get(habit.id) ?? EMPTY_LOGS} now={now} today={today} open={expanded === habit.id} onToggle={() => setExpanded(previous => previous === habit.id ? null : habit.id)} onEdit={() => setEditing(habit)} onDelete={() => setDeleting(habit)} />)}</div></SortableContext></DndContext>}
    </div>
    {(creating || editing) && <HabitDialog key={editing?.id ?? 'new'} habit={editing ?? undefined} onClose={() => { setCreating(false); setEditing(null); }} />}
    {deleting && <DeleteHabitDialog habit={deleting} onClose={() => setDeleting(null)} />}
  </div>;
}
function HabitRow({ habit, logs, today, now, open, onToggle, onEdit, onDelete }: { habit: Habit; logs: HabitLog[]; today: string; now: number; open: boolean; onToggle: () => void; onEdit: () => void; onDelete: () => void }) {
  const store = useCortex();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: habit.id });
  const count = logCountOn(logs, habit.id, today), target = habit.targetPerDay ?? 1;
  const done = count >= target;
  const progress = Math.min(1, count / target);
  const reminderTimes = habitReminderTimes(habit);
  const timeLabel = reminderTimes.join('、');
  const date = new Date(now);
  const streak = useMemo(() => habitStreak(habit, logs, new Date(`${today}T12:00:00`)), [habit, logs, today]);
  const flexible = habit.cadence.type === 'weekly' && !habit.cadence.days?.length;
  const due = isDueOn(habit, today);
  const contentId = `habit-history-${habit.id}`;
  const checkIn = (delta: number) => { store.stopUndoCapture(); store.logHabit(habit.id, today, delta, target); store.stopUndoCapture(); };
  return <section ref={setNodeRef} id={`habit-${habit.id}`} data-habit-row={habit.id} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn('habit-row min-w-0', isDragging && 'relative z-10 bg-[var(--background)] shadow-sm')}>
    <div className="flex min-h-14 items-center gap-2 sm:gap-3">
      <button ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`拖动习惯 ${habit.name} 排序`} title="拖动排序，调整后切换为手动排序" className="habit-drag-handle grid h-8 w-5 shrink-0 touch-none place-items-center rounded text-muted/50 hover:text-foreground focus-visible:opacity-100"><GripVertical size={14} /></button>
      <button aria-label={done ? `撤销 ${habit.name} 一次打卡` : `为 ${habit.name} 打卡`} aria-description={`今日已完成 ${count}/${target} 次`} aria-pressed={done} title={`${count}/${target} · ${done ? '撤销一次打卡' : '打卡 +1'}`} onClick={() => checkIn(done ? -1 : 1)} className={cn('relative isolate grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-lg border outline-offset-2 transition-colors', done ? 'text-white' : 'text-muted hover:border-[var(--accent-solid)]')} style={{ borderColor: progress > 0 ? habit.color : 'var(--border-strong)', background: progress > 0 ? `color-mix(in srgb, ${habit.color} 8%, var(--background))` : undefined }}>
        <span aria-hidden="true" data-habit-fill className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 transition-[height] duration-150 motion-reduce:transition-none" style={{ height: `${progress * 100}%`, background: habit.color }} />
        <Check aria-hidden="true" size={16} strokeWidth={done ? 2.2 : 1.5} className={done ? '' : 'opacity-25'} />
      </button>
      <button aria-label={`${habit.name}的打卡记录`} aria-expanded={open} aria-controls={open ? contentId : undefined} title={`${habit.name} · ${cadenceLabel(habit.cadence)}`} onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 py-4 text-left outline-offset-2 sm:gap-4">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{habit.name}</span>
        <span className="hidden shrink-0 text-xs text-muted sm:inline">{cadenceLabel(habit.cadence)}</span>
        {reminderTimes.length > 0 && <span aria-label={`打卡时间 ${timeLabel}${habit.reminderEnabled !== false ? '，提醒已开启' : ''}`} title={timeLabel} className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted">{habit.reminderEnabled !== false ? <Bell size={12} /> : <Clock size={12} />}<span>{reminderTimes[0]}</span>{reminderTimes.length > 1 && <><span className="hidden sm:inline"> / {reminderTimes[1]}{reminderTimes.length > 2 && ` +${reminderTimes.length - 2}`}</span><span className="sm:hidden">+{reminderTimes.length - 1}</span></>}</span>}
        {streak > 0 && <span title={`连续达标 ${streak}${flexible ? '周' : '天'}`} className="hidden shrink-0 items-center gap-1 text-xs tabular-nums text-muted md:flex"><Flame size={12} />{streak}</span>}
        <ChevronDown size={13} className={cn('shrink-0 text-muted transition-transform duration-100', open && 'rotate-180')} />
      </button>
      <span aria-label={`今日打卡 ${count}/${target}`} className={cn('shrink-0 text-xs tabular-nums', done ? 'text-[var(--success)]' : 'text-muted')}>{count}/{target}</span>
      <button aria-label={`编辑习惯 ${habit.name}`} title="编辑习惯" onClick={onEdit} className="grid h-8 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-[var(--surface)] hover:text-foreground"><Pencil size={14} /></button>
    </div>
    {open && <div id={contentId} role="region" aria-label={`${habit.name}打卡详情`} className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted"><span>{cadenceLabel(habit.cadence)}{reminderTimes.length ? ` · ${timeLabel}` : ' · 未设置时间'}</span>{flexible ? <span>本周 {weekDone(habit, logs, date)}/{habit.cadence.type === 'weekly' ? habit.cadence.timesPerWeek : 0} 次</span> : !due && <span>今天无需打卡，可自由补充记录</span>}</div>
      <HabitHistory habit={habit} logs={logs} today={today} />
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted"><span>连续达标 {streak} {flexible ? '周' : '天'}</span>{count > 0 && <button onClick={() => checkIn(-1)} className="inline-flex items-center gap-1 hover:text-foreground"><Minus size={12} />撤销一次打卡</button>}<button onClick={onDelete} className="ml-auto inline-flex items-center gap-1 hover:text-[var(--danger)]"><Trash2 size={12} />删除习惯</button></div>
    </div>}
  </section>;
}
function HabitHistory({ habit, logs, today }: { habit: Habit; logs: HabitLog[]; today: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // On a narrow screen, opening history should reveal the recent days first.
    const element = viewport.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, [habit.id, today]);
  const weeks = useMemo(() => heatmapWeeks(habit, logs, 26, new Date(`${today}T12:00:00`)), [habit, logs, today]);
  const done30 = useMemo(() => heatmapDays(habit, logs, 30, new Date(`${today}T12:00:00`)).filter(day => day.ratio >= 1).length, [habit, logs, today]);
  const created = dayKeyOf(habit.createdAt);
  return <>
    <div className="mb-2 flex items-center justify-between text-[11px] text-muted"><span>近半年打卡</span><span>近 30 天达标 {done30} 天</span></div>
    <div ref={viewport} className="overflow-x-auto pb-1" role="img" aria-label={`${habit.name}近半年打卡记录`}><div className="flex w-max gap-[3px]">{weeks.map((week, index) => <div key={index} className="flex flex-col gap-[3px]">{week.map(day => <span key={day.dayKey} data-habit-day={day.dayKey} data-count={day.count} title={`${day.dayKey} · ${day.future ? '尚未到来' : day.dayKey < created && day.count === 0 ? '尚未创建' : `${day.count} 次${day.ratio >= 1 ? ' · 已达标' : ''}`}`} className="block h-3 w-3 rounded-[3px]" style={{ background: day.future ? 'transparent' : day.dayKey < created && day.count === 0 ? 'var(--border)' : day.ratio >= 1 ? habit.color : day.ratio > 0 ? `color-mix(in srgb, ${habit.color} 40%, transparent)` : 'var(--border-strong)', opacity: !day.due && !day.count ? 0.45 : 1 }} />)}</div>)}</div></div>
    <div className="mt-1 flex items-center justify-between text-[10px] text-muted"><span>{weeks[0]?.[0]?.dayKey} — {today}</span><span className="flex items-center gap-1.5">少<span className="h-2.5 w-2.5 rounded-sm bg-[var(--border-strong)]" /><span className="h-2.5 w-2.5 rounded-sm" style={{ background: `color-mix(in srgb, ${habit.color} 40%, transparent)` }} /><span className="h-2.5 w-2.5 rounded-sm" style={{ background: habit.color }} />多</span></div>
  </>;
}
function DeleteHabitDialog({ habit, onClose }: { habit: Habit; onClose: () => void }) {
  const store = useCortex();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent title="删除习惯"><p className="break-words text-sm leading-relaxed">从列表移除「{habit.name}」？历史打卡记录会保留，可通过页面顶部的撤销恢复。</p>{error && <p role="alert" className="mt-2 text-xs text-[var(--danger)]">{error}</p>}<div className="mt-5 flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={onClose}>取消</Button><Button variant="danger" disabled={busy} onClick={() => {
    setBusy(true); setError('');
    store.stopUndoCapture(); store.deleteHabit(habit.id); store.stopUndoCapture();
    void store.flushPersistence().then(onClose).catch(() => { setBusy(false); setError('保存失败，请保留页面并重试'); });
  }}>{busy ? '正在删除…' : '确认删除'}</Button></div></DialogContent></Dialog>;
}
