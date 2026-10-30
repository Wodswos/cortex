import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { GripHorizontal, Link2, Trash2, Unlink, Check, Clock } from 'lucide-react';
import { cn, Badge } from '@cortex/ui';
import {
  ScheduleEvent,
  EventKind,
  startOfDay,
  endOfDay,
  minutesOfDay,
  fmtHM,
  pad2,
  activeTasks,
  isStructural,
} from '@cortex/core';
import { useCortex } from '@cortex/crdt';
import { useTaskViewData } from '../useTaskViewData';
import { useUI } from '@/state/ui';
import { useTimer } from '@/focus/timer';
import { EVENT_KIND_STYLE } from '@/shared/components';
import { isComposing } from '@/shared/ime';

const PX_PER_HOUR = 64;
const SNAP_MIN = 5;
const GUTTER = 52;

const pxToMin = (px: number) => (px / PX_PER_HOUR) * 60;
const minToPx = (min: number) => (min / 60) * PX_PER_HOUR;
const snap = (min: number) => Math.round(min / SNAP_MIN) * SNAP_MIN;

interface DragState {
  kind: 'move' | 'resize-end';
  eventId: string;
  startMin: number; // 按下时的
  endMin: number;
  grabOffsetMin: number;
  curStart: number;
  curEnd: number;
}

export function DayView({
  date,
  onDateChange,
  onCreateTask,
}: {
  date: Date;
  onDateChange: (d: Date) => void;
  onCreateTask?: (dueAt: number, event: React.PointerEvent) => void;
}) {
  const data = useTaskViewData();
  const store = useCortex();
  const ui = useUI();
  const navigate = useNavigate();
  const timerStart = useTimer((s) => s.start);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dayRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    startMin: number;
    endMin: number;
    title: string;
    taskId?: string;
  } | null>(null);
  const [nowMin, setNowMin] = useState(() => minutesOfDay(new Date()));
  const [dragTask, setDragTask] = useState<{ taskId: string; title: string; x: number; y: number } | null>(
    null,
  );

  const dayStart = startOfDay(date).getTime();
  const dayEnd = endOfDay(date).getTime();
  const dayMinutes = (dayEnd - dayStart) / 60000;
  const clampMin = (min: number, lo = 0, hi = dayMinutes) => Math.max(lo, Math.min(hi, min));
  const isToday = dayKey(date) === fmtDay(new Date());

  useEffect(() => {
    const t = setInterval(() => setNowMin(minutesOfDay(new Date())), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    // 初始滚到当前时刻附近(今天)或 7:00
    const target = isToday ? (Date.now() - dayStart) / 60000 - 90 : 7 * 60;
    scrollRef.current?.scrollTo({ top: Math.max(0, minToPx(target)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayStart]);

  const events = useMemo(
    () =>
      data.events
        .filter((e) => !e.deletedAt && e.start < dayEnd && e.end > dayStart)
        .sort((a, b) => a.start - b.start),
    [data.events, dayStart, dayEnd],
  );

  const taskById = useMemo(() => new Map(data.tasks.map((t) => [t.id, t])), [data.tasks]);

  /** 今日待排任务:今天到期或无日期的 todo/doing,且今天还没排 */
  const unscheduled = useMemo(() => {
    const scheduledTaskIds = new Set(events.map((e) => e.taskId).filter(Boolean) as string[]);
    return activeTasks(data.tasks)
      .filter(
        (t) =>
          t.status !== 'inbox' &&
          t.status !== 'done' &&
          !isStructural(t) && // 结构节点无排期,不进今日待排
          !scheduledTaskIds.has(t.id) &&
          (t.dueAt == null || t.dueAt < dayEnd),
      )
      .slice(0, 12);
  }, [data.tasks, events, dayEnd]);

  /** 当日到期任务:任意层级,渲染为时间轴上的「⏰ 截止」标记(虚线块,与排程块区分) */
  const dueTasks = useMemo(
    () =>
      activeTasks(data.tasks).filter(
        (t) =>
          t.status !== 'inbox' &&
          (t.status !== 'done' || data.settings.completedDisplay !== 'hidden') &&
          !isStructural(t) &&
          t.dueAt != null &&
          t.dueAt >= dayStart &&
          t.dueAt < dayEnd,
      ),
    [data.tasks, data.settings.completedDisplay, dayStart, dayEnd],
  );

  const localMin = (e: ScheduleEvent) => ({
    start: clampMin((e.start - dayStart) / 60000),
    end: clampMin((e.end - dayStart) / 60000),
  });

  // ---------- 事件拖拽/拉伸(自定义指针状态机) ----------
  const beginDrag = (e: React.PointerEvent, ev: ScheduleEvent, kind: DragState['kind']) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const l = localMin(ev);
    setDrag({
      kind,
      eventId: ev.id,
      startMin: l.start,
      endMin: l.end,
      grabOffsetMin: kind === 'move' ? pxToMin(e.clientY - e.currentTarget.getBoundingClientRect().top) : 0,
      curStart: l.start,
      curEnd: l.end,
    });
    setSelectedEvent(ev.id);
  };

  const onDayPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const rect = dayRef.current?.getBoundingClientRect();
    if (!rect) return;
    const min = snap(clampMin(pxToMin(e.clientY - rect.top)));
    if (drag.kind === 'move') {
      const dur = drag.endMin - drag.startMin;
      setDrag({
        ...drag,
        curStart: clampMin(snap(min - drag.grabOffsetMin), 0, dayMinutes - dur),
        curEnd: clampMin(snap(min - drag.grabOffsetMin), 0, dayMinutes - dur) + dur,
      });
    } else {
      setDrag({ ...drag, curEnd: Math.max(drag.curStart + SNAP_MIN, min) });
    }
  };

  const commitDrag = () => {
    if (!drag) return;
    const ev = data.events.find((x) => x.id === drag.eventId);
    if (ev && (drag.curStart !== drag.startMin || drag.curEnd !== drag.endMin)) {
      if (drag.kind === 'move') {
        const delta = (drag.curStart - drag.startMin) * 60000;
        store.updateEvent(ev.id, { start: ev.start + delta, end: ev.end + delta });
      } else
        store.updateEvent(ev.id, {
          end: Math.max(ev.start + SNAP_MIN * 60000, dayStart + drag.curEnd * 60000),
        });
      store.stopUndoCapture();
    }
    setDrag(null);
  };

  // ---------- 空白拖划创建 ----------
  const [selectRect, setSelectRect] = useState<{ from: number; to: number } | null>(null);
  const onBackgroundDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setSelectedEvent(null);
    const rect = dayRef.current!.getBoundingClientRect();
    const from = snap(clampMin(pxToMin(e.clientY - rect.top)));
    setSelectRect({ from, to: from });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onBackgroundMove = (e: React.PointerEvent) => {
    if (!selectRect) return;
    const rect = dayRef.current!.getBoundingClientRect();
    const to = snap(clampMin(pxToMin(e.clientY - rect.top)));
    setSelectRect((r) => (r ? { ...r, to } : r));
  };
  const onBackgroundUp = (event: React.PointerEvent) => {
    if (!selectRect) return;
    const startMin = Math.min(selectRect.from, selectRect.to);
    const endMin = Math.min(dayMinutes, Math.max(selectRect.from + SNAP_MIN, selectRect.to));
    if (onCreateTask && Math.abs(selectRect.from - selectRect.to) < SNAP_MIN) {
      onCreateTask(dayStart + Math.min(startMin, dayMinutes - SNAP_MIN) * 60000, event);
    } else if (endMin - startMin >= 15) setDraft({ startMin, endMin, title: '' });
    setSelectRect(null);
  };

  // ---------- 任务坞拖入 ----------
  const onChipPointerDown = (e: React.PointerEvent, taskId: string, title: string) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => setDragTask({ taskId, title, x: ev.clientX, y: ev.clientY });
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const rect = dayRef.current?.getBoundingClientRect();
      setDragTask(null);
      if (!rect) return;
      if (
        ev.clientX >= rect.left &&
        ev.clientX <= rect.right &&
        ev.clientY >= rect.top &&
        ev.clientY <= rect.bottom
      ) {
        const min = Math.min(dayMinutes - SNAP_MIN, snap(clampMin(pxToMin(ev.clientY - rect.top))));
        store.createEvent({
          title,
          taskId,
          start: dayStart + min * 60000,
          end: dayStart + Math.min(dayMinutes, min + 60) * 60000,
          kind: 'focus',
        });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const createDraft = () => {
    if (!draft) return;
    store.createEvent({
      title: draft.title.trim() || '新时间块',
      taskId: draft.taskId ?? null,
      start: dayStart + draft.startMin * 60000,
      end: dayStart + draft.endMin * 60000,
      kind: 'focus',
    });
    setDraft(null);
  };

  const selected = events.find((e) => e.id === selectedEvent) ?? null;
  const doneCount = events.filter((e) => e.completed).length;

  return (
    <div className="flex h-full min-h-0">
      {/* 时间轴主体 */}
      <div ref={scrollRef} data-testid="day-scroll" className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex px-2 pb-24 pt-2 md:px-4">
          <div
            className="relative select-none"
            style={{ width: `calc(100% - ${GUTTER}px)`, marginLeft: GUTTER }}
          >
            {/* 小时刻度 */}
            <div className="absolute inset-y-0 -left-[52px] w-[52px]">
              {Array.from({ length: Math.ceil(dayMinutes / 60) }, (_, h) => (
                <div
                  key={h}
                  className="absolute -translate-y-1/2 text-right pr-2 text-[10px] text-muted/70 tabular"
                  style={{ top: minToPx(h * 60) }}
                >
                  {fmtHM(dayStart + h * 3600000)}
                </div>
              ))}
            </div>
            <div
              ref={dayRef}
              className={cn(
                'relative rounded-xl border border-[var(--border)] bg-[var(--surface)]',
                drag || selectRect ? 'cursor-grabbing' : 'cursor-copy',
              )}
              style={{ height: minToPx(dayMinutes) }}
              onPointerDown={onBackgroundDown}
              onPointerMove={(e) => {
                onBackgroundMove(e);
                onDayPointerMove(e);
              }}
              onPointerUp={(event) => {
                onBackgroundUp(event);
                commitDrag();
              }}
              onDoubleClick={(e) => {
                const rect = dayRef.current!.getBoundingClientRect();
                const min = snap(clampMin(pxToMin(e.clientY - rect.top)));
                setDraft({
                  startMin: Math.min(min, dayMinutes - SNAP_MIN),
                  endMin: Math.min(dayMinutes, min + 60),
                  title: '',
                });
              }}
            >
              {/* 网格线 */}
              {Array.from({ length: Math.ceil(dayMinutes / 60) }, (_, h) => (
                <React.Fragment key={h}>
                  <div
                    className="absolute inset-x-0 border-t border-[var(--border)]"
                    style={{ top: minToPx(h * 60) }}
                  />
                  <div
                    className="absolute inset-x-0 border-t border-dashed border-[var(--border)]/50"
                    style={{ top: minToPx(h * 60 + 30) }}
                  />
                </React.Fragment>
              ))}

              {/* now line */}
              {isToday && (
                <div
                  className="absolute inset-x-0 z-10 animate-pulse-line"
                  style={{ top: minToPx((Date.now() - dayStart) / 60000) }}
                >
                  <div className="h-[2px] bg-gradient-to-r from-[var(--accent-from)] to-transparent" />
                  <span className="absolute -top-2.5 left-0 rounded-full gradient-bg px-1.5 text-[9px] font-bold text-white tabular">
                    {fmtHM(Date.now())}
                  </span>
                </div>
              )}

              {/* 拖划创建选区 */}
              {selectRect && (
                <div
                  className="absolute inset-x-2 rounded-lg border border-dashed border-[var(--accent-from)] bg-[color-mix(in_srgb,var(--accent-from)_12%,transparent)]"
                  style={{
                    top: minToPx(Math.min(selectRect.from, selectRect.to)),
                    height: minToPx(Math.abs(selectRect.to - selectRect.from)),
                  }}
                />
              )}

              {/* 到期任务标记:截止时间点上的虚线块,点击看任务详情 */}
              {dueTasks.map((t) => {
                const m = (t.dueAt! - dayStart) / 60000;
                const color = t.status === 'done' ? 'var(--muted-foreground)' : 'var(--danger)';
                return (
                  <button
                    key={t.id}
                    onClick={() => ui.selectTask(t.id)}
                    onPointerDown={(e) => e.stopPropagation()}
                    className={cn('absolute left-1 right-1 z-[5] flex items-center gap-1 overflow-hidden rounded-lg border border-dashed px-2 text-left transition-transform hover:scale-[1.01]', t.status === 'done' && 'text-muted opacity-60 line-through')}
                    style={{
                      top: minToPx(m) - 9,
                      height: 18,
                      borderColor: `color-mix(in srgb, ${color} 55%, transparent)`,
                      background: `color-mix(in srgb, ${color} 8%, transparent)`,
                    }}
                    title={`截止:${fmtHM(t.dueAt!)} · ${t.title || 'Untitled'}`}
                  >
                    <Clock className="h-3 w-3 shrink-0" style={{ color }} />
                    <span className="truncate text-[11px] font-medium">{t.title || 'Untitled'}</span>
                    <span className="ml-auto shrink-0 text-[9px] tabular" style={{ color }}>
                      {fmtHM(t.dueAt!)}
                    </span>
                  </button>
                );
              })}

              {/* 事件块 */}
              {events.map((ev) => {
                const l = drag?.eventId === ev.id ? { start: drag.curStart, end: drag.curEnd } : localMin(ev);
                const style = EVENT_KIND_STYLE[ev.kind];
                const linked = ev.taskId ? taskById.get(ev.taskId) : null;
                return (
                  <div
                    key={ev.id}
                    data-testid={`event-${ev.id}`}
                    className={cn(
                      'group absolute left-1 right-1 overflow-hidden rounded-lg border px-2 py-1 backdrop-blur-sm transition-shadow',
                      selectedEvent === ev.id && 'ring-2 ring-[var(--ring)] z-10',
                      ev.completed && 'opacity-50',
                    )}
                    style={{
                      top: minToPx(l.start),
                      height: Math.max(18, minToPx(l.end - l.start)),
                      background: style.dim,
                      borderColor: `${style.color}55`,
                    }}
                    onPointerDown={(e) => beginDrag(e, ev, 'move')}
                    onDoubleClick={() => linked && ui.selectTask(linked.id)}
                  >
                    <div
                      className="flex items-center gap-1 text-[11px] font-medium leading-tight"
                      style={{ color: style.color }}
                    >
                      {linked && <Link2 className="h-3 w-3 shrink-0" />}
                      <span className={cn('truncate', ev.completed && 'line-through')}>{ev.title}</span>
                      <span className="ml-auto shrink-0 tabular opacity-70">
                        {fmtHM(dayStart + l.start * 60000)}
                      </span>
                    </div>
                    {l.end - l.start >= 45 && (
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span className="text-[9px] text-muted tabular">{Math.round(l.end - l.start)}m</span>
                        {linked && <Badge className="!px-1 !py-0 !text-[9px]">任务</Badge>}
                      </div>
                    )}
                    {/* 拉伸把手 */}
                    <div
                      className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize opacity-0 transition-opacity group-hover:opacity-100"
                      onPointerDown={(e) => beginDrag(e, ev, 'resize-end')}
                    >
                      <GripHorizontal className="mx-auto h-2 w-4 text-white/60" />
                    </div>
                  </div>
                );
              })}

              {/* 创建气泡 */}
              {draft && (
                <div
                  className="absolute left-1 right-1 z-20 rounded-xl glass-raised p-2"
                  style={{
                    top: minToPx(draft.startMin),
                    height: minToPx(draft.endMin - draft.startMin),
                    minHeight: 56,
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <input
                    autoFocus
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    onKeyDown={(e) => {
                      if (isComposing(e)) return;
                      if (e.key === 'Enter') createDraft();
                      if (e.key === 'Escape') setDraft(null);
                    }}
                    placeholder={`${fmtHM(dayStart + draft.startMin * 60000)} · 标题,回车创建`}
                    className="h-7 w-full bg-transparent text-xs outline-none placeholder:text-muted/60"
                  />
                </div>
              )}

              {/* 选中事件操作条 */}
              {selected && !drag && (
                <div
                  className="absolute right-1 z-30 flex -translate-y-full items-center gap-1 rounded-xl glass-raised px-1.5 py-1"
                  style={{ top: minToPx(localMin(selected).start) }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <button
                    className="rounded-lg p-1.5 text-muted hover:text-foreground"
                    title="完成"
                    onClick={() => store.updateEvent(selected.id, { completed: !selected.completed })}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  {selected.taskId ? (
                    <button
                      className="rounded-lg p-1.5 text-muted hover:text-foreground"
                      title="解除任务关联"
                      onClick={() => store.updateEvent(selected.id, { taskId: null })}
                    >
                      <Unlink className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  <button
                    className="rounded-lg p-1.5 text-[var(--accent-from)] hover:brightness-125"
                    title="开始专注"
                    onClick={() => {
                      timerStart({ mode: 'focus', taskId: selected.taskId });
                      navigate('/focus');
                    }}
                  >
                    ▶
                  </button>
                  <button
                    className="rounded-lg p-1.5 text-muted hover:text-[var(--danger)]"
                    title="删除"
                    onClick={() => {
                      store.softDeleteEvent(selected.id);
                      setSelectedEvent(null);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* 空状态提示(无事件且未选择) */}
            {events.length === 0 && !selectRect && !draft && (
              <div className="pointer-events-none absolute inset-x-0 top-[30%] text-center text-xs text-muted/60">
                拖划创建时间块 · 双击空白 = 1 小时
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 今日待排(桌面坞) */}
      <aside className="hidden w-64 shrink-0 flex-col gap-2 overflow-y-auto border-l border-[var(--border)] p-3 xl:flex">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-semibold text-muted">今日待排</span>
          <span className="text-[10px] text-muted/60">
            {events.length - doneCount} 块 · 完成 {doneCount}
          </span>
        </div>
        {unscheduled.length === 0 && (
          <div className="px-1 py-6 text-center text-xs text-muted/60">今天都排完了 🎉</div>
        )}
        {unscheduled.map((t) => (
          <button
            key={t.id}
            onPointerDown={(e) => onChipPointerDown(e, t.id, t.title)}
            onClick={() => ui.selectTask(t.id)}
            className="touch-none rounded-lg glass px-2.5 py-2 text-left text-xs text-foreground transition-all hover:border-[var(--border-strong)] active:scale-95"
            title="拖到时间轴上安排"
          >
            <div className="truncate">{t.title}</div>
            {t.estimateMin != null && <div className="mt-0.5 text-[10px] text-muted">{t.estimateMin}m</div>}
          </button>
        ))}
        {events.length > 0 && (
          <div className="mt-2 space-y-1">
            <div className="px-1 text-xs font-semibold text-muted">按类型</div>
            {(Object.keys(EVENT_KIND_STYLE) as EventKind[]).map((k) => {
              const n = events.filter((e) => e.kind === k).length;
              if (!n) return null;
              return (
                <div key={k} className="flex items-center gap-2 px-1 text-xs text-muted">
                  <span className="h-2 w-2 rounded-full" style={{ background: EVENT_KIND_STYLE[k].color }} />
                  {EVENT_KIND_STYLE[k].label} × {n}
                </div>
              );
            })}
          </div>
        )}
      </aside>

      {/* 手机待排(底部横向滚动) */}
      <div className="fixed bottom-[72px] left-0 right-0 z-20 xl:hidden">
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-2">
          {unscheduled.slice(0, 6).map((t) => (
            <button
              key={t.id}
              onPointerDown={(e) => onChipPointerDown(e, t.id, t.title)}
              className="shrink-0 touch-none rounded-full glass px-3 py-1.5 text-xs active:scale-95"
            >
              {t.title}
            </button>
          ))}
        </div>
      </div>

      {/* 拖拽 ghost */}
      {dragTask && (
        <div
          className="pointer-events-none fixed z-50 rounded-lg glass-raised px-3 py-1.5 text-xs gradient-text"
          style={{ left: dragTask.x + 10, top: dragTask.y - 12 }}
        >
          {dragTask.title}
        </div>
      )}
    </div>
  );
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function fmtDay(d: Date): string {
  return dayKey(d);
}
