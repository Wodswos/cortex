import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { CalendarClock, ChevronRight, Minus, Plus, Folder } from 'lucide-react';
import { cn } from '@cortex/ui';
import {
  Task, activeTasks, buildChildrenMap, taskRange, startOfWeek, startOfDay, addDays, fmtHM, WEEKDAY_ZH, weekdayOf, calendarDaysBetween, calendarPosition, timeAtCalendarPosition,
  taskViewStatus, TaskViewStatus, priorityOf, isStructural, fullyDoneIds,
} from '@cortex/core';
import { useCortex } from '@cortex/crdt';
import { useTaskViewData } from '../useTaskViewData';
import { useUI } from '@/state/ui';
import { TaskCheckbox, PRIORITY_VAR } from '@/shared/components';
import { ganttDragPatch, ganttDragRange, type GanttDragMode } from './drag';

/**
 * 甘特图:任务树 × 天轴。
 * - 条 = 任务自身的 startAt~dueAt;只设一端时按"当天"补齐另一端(见 core/taskRange)。
 *   无时间任务不画条、默认也不占行(底部「未排期」坞里可以拖进来排期)。
 * - 排期方式:拖条整体平移 / 拖条两端伸缩(**吸附到 5 分钟**,不是整天)/
 *   在行内空白处按下拖出一段 / 从「未排期」坞拖到某一天。
 * - 条的颜色 = 优先级(P0 红 / P1 橙 / P2 蓝 / P3 灰),整条无边框。
 *   未开始 = 浅色透明;已完成 = **绿色**(完成度优先于优先级,一眼可辨);已逾期 = 实色。
 *   逾期条右上角带红色「!」角标;结构节点(kind=node)不画条、不进未排期坞,只作分组行。
 */

const MIN_PX_PER_DAY = 44; // 窗口天数很多时的下限(可横向滚动)
/** 拖拽吸附粒度(分钟):条平移/伸缩都按它取整,而不是整天 */
const SNAP_MIN = 5;
/** 缩放档位:天宽 = 自适应宽度 × 档位;放大后 1px 代表的分钟更小,才拖得动"分" */
const ZOOMS = [1, 2, 4, 8];
const ROW_H = 34;
const NAME_W = 208;
const CHEVRON_W = 16; // 折叠钮占位:无子级的行也留出,保证同深度名字左沿对齐

interface Row {
  task: Task;
  depth: number;
  /** 有显式时间(可画条/可拖);无时间的行只作分组容器 */
  dated: boolean;
  start: number;
  end: number;
  /** 该根任务分组的第一行(用于渲染分组分隔线) */
  groupStart: boolean;
}

/** 条的拖拽:move = 整体平移;start/end = 伸缩开始/截止端(deltaMin 已吸附) */
interface BarDrag {
  mode: GanttDragMode;
  id: string;
  x0: number;
  deltaMin: number;
  visStart: number;
  visEnd: number;
}

/** 行内空白拖拽:为一端按下的天 → 拖到另一端松开,落 startAt~dueAt */
interface Draft {
  taskId: string;
  anchorDay: number;
  curDay: number;
}

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 状态点(名字列左侧小圆点),颜色与 StatusBadge 语义一致 */
const STATUS_DOT: Record<TaskViewStatus, string> = {
  done: 'bg-[var(--muted-foreground)]',
  overdue: 'bg-[var(--danger)]',
  planned: 'bg-[var(--accent-from)]',
  running: 'bg-[var(--success)]',
  todo: 'bg-[var(--muted-foreground)]/50',
  inbox: 'bg-[var(--muted-foreground)]/60',
  archived: 'bg-[var(--muted-foreground)]/40',
};

const hasDates = (t: Task) => t.startAt != null || t.dueAt != null;

/** 拖拽位移的人话描述:+90 → "1 小时 30 分" */
function fmtDeltaMin(min: number): string {
  const sign = min < 0 ? '-' : '+';
  const a = Math.abs(min);
  const d = Math.floor(a / 1440);
  const h = Math.floor((a % 1440) / 60);
  const m = a % 60;
  const parts = [d ? `${d} 天` : '', h ? `${h} 小时` : '', m ? `${m} 分` : ''].filter(Boolean);
  return sign + (parts.join(' ') || '0 分');
}

export function GanttView() {
  const data = useTaskViewData();
  const store = useCortex();
  const ui = useUI();
  const collapsed = useUI((s) => s.collapsed);
  const [params] = useSearchParams();
  const projectId = params.get('project');
  const location = useLocation();
  const scope = params.get('scope');
  const weekStartsOn = data.settings.weekStartsOn;
  /** 时间窗口:默认本周(周一 → 周日) */
  const [winStart, setWinStart] = useState(() => startOfWeek(new Date(), weekStartsOn));
  const [winDays, setWinDays] = useState(7);
  useEffect(() => {
    if (scope === 'week') {
      setWinStart(startOfWeek(new Date(), weekStartsOn));
      setWinDays(7);
    }
  }, [scope, weekStartsOn, location.key]);
  const [dragging, setDragging] = useState<BarDrag | null>(null);
  const dragRef = useRef<BarDrag | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  /** 天宽缩放档位(1/2/4/8):放大后时间轴更细,才拖得动分钟 */
  const [zoom, setZoom] = useState(1);
  /** 未排期坞:拖拽 ghost */
  const [trayDrag, setTrayDrag] = useState<{ taskId: string; title: string; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** 滚动容器宽度 → 列宽自适应:窗口天数少时天格铺满屏宽,不再挤成一小条 */
  const [boxW, setBoxW] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setBoxW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const winStartTime = startOfDay(winStart).getTime();
  const dayAt = (index: number) => addDays(startOfDay(winStart), index).getTime();
  const winEndTime = dayAt(winDays);

  const tasks = useMemo(
    () => activeTasks(data.tasks).filter((t) => t.status !== 'inbox'),
    [data.tasks],
  );
  const childrenMap = useMemo(() => buildChildrenMap(tasks), [tasks]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const hiddenDone = useMemo(() => data.settings.completedDisplay === 'hidden' ? fullyDoneIds(tasks) : null, [tasks, data.settings.completedDisplay]);

  /** 行 = 自身有日期且与窗口重叠的任务 + 其祖先链(祖先无日期则只作分组行,不画条) */
  const rows = useMemo(() => {
    // 1) 与窗口重叠的任务集合(只认显式日期)
    const overlap = new Set<string>();
    for (const t of tasks) {
      if (!hasDates(t) || isStructural(t) || hiddenDone?.has(t.id)) continue; // 结构节点无排期,不产生条
      const r = taskRange(t);
      if (r.start < winEndTime && r.end >= winStartTime) overlap.add(t.id);
    }
    // 2) 补齐祖先链(祖先自身无时间也显示,作为分组容器)
    const visible = new Set<string>();
    for (const id of overlap) {
      visible.add(id);
      let cur = byId.get(id)?.parentId ?? null;
      while (cur) {
        if (visible.has(cur)) break;
        visible.add(cur);
        cur = byId.get(cur)?.parentId ?? null;
      }
    }
    // 3) 树序展开:父行永远排在子行之前(同深度靠 groupBase 分段;被折叠的子树跳过)
    const out: Row[] = [];
    const walk = (t: Task, depth: number, groupBase: number) => {
      if (visible.has(t.id)) {
        const dated = hasDates(t) && !isStructural(t);
        const r = dated ? taskRange(t) : { start: 0, end: 0 };
        out.push({ task: t, depth, dated, start: r.start, end: r.end, groupStart: out.length === groupBase });
      }
      if (!collapsed[t.id]) {
        for (const c of childrenMap.get(t.id) ?? []) walk(c, visible.has(t.id) ? depth + 1 : depth, groupBase);
      }
    };
    for (const root of childrenMap.get(projectId) ?? []) walk(root, 0, out.length);
    return out;
  }, [tasks, childrenMap, byId, projectId, hiddenDone, winStartTime, winEndTime, collapsed]);

  /** 未排期任务(无开始/截止):从底部坞拖到图上某一天即完成排期 */
  const unscheduled = useMemo(
    () => tasks.filter((t) => !hasDates(t) && !isStructural(t) && t.status !== 'done' && t.status !== 'archived').slice(0, 12),
    [tasks],
  );

  const days = winDays;
  /** 列宽 = max(44, (容器宽 - 名字列) / 天数) × 缩放档位 */
  const fitPerDay = Math.max(MIN_PX_PER_DAY, boxW > NAME_W + 120 ? (boxW - NAME_W - 8) / days : MIN_PX_PER_DAY);
  const pxPerDay = fitPerDay * zoom;
  const xOf = (t: number) => calendarPosition(t, winStartTime) * pxPerDay;
  const todayX = xOf(Date.now());
  const todayIdx = calendarDaysBetween(winStartTime, Date.now());

  const dayFromEvent = (clientX: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(days - 1, Math.floor((clientX - rect.left) / pxPerDay)));
  };

  // ---------- 条:平移 / 两端伸缩(按分钟吸附) ----------
  const beginBarDrag = (e: React.PointerEvent, r: Row, mode: BarDrag['mode']) => {
    if (!r.dated || e.button !== 0) return; // 无时间的分组行没有条,不可拖
    if (mode !== 'move') e.stopPropagation(); // 把手不能冒泡成整体平移
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const next = { mode, id: r.task.id, x0: e.clientX, deltaMin: 0, visStart: r.start, visEnd: r.end };
    dragRef.current = next;
    setDragging(next);
  };
  const projectBarDrag = (dragging: BarDrag, clientX: number): BarDrag => {
    const positionDelta = (clientX - dragging.x0) / pxPerDay;
    const anchor = dragging.mode === 'end' ? dragging.visEnd : dragging.visStart;
    const raw = (timeAtCalendarPosition(calendarPosition(anchor, winStartTime) + positionDelta, winStartTime) - anchor) / 60000;
    let d = Math.round(raw / SNAP_MIN) * SNAP_MIN; // 吸附到 5 分钟
    const spanMin = Math.max(0, Math.round((dragging.visEnd - dragging.visStart) / 60000));
    if (dragging.mode === 'start') d = Math.min(d, spanMin); // 开始不许拖过截止
    if (dragging.mode === 'end') d = Math.max(d, -spanMin); // 截止不许拖过开始
    return { ...dragging, deltaMin: d };
  };
  const onBarPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const next = projectBarDrag(dragRef.current, e.clientX);
    dragRef.current = next;
    setDragging(next);
  };
  const cancelBarDrag = () => { dragRef.current = null; setDragging(null); };
  const onBarPointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dragging = projectBarDrag(dragRef.current, e.clientX);
    const t = store.getData().tasks.find((x) => x.id === dragging.id && !x.deletedAt);
    if (t && dragging.deltaMin !== 0) {
      const range = ganttDragRange({ start: dragging.visStart, end: dragging.visEnd }, dragging.mode, dragging.deltaMin);
      store.stopUndoCapture();
      store.updateTask(t.id, ganttDragPatch(t, range, dragging.mode));
      store.stopUndoCapture();
      suppressClick.current = true; // 拖完不吃 click(不弹详情)
    }
    cancelBarDrag();
  };

  // ---------- 行内空白:按下为一端,拖到另一端松开 = 设定范围(按天) ----------
  const onTrackDown = (e: React.PointerEvent, r: Row) => {
    if (e.button !== 0) return;
    if (isStructural(r.task)) return; // 结构节点不排期:空白拖拽对它无效
    if (e.target !== e.currentTarget) return; // 只在空白轨道上起手(条/把手/预览不算)
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const day = dayFromEvent(e.clientX, e.currentTarget as HTMLElement);
    setDraft({ taskId: r.task.id, anchorDay: day, curDay: day });
  };
  const onTrackMove = (e: React.PointerEvent, r: Row) => {
    if (!draft || draft.taskId !== r.task.id) return;
    const day = dayFromEvent(e.clientX, e.currentTarget as HTMLElement);
    if (day !== draft.curDay) setDraft({ ...draft, curDay: day });
  };
  const onTrackUp = (r: Row) => {
    if (!draft || draft.taskId !== r.task.id) return;
    const lo = Math.min(draft.anchorDay, draft.curDay);
    const hi = Math.max(draft.anchorDay, draft.curDay);
    const t = tasks.find((x) => x.id === draft.taskId);
    // 已有日期的任务要求真拖出 ≥1 天才改写,避免误点覆盖既有范围;无日期任务点一下=排一天
    if (t && (hi > lo || !hasDates(t))) {
      store.updateTask(t.id, {
        startAt: dayAt(lo), // 当天 00:00
        dueAt: dayAt(hi + 1) - 60_000, // 末天 23:59
      });
      store.stopUndoCapture();
    }
    setDraft(null);
  };

  // ---------- 未排期坞:拖任务到图上某一天 ----------
  const onTrayPointerDown = (e: React.PointerEvent, t: Task) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => setTrayDrag({ taskId: t.id, title: t.title, x: ev.clientX, y: ev.clientY });
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setTrayDrag(null);
      const track = [...document.querySelectorAll<HTMLElement>('[data-gantt-track]')].find((el) => {
        const rc = el.getBoundingClientRect();
        return ev.clientX >= rc.left && ev.clientX <= rc.right && ev.clientY >= rc.top && ev.clientY <= rc.bottom;
      });
      if (!track) return;
      const day = dayFromEvent(ev.clientX, track);
      store.updateTask(t.id, {
        startAt: dayAt(day),
        dueAt: dayAt(day + 1) - 60_000,
      });
      store.stopUndoCapture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const fmtMD = (t: number) => {
    const d = new Date(t);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const preset = (label: string, fn: () => void, active: boolean) => (
    <button
      key={label}
      onClick={fn}
      className={cn(
        'rounded-full px-2.5 py-1 text-xs transition-all',
        active ? 'gradient-bg text-white' : 'glass text-muted hover:text-foreground',
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 窗口选择:默认本周;预设 + 起止日期 + 缩放 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-3 md:px-6">
        {preset('本周', () => { setWinStart(startOfWeek(new Date(), weekStartsOn)); setWinDays(7); }, winDays === 7 && startOfDay(winStart).getTime() === startOfDay(startOfWeek(new Date(), weekStartsOn)).getTime())}
        {preset('下周', () => { setWinStart(addDays(startOfWeek(new Date(), weekStartsOn), 7)); setWinDays(7); }, winDays === 7 && startOfDay(winStart).getTime() === startOfDay(addDays(startOfWeek(new Date(), weekStartsOn), 7)).getTime())}
        {preset('本月', () => { const n = new Date(); setWinStart(new Date(n.getFullYear(), n.getMonth(), 1)); setWinDays(new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate()); }, false)}
        {preset('近 30 天', () => { setWinStart(startOfDay(new Date())); setWinDays(30); }, winDays === 30 && startOfDay(winStart).getTime() === startOfDay(new Date()).getTime())}
        <div className="flex items-center gap-1 text-xs text-muted">
          <input
            type="date"
            value={isoDay(winStart)}
            onChange={(e) => e.target.value && setWinStart(new Date(`${e.target.value}T00:00:00`))}
            className="h-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-foreground outline-none"
          />
          <span>~</span>
          <input
            type="date"
            value={isoDay(new Date(dayAt(winDays - 1)))}
            min={isoDay(winStart)}
            onChange={(e) => {
              if (!e.target.value) return;
              const end = new Date(`${e.target.value}T00:00:00`).getTime();
              setWinDays(Math.max(1, calendarDaysBetween(winStartTime, end) + 1));
            }}
            className="h-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-foreground outline-none"
          />
        </div>
        {/* 缩放:放大时间轴,拖动才能精确到分钟 */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])}
            disabled={zoom === ZOOMS[0]}
            className="flex h-7 w-7 items-center justify-center rounded-lg glass text-muted transition-all hover:text-foreground disabled:opacity-30"
            title="时间轴缩小"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="w-8 text-center text-[10px] tabular text-muted">{zoom}×</span>
          <button
            onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])}
            disabled={zoom === ZOOMS[ZOOMS.length - 1]}
            className="flex h-7 w-7 items-center justify-center rounded-lg glass text-muted transition-all hover:text-foreground disabled:opacity-30"
            title="时间轴放大(拖条可按 5 分钟微调)"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <span className="ml-auto hidden items-center gap-2 text-[10px] text-muted/60 lg:inline-flex">
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />进行中</span>
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-from)]" />未开始</span>
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[var(--danger)]" />已逾期</span>
          <span className="text-muted/40">|</span>
          <span>条色 = 优先级</span>
          {(['P0', 'P1', 'P2', 'P3'] as const).map((p) => (
            <span key={p} className="flex items-center gap-1">
              <span className="h-2 w-3 rounded-sm" style={{ background: PRIORITY_VAR[p] }} />
              {p}
            </span>
          ))}
          <span className="text-muted/40">·</span>
          <span>淡条 = 未开始</span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-3 rounded-sm" style={{ background: 'color-mix(in srgb, var(--success) 75%, transparent)' }} />
            已完成
          </span>
        </span>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto pb-6">
        <div className="inline-block min-w-full">
          {/* 日期表头(sticky top) */}
          <div className="sticky top-0 z-20 flex bg-[var(--background)]/95 backdrop-blur">
            <div className="sticky left-0 z-10 shrink-0 border-b border-r border-[var(--border)] bg-[var(--background)]/95" style={{ width: NAME_W }} />
            <div className="flex border-b border-[var(--border)]" style={{ width: days * pxPerDay, minWidth: days * pxPerDay }}>
              {Array.from({ length: days }, (_, i) => {
                const d = new Date(dayAt(i));
                const isToday = i === todayIdx;
                const weekend = [6, 0].includes(d.getDay());
                return (
                  <div
                    key={i}
                    className={cn(
                      'shrink-0 border-r border-[var(--border)]/50 py-1 text-center',
                      weekend && 'bg-[var(--surface)]/60',
                      isToday && 'bg-[color-mix(in_srgb,var(--accent-from)_10%,transparent)]',
                    )}
                    style={{ width: pxPerDay }}
                  >
                    <div className={cn('text-[9px]', isToday ? 'gradient-text font-bold' : 'text-muted/70')}>{fmtMD(dayAt(i))}</div>
                    <div className={cn('text-[9px]', isToday && 'font-bold')}>{WEEKDAY_ZH[weekdayOf(d) - 1]}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 行 */}
          {rows.map((r, idx) => {
            const isDragging = dragging?.id === r.task.id;
            const vs = taskViewStatus(r.task);
            const p = priorityOf(r.task);
            const pColor = PRIORITY_VAR[p];
            const visibleRange = isDragging
              ? ganttDragRange({ start: dragging.visStart, end: dragging.visEnd }, dragging.mode, dragging.deltaMin)
              : { start: r.start, end: r.end };
            const barW = Math.max(8, xOf(r.end) - xOf(r.start));
            const hasKids = (childrenMap.get(r.task.id)?.length ?? 0) > 0;
            return (
              <React.Fragment key={r.task.id}>
                {r.groupStart && idx > 0 && <div className="gantt-group-sep h-2 border-t border-[var(--border-strong)]/40" />}
                <div
                  className="group flex border-b border-[var(--border)]/40 hover:bg-[var(--surface)]/40"
                  onContextMenu={(e) => {
                    e.preventDefault(); // 行/条/轨道上右击都是应用的 TaskMenu,不是浏览器原生菜单
                    ui.openTaskMenu(r.task.id, e.clientX, e.clientY);
                  }}
                >
                  <div className="sticky left-0 z-10 flex shrink-0 items-center gap-1 bg-[var(--background)] px-2 py-1" style={{ width: NAME_W }}>
                    <span style={{ width: (r.depth === 0 ? 0 : 14 * r.depth) + 8 }} className="shrink-0" />
                    {/* 折叠钮:没有子级也占同样宽度的位置,否则同深度的名字会左移、看着像"子任务跑到父任务前面" */}
                    {hasKids ? (
                      <button
                        onClick={() => ui.toggleCollapsed(r.task.id)}
                        className="flex shrink-0 items-center justify-center text-muted hover:text-foreground"
                        style={{ width: CHEVRON_W }}
                      >
                        <ChevronRight className={cn('h-3 w-3 transition-transform', !collapsed[r.task.id] && 'rotate-90')} />
                      </button>
                    ) : (
                      <span className="shrink-0" style={{ width: CHEVRON_W }} />
                    )}
                    {isStructural(r.task) ? (
                      <span className="grid w-3.5 shrink-0 place-items-center text-muted/60" title="结构节点(无完成态)">
                        <Folder className="h-3 w-3" />
                      </span>
                    ) : (
                      <>
                        <TaskCheckbox done={r.task.status === 'done'} onChange={() => store.toggleTaskDone(r.task.id)} className="!h-3.5 !w-3.5 shrink-0" />
                        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[vs.kind])} title={vs.label} />
                      </>
                    )}
                    <button
                      onClick={() => ui.selectTask(r.task.id)}
                      className={cn(
                        'min-w-0 flex-1 truncate text-left text-xs hover:underline',
                        (r.depth === 0 || isStructural(r.task)) && 'font-medium',
                        r.task.status === 'done' && 'text-muted line-through',
                      )}
                      title={r.task.notes || r.task.title}
                    >
                      {r.task.title || 'Untitled'}
                    </button>
                  </div>
                  <div
                    data-gantt-track
                    onPointerDown={(e) => onTrackDown(e, r)}
                    onPointerMove={(e) => onTrackMove(e, r)}
                    onPointerUp={() => onTrackUp(r)}
                    className="relative cursor-crosshair"
                    style={{ width: days * pxPerDay, minWidth: days * pxPerDay, height: ROW_H }}
                  >
                    {/* 周末底纹/今日线不接指针,保证空白起手 target === 轨道本身 */}
                    {Array.from({ length: days }, (_, i) => {
                      const d = new Date(dayAt(i));
                      return [6, 0].includes(d.getDay()) ? (
                        <div key={i} className="pointer-events-none absolute inset-y-0 bg-[var(--surface)]/40" style={{ left: i * pxPerDay, width: pxPerDay }} />
                      ) : null;
                    })}
                    {todayX >= 0 && todayX <= days * pxPerDay && (
                      <div className="pointer-events-none absolute inset-y-0 z-10 w-[2px] bg-[var(--accent-from)]/70" style={{ left: todayX }} />
                    )}

                    {/* 空白拖拽预览:按下端 → 拖至另一端 */}
                    {draft?.taskId === r.task.id && (
                      <div
                        className="pointer-events-none absolute inset-y-1 z-[6] rounded-md border border-dashed border-[var(--accent-from)] bg-[color-mix(in_srgb,var(--accent-from)_14%,transparent)]"
                        style={{
                          left: Math.min(draft.anchorDay, draft.curDay) * pxPerDay,
                          width: (Math.abs(draft.curDay - draft.anchorDay) + 1) * pxPerDay,
                        }}
                      />
                    )}

                    {/* 无时间的行不画条(只作分组容器):曾经的"子树聚合细条"会被误读成排期 */}
                    {r.dated && (
                      <div
                        data-gantt-bar={r.task.id}
                        onPointerDown={(e) => beginBarDrag(e, r, 'move')}
                        onPointerMove={onBarPointerMove}
                        onPointerUp={onBarPointerUp}
                        onPointerCancel={cancelBarDrag}
                        onLostPointerCapture={cancelBarDrag}
                        onClick={() => {
                          if (suppressClick.current) {
                            suppressClick.current = false;
                            return;
                          }
                          ui.selectTask(r.task.id);
                        }}
                        className={cn(
                          'absolute top-1/2 flex -translate-y-1/2 items-center overflow-hidden rounded-md text-[10px] text-white shadow-sm',
                          'h-5 cursor-grab touch-none select-none active:cursor-grabbing',
                          vs.kind === 'done' && 'text-white/80',
                          isDragging && 'shadow-lg ring-2 ring-white/70',
                        )}
                        style={{
                          left: xOf(visibleRange.start),
                          width: Math.max(8, xOf(visibleRange.end) - xOf(visibleRange.start)),
                          // 整条无边框:未开始 = 浅色透明的优先级色;已完成 = 绿色(完成态优先于优先级色);其余 = 实心优先级色
                          background:
                            vs.kind === 'done'
                              ? 'color-mix(in srgb, var(--success) 75%, transparent)'
                              : vs.kind === 'planned'
                                ? `color-mix(in srgb, ${pColor} 26%, transparent)`
                                : pColor,
                          color: vs.kind === 'planned' ? pColor : '#fff',
                        }}
                        title={`${r.task.title || 'Untitled'} · ${p} · ${vs.label} · ${fmtMD(visibleRange.start)} ${fmtHM(visibleRange.start)} ~ ${fmtMD(visibleRange.end)} ${fmtHM(visibleRange.end)}${isDragging && dragging ? ` → ${dragging.mode === 'move' ? '平移' : dragging.mode === 'start' ? '开始端' : '截止端'} ${fmtDeltaMin(dragging.deltaMin)}` : ''}`}
                      >
                        {barW > 60 && (
                          <span className="truncate px-2 leading-none">{r.task.title || 'Untitled'}</span>
                        )}
                        {/* 逾期角标「!」:红底白字,呼应用户对超时的强提醒;完成/未开始不加角标(颜色已表达) */}
                        {vs.kind === 'overdue' && (
                          <span className="absolute right-0.5 top-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-[var(--danger)] text-[8px] font-bold leading-none text-white ring-1 ring-white/60">!</span>
                        )}
                        {/* 两端伸缩把手(精确到 5 分钟) */}
                        {barW >= 36 && (
                          <>
                            <div
                              onPointerDown={(e) => beginBarDrag(e, r, 'start')}
                              className="absolute inset-y-0 left-0 w-2 cursor-ew-resize hover:bg-white/30"
                              title="拖动调整开始时间(5 分钟粒度)"
                            />
                            <div
                              onPointerDown={(e) => beginBarDrag(e, r, 'end')}
                              className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-white/30"
                              title="拖动调整截止时间(5 分钟粒度)"
                            />
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </React.Fragment>
            );
          })}
          {rows.length === 0 && (
            <div className="p-10 text-center text-sm text-muted/60">
              该时间窗口内没有排期任务;在行内空白处拖拽可设定时间范围,或把下方「未排期」任务拖进来
            </div>
          )}
        </div>
      </div>

      {/* 未排期坞:无开始/截止的任务,拖到图上某一天即排期 */}
      {unscheduled.length > 0 && (
        <div className="shrink-0 border-t border-[var(--border)] px-4 py-2 md:px-6">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] text-muted">
            <CalendarClock className="h-3 w-3" />
            <span>未排期({unscheduled.length})</span>
            <span className="text-muted/60">· 拖到上面某一天 = 排那一天;再拖条两端可精确到 5 分钟</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {unscheduled.map((t) => (
              <button
                key={t.id}
                onPointerDown={(e) => onTrayPointerDown(e, t)}
                onClick={() => ui.selectTask(t.id)}
                onContextMenu={(e) => { e.preventDefault(); ui.openTaskMenu(t.id, e.clientX, e.clientY); }}
                className="touch-none rounded-full glass px-2.5 py-1 text-[11px] text-foreground transition-all hover:border-[var(--border-strong)] active:scale-95"
                title="拖到甘特图上排期;点按看详情"
              >
                {t.title || 'Untitled'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 拖拽 ghost */}
      {trayDrag && (
        <div
          className="pointer-events-none fixed z-50 rounded-lg glass-raised px-3 py-1.5 text-xs gradient-text"
          style={{ left: trayDrag.x + 10, top: trayDrag.y - 12 }}
        >
          {trayDrag.title || 'Untitled'}
        </div>
      )}
    </div>
  );
}
