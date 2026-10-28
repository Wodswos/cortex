import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragMoveEvent,
  DragOverEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type CollisionDetection,
  type Modifier,
  DragOverlay,
} from '@dnd-kit/core';
import { getEventCoordinates } from '@dnd-kit/utilities';
import { ChevronRight, Play, Plus, MoreHorizontal, Folder, GripVertical } from 'lucide-react';
import { cn, EmptyState, Badge } from '@cortex/ui';
import {
  Task,
  TaskFilter,
  activeTasks,
  buildChildrenMap,
  groupRoots,
  inboxTasks,
  fullyDoneIds,
  canReparent,
  newOrder,
  gapTooSmall,
  endOfDay,
  addDays,
  PRIORITY_ORDER,
  isStructural,
  startOfDay,
  startOfWeek,
  matchFilter,
  descendantsOf,
  priorityOf,
  workProgress,
} from '@cortex/core';
import { useCortex, useCortexData } from '@cortex/crdt';
import { useUI } from '@/state/ui';
import { useTimer } from '@/focus/timer';
import {
  TaskCheckbox,
  DueBadge,
  PriorityDot,
  SubtreeProgress,
  TagChip,
  StatusBadge,
} from '@/shared/components';
import { TaskInspector } from '@/shared/TaskInspector';
import { isComposing } from '@/shared/ime';
import { projectTaskDrop, TASK_INDENT, type TaskDrop } from './drop';

/** 过滤 chips */
const FILTERS: { key: TaskFilter['kind']; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'today', label: '今天' },
  { key: 'next7', label: '未来 7 天' },
  { key: 'high', label: '高优先级' },
  { key: 'unscheduled', label: '无日期' },
];

/** Keep the compact preview beside the pointer, even when dragging a wide title. */
const previewBesidePointer: Modifier = ({ activatorEvent, activeNodeRect, overlayNodeRect, windowRect, transform }) => {
  const origin = activatorEvent ? getEventCoordinates(activatorEvent) : null;
  if (!origin || !activeNodeRect) return transform;
  const width = overlayNodeRect?.width ?? 280;
  const height = overlayNodeRect?.height ?? 80;
  const left = origin.x + transform.x + 12;
  const top = origin.y + transform.y + 12;
  return {
    ...transform,
    x: Math.max(8, Math.min(left, (windowRect?.right ?? innerWidth) - width - 8)) - activeNodeRect.left,
    y: Math.max(8, Math.min(top, (windowRect?.bottom ?? innerHeight) - height - 8)) - activeNodeRect.top,
  };
};

export function ListView() {
  const data = useCortexData();
  const store = useCortex();
  const ui = useUI();
  const [now] = useState(() => new Date());
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<TaskDrop | null>(null);
  const [dropMessage, setDropMessage] = useState('');
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }),
  );
  // 列表多选:单击=单选,Shift+单击=区间,⌘/Ctrl+单击=增减
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const selectionEpoch = useRef(0);
  // 新建任务后要聚焦并进入编辑的 id
  const [focusNewId, setFocusNewId] = useState<string | null>(null);
  /** 批量挂载模式:多选后点「挂到…」,再点任意行 = 把选中的一批挂到它下面 */
  const [pickAttach, setPickAttach] = useState(false);

  const [params] = useSearchParams();
  const scope = params.get('scope');
  const projectId = params.get('project');
  const [newTitle, setNewTitle] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const saveGeneration = useRef(0);
  const [detailsDocked, setDetailsDocked] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const update = () => setDetailsDocked(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const captureRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  useEffect(() => {
    ui.setFilter({ kind: 'all' });
    setSelectedIds([]);
  }, [scope, projectId]);
  const filter = ui.filter;
  const showDone = (data.settings.completedDisplay ?? 'inline-gray') !== 'hidden';
  const active = useMemo(() => activeTasks(data.tasks).filter((t) => t.status !== 'inbox'), [data.tasks]);
  const allChildren = useMemo(() => buildChildrenMap(active), [active]);
  const byId = useMemo(() => new Map(active.map((task) => [task.id, task])), [active]);
  const draggedIds = useMemo(
    () => activeDragId ? descendantsOf(activeDragId, allChildren).add(activeDragId) : new Set<string>(),
    [activeDragId, allChildren],
  );
  const visibleTasks = useMemo(() => {
    const projectIds = projectId ? descendantsOf(projectId, allChildren).add(projectId) : null;
    const pool = active.filter((task) => !projectIds || projectIds.has(task.id));
    if (!scope && filter.kind === 'all') return pool;
    const byId = new Map(pool.map((task) => [task.id, task]));
    const keep = new Set<string>();
    const start =
      scope === 'week' ? startOfWeek(now, data.settings.weekStartsOn).getTime() : startOfDay(now).getTime();
    const end = scope === 'week' ? addDays(start, 7).getTime() : endOfDay(now).getTime();
    for (const task of pool) {
      if (
        scope &&
        (isStructural(task) ||
          task.status === 'done' ||
          task.dueAt == null ||
          task.dueAt < start ||
          task.dueAt >= end)
      )
        continue;
      if (!matchFilter(task, filter, now)) continue;
      let current: Task | undefined = task;
      while (current && !keep.has(current.id)) {
        keep.add(current.id);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
    }
    return pool.filter((task) => keep.has(task.id));
  }, [active, allChildren, projectId, scope, filter, now, data.settings.weekStartsOn]);
  const childrenMap = useMemo(() => buildChildrenMap(visibleTasks), [visibleTasks]);
  const progressMap = useMemo(() => workProgress(active), [active]);
  // 隐藏模式:整棵子树都完成的行不再渲染(根级过滤在 groupRoots,子级在这里)
  const hiddenDone = useMemo(() => (showDone ? null : fullyDoneIds(data.tasks)), [data.tasks, showDone]);

  // 分组只对「根级」;子树跟随父级展示
  const groups = useMemo(
    () => groupRoots(visibleTasks, now, undefined, { showDone }),
    [visibleTasks, now, showDone],
  );

  /** 每组展开后的可见行:从组内根任务 DFS(子树跟随父级,应用折叠状态) */
  const rowsByGroup = useMemo(() => {
    const collapsed = new Set(
      Object.entries(ui.collapsed)
        .filter(([, v]) => v)
        .map(([k]) => k),
    );
    return groups.map((g) => {
      const rows: { task: Task; depth: number; hasChildren: boolean }[] = [];
      const walk = (parentId: string | null, depth: number) => {
        for (const t of childrenMap.get(parentId) ?? []) {
          if (hiddenDone?.has(t.id)) continue;
          const kids = childrenMap.get(t.id) ?? [];
          rows.push({ task: t, depth, hasChildren: kids.length > 0 });
          if (kids.length && !collapsed.has(t.id)) walk(t.id, depth + 1);
        }
      };
      for (const root of g.tasks) {
        rows.push({ task: root, depth: 0, hasChildren: (childrenMap.get(root.id) ?? []).length > 0 });
        if (!collapsed.has(root.id)) walk(root.id, 1);
      }
      return { ...g, rows };
    });
  }, [groups, childrenMap, ui.collapsed, hiddenDone]);

  // 可见行(含子树)的展示顺序 → 用索引算 shift 区间
  const flatOrder = useMemo(() => rowsByGroup.flatMap((g) => g.rows.map((r) => r.task.id)), [rowsByGroup]);
  const rowsById = useMemo(
    () => new Map(rowsByGroup.flatMap((group) => group.rows.map((row) => [row.task.id, row] as const))),
    [rowsByGroup],
  );
  const dropIndicatorId = useMemo(() => {
    if (!drop) return null;
    if (drop.groupedRoot || drop.placement !== 'after') return drop.anchorId;
    // "After" means after the entire branch, not between a parent and its children.
    const branch = descendantsOf(drop.anchorId, allChildren).add(drop.anchorId);
    return flatOrder.filter((id) => branch.has(id) && !draggedIds.has(id)).at(-1) ?? drop.anchorId;
  }, [drop, allChildren, flatOrder, draggedIds]);
  const rootGroups = useMemo(
    () => new Map(groups.flatMap((group) => group.tasks.map((task) => [task.id, group.key] as const))),
    [groups],
  );
  const dragRootGroup = useMemo(() => {
    const task = activeDragId ? byId.get(activeDragId) : null;
    return task ? groupRoots([{ ...task, parentId: null }], now).find((group) => group.tasks.length)?.key : null;
  }, [activeDragId, byId, now]);
  const resolveDrop = useCallback((
    id: string,
    row: { task: Task; depth: number },
    pointer: { x: number; y: number },
    rect: { left: number; top: number; height: number },
  ): { intent: TaskDrop | null; message?: string } => {
    const intent = projectTaskDrop(id, row, pointer, rect, allChildren, byId);
    // Root groups are date-based. Sorting cannot silently change a task's dates.
    if (intent?.parentId === null && rootGroups.get(intent.anchorId) !== dragRootGroup) {
      if (intent.anchorId !== row.task.id) intent.groupedRoot = true;
      else return { intent: null, message: '顶层按日期分组，同组内可排序；拖到行中部可关联' };
    }
    return { intent };
  }, [allChildren, byId, rootGroups, dragRootGroup]);
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const pointer = args.pointerCoordinates;
    pointerRef.current = pointer;
    const viewport = listRef.current?.getBoundingClientRect();
    if (!pointer || !viewport || pointer.x < viewport.left || pointer.x > viewport.right
      || pointer.y < viewport.top || pointer.y > viewport.bottom) return [];
    for (const container of args.droppableContainers) {
      if (container.disabled || draggedIds.has(String(container.id))) continue;
      const rect = args.droppableRects.get(container.id);
      const row = container.data.current as { task: Task; depth: number } | undefined;
      if (!rect || !row) continue;
      // Extend the hit area into the indentation gutter, but never into the sidebar/detail pane.
      const left = rect.left - row.depth * TASK_INDENT;
      if (pointer.y < rect.top || pointer.y > rect.bottom || pointer.x < left || pointer.x > rect.right) continue;
      const result = resolveDrop(String(args.active.id), row, pointer, rect);
      if (!result.intent && !result.message) return [];
      return [{ id: container.id, data: { droppableContainer: container, value: 0, ...result } }];
    }
    return [];
  }, [draggedIds, resolveDrop]);

  /** 批量挂载:把选中的一批挂到 target 下(排在末尾);环/选区内目标自动跳过,一个撤销单元 */
  const attachSelectedTo = (targetId: string) => {
    if (selectedIds.includes(targetId)) return; // 点到选区内:忽略
    const target = data.tasks.find((t) => t.id === targetId);
    if (!target || target.deletedAt) return;
    const kids = allChildren.get(targetId) ?? [];
    let order = newOrder(kids.at(-1)?.order);
    let moved = 0;
    for (const id of selectedIds) {
      if (!canReparent(id, targetId, allChildren)) continue;
      store.reparent(id, targetId, order);
      order += 1;
      moved++;
    }
    if (moved > 0) store.stopUndoCapture(); // 整批 = 一次撤销
    setPickAttach(false);
    if (moved > 0) clearSelection();
  };

  const handleSelect = (id: string, e: React.MouseEvent) => {
    selectionEpoch.current++;
    if (pickAttach) {
      // 挂载模式下点击 = 选目标,不改选区
      e.stopPropagation();
      attachSelectedTo(id);
      return;
    }
    if (e.shiftKey && anchorId) {
      const a = flatOrder.indexOf(anchorId);
      const b = flatOrder.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelectedIds(flatOrder.slice(lo, hi + 1));
        return;
      }
    }
    if (e.metaKey || e.ctrlKey) {
      setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
      setAnchorId(id);
      return;
    }
    setSelectedIds([id]);
    setAnchorId(id);
    if (window.matchMedia('(max-width: 1023px)').matches) ui.selectTask(id);
  };

  const clearSelection = async () => {
    const epoch = ++selectionEpoch.current;
    const focused = document.activeElement as HTMLElement | null;
    if (focused?.closest('[data-inspector]')) focused.blur();
    try {
      await store.flushPersistence();
    } catch {
      setSaveStatus('保存失败，请保留此页面并从设置导出备份');
      return;
    }
    if (epoch !== selectionEpoch.current) return;
    setSelectedIds([]);
    setAnchorId(null);
  };

  // 点击列表背景(非行/非详情小窗/非按钮)时取消小窗与多选
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest('[data-row], [data-inspector], button, a, input, textarea, select')) return;
      clearSelection();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 软删一颗子树:自身 + 所有后代,一并收集并删除 */
  const softDeleteSubtree = (rootId: string) => {
    const ids = new Set<string>();
    const stack = [rootId];
    while (stack.length) {
      const cur = stack.pop()!;
      if (ids.has(cur)) continue;
      ids.add(cur);
      for (const c of childrenMap.get(cur) ?? []) stack.push(c.id);
    }
    for (const id of ids) store.softDeleteTask(id);
  };

  // Esc 取消「挂到…」拾取模式
  useEffect(() => {
    if (!pickAttach) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPickAttach(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickAttach]);

  // Delete/⌫ :有选中就整批软删(连带子树),没有选中则交给行内 Backspace 处理
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select') || t?.isContentEditable) return;
      if (selectedIds.length === 0) return;
      e.preventDefault();
      selectedIds.forEach((id) => softDeleteSubtree(id));
      clearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds]);

  // 新建任务(回车/按钮)后聚焦并进入编辑;同时设为单选
  const onCreated = (id: string) => {
    selectionEpoch.current++;
    setFocusNewId(id);
    setSelectedIds([id]);
    setAnchorId(id);
  };

  const addChildTo = (parentId: string) => {
    const kids = childrenMap.get(parentId) ?? [];
    const created = store.createTask({
      title: '',
      status: 'todo',
      parentId,
      order: newOrder(kids.at(-1)?.order),
    });
    if (created) {
      onCreated(created.id);
    }
  };

  const onDragStart = (e: DragStartEvent) => {
    store.stopUndoCapture();
    setDrop(null);
    setDropMessage('');
    pointerRef.current = getEventCoordinates(e.activatorEvent);
    setActiveDragId(String(e.active.id));
  };
  const updateDrop = (e: DragMoveEvent | DragOverEvent) => {
    const intent = (e.collisions?.[0]?.data?.intent as TaskDrop | undefined) ?? null;
    setDrop((previous) => JSON.stringify(previous) === JSON.stringify(intent) ? previous : intent);
    setDropMessage((e.collisions?.[0]?.data?.message as string | undefined) ?? '');
  };
  const cancelDrag = () => {
    setActiveDragId(null);
    setDrop(null);
    setDropMessage('');
  };
  const onDragEnd = async (e: DragEndEvent) => {
    // Auto-scroll can move rows between the last collision frame and pointer release.
    // Resolve against live DOM bounds so the final target follows the same client pointer.
    const pointer = pointerRef.current;
    const id = String(e.active.id);
    let intent: TaskDrop | null = null;
    const listBounds = listRef.current?.getBoundingClientRect();
    if (pointer && listBounds && pointer.x >= listBounds.left && pointer.x <= listBounds.right
      && pointer.y >= listBounds.top && pointer.y <= listBounds.bottom) {
      for (const element of listRef.current!.querySelectorAll<HTMLElement>('[data-task-id]')) {
        const row = rowsById.get(element.dataset.taskId!);
        if (!row || draggedIds.has(row.task.id)) continue;
        const rect = element.getBoundingClientRect();
        if (pointer.y < rect.top || pointer.y > rect.bottom
          || pointer.x < rect.left - row.depth * TASK_INDENT || pointer.x > rect.right) continue;
        intent = resolveDrop(id, row, pointer, rect).intent;
        break;
      }
    }
    cancelDrag();
    if (!intent || !byId.has(id) || !canReparent(id, intent.parentId, allChildren)) return;
    const siblings = (allChildren.get(intent.parentId) ?? []).filter((task) => task.id !== id);
    const anchorIndex = siblings.findIndex((task) => task.id === intent.anchorId);
    if (intent.placement !== 'inside' && anchorIndex < 0) return;
    const index = intent.placement === 'inside' ? siblings.length
      : anchorIndex + (intent.placement === 'after' ? 1 : 0);
    const prev = siblings[index - 1];
    const next = siblings[index];
    store.reparent(id, intent.parentId, newOrder(prev?.order, next?.order));
    if (gapTooSmall(prev?.order, next?.order)) store.renumberParent(intent.parentId);
    store.stopUndoCapture();
    if (intent.placement === 'inside') {
      useUI.setState((state) => ({ collapsed: { ...state.collapsed, [intent.parentId!]: false } }));
    }
    const generation = ++saveGeneration.current;
    setSaveStatus('正在保存…');
    try {
      await store.flushPersistence();
      if (generation === saveGeneration.current) setSaveStatus('已保存');
    } catch {
      if (generation === saveGeneration.current) setSaveStatus('保存失败，请保留此页面并从设置导出备份');
    }
  };

  const addRoot = () => captureRef.current?.focus();
  const submitTask = async (event: React.FormEvent) => {
    event.preventDefault();
    if (composing.current || !newTitle.trim()) return;
    const siblings = allChildren.get(projectId) ?? [];
    store.createTask({
      title: newTitle.trim(),
      status: 'todo',
      parentId: projectId,
      order: newOrder(siblings.at(-1)?.order),
      ...(scope ? { dueAt: endOfDay(now).getTime() - 60000 } : {}),
    });
    setNewTitle('');
    captureRef.current?.focus();
    const generation = ++saveGeneration.current;
    setSaveStatus('正在保存…');
    try {
      await store.flushPersistence();
      if (generation === saveGeneration.current) setSaveStatus('已保存');
    } catch {
      if (generation === saveGeneration.current) setSaveStatus('保存失败，请保留此页面并从设置导出备份');
    }
  };

  const empty = groups.every((g) => g.tasks.length === 0);

  return (
    <div className="flex h-full min-h-0">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <form
          onSubmit={submitTask}
          className="mx-5 mt-4 mb-3 flex shrink-0 items-center gap-3 rounded-lg border border-[var(--border-strong)] bg-[var(--background)] px-4 transition-colors focus-within:border-[var(--accent-solid)] lg:mx-7"
        >
          <Plus size={18} className="shrink-0 text-[var(--accent-solid)]" />
          <input
            ref={captureRef}
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (composing.current || isComposing(event))) event.preventDefault();
            }}
            placeholder="添加任务，按 Enter 保存"
            aria-label="添加任务"
            className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
        </form>
        <div className="flex shrink-0 items-center gap-2 px-5 pb-2 text-[11px] text-muted lg:px-7">
          <span>
            {visibleTasks.filter((task) => !isStructural(task) && task.status !== 'done').length} 项待办
          </span>
          <span role="status" aria-label="保存状态">
            {saveStatus}
          </span>
          <select
            aria-label="筛选任务"
            value={filter.kind === 'tag' ? `tag:${filter.tagId}` : filter.kind}
            onChange={(event) =>
              ui.setFilter(
                event.target.value.startsWith('tag:')
                  ? { kind: 'tag', tagId: event.target.value.slice(4) }
                  : { kind: event.target.value as TaskFilter['kind'] },
              )
            }
            className="ml-auto bg-transparent text-xs outline-none"
          >
            {FILTERS.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
            {data.tags
              .filter((tag) => !tag.deletedAt)
              .map((tag) => (
                <option key={tag.id} value={`tag:${tag.id}`}>
                  #{tag.name}
                </option>
              ))}
          </select>
        </div>

        {/* 列表 */}
        <div ref={listRef} data-task-list className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 lg:px-7">
          {empty ? (
            <EmptyState
              icon={<ListIcon />}
              title={scope ? '这里暂时没有安排' : '还没有任务'}
              sub="在上方输入任务，即可开始"
            />
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={collisionDetection}
              onDragStart={onDragStart}
              onDragMove={updateDrop}
              onDragOver={updateDrop}
              onDragEnd={onDragEnd}
              onDragCancel={cancelDrag}
              autoScroll={{ threshold: { x: 0.05, y: 0.1 }, acceleration: 5, interval: 10 }}
            >
              <DragOverlay
                dropAnimation={null}
                modifiers={[previewBesidePointer]}
                style={{ width: 280, maxWidth: 'calc(100vw - 24px)', pointerEvents: 'none' }}
              >
                {activeDragId &&
                  (() => {
                    const dt = data.tasks.find((t) => t.id === activeDragId);
                    return dt ? (
                      <div data-task-drag-preview className="pointer-events-none max-w-xs rounded-lg border border-[var(--border-strong)] bg-[var(--surface-solid)] px-3 py-2 text-sm text-foreground shadow-lg">
                        <div className="truncate font-medium">{dt.title || 'Untitled'}</div>
                        <div role="status" aria-label="任务拖动提示" className="mt-1 text-[11px] text-muted">
                          {drop?.groupedRoot ? '移出至顶层（按日期分组）'
                            : drop ? `${drop.placement === 'inside' ? '挂为子任务 →' : drop.placement === 'before' ? '插到前面 →' : '插到后面 →'} ${byId.get(drop.anchorId)?.title || 'Untitled'}`
                            : dropMessage || '行中部关联 · 同组边缘排序 · 向左移出层级'}
                        </div>
                        {draggedIds.size > 1 && <div className="mt-1 text-[10px] text-muted">包含 {draggedIds.size - 1} 项子任务</div>}
                      </div>
                    ) : null;
                  })()}
              </DragOverlay>
              {rowsByGroup.map((g) => (
                <section key={g.key} className="mb-2">
                  <div className="mb-1 flex items-center gap-2 py-1">
                    <h2 className="text-[11px] font-medium text-muted">
                      {g.key === 'anytime' ? '任务' : g.label}
                    </h2>
                    <span className="text-[10px] text-muted/60">{g.tasks.length}</span>
                    {g.key === 'overdue' && (
                      <Badge variant="danger" className="!px-1.5 !py-0">
                        !
                      </Badge>
                    )}
                  </div>
                  {g.rows.map((row) => (
                    <TaskRow
                      key={row.task.id}
                      task={row.task}
                      progress={progressMap.get(row.task.id)}
                      depth={row.depth}
                      hasChildren={row.hasChildren}
                      selected={selectedIds.includes(row.task.id)}
                      selectionIds={selectedIds}
                      pickAttach={pickAttach}
                      inDraggedBranch={draggedIds.has(row.task.id)}
                      dropHint={dropIndicatorId === row.task.id ? drop : null}
                      onSelect={handleSelect}
                      forceEdit={focusNewId === row.task.id}
                      onCreated={onCreated}
                      onConsumed={() => setFocusNewId(null)}
                    />
                  ))}
                </section>
              ))}
            </DndContext>
          )}

          {inboxTasks(data.tasks).length > 0 && (
            <div className="mb-6 text-center text-xs text-muted">
              收集箱还有 {inboxTasks(data.tasks).length} 条待整理
            </div>
          )}
        </div>
      </div>

      <aside className="workspace-detail hidden lg:block">
        {detailsDocked &&
        selectedIds.length === 1 &&
        data.tasks.find((task) => task.id === selectedIds[0]) ? (
          <TaskInspector
            docked
            task={data.tasks.find((task) => task.id === selectedIds[0])!}
            onAddChild={() => addChildTo(selectedIds[0]!)}
            onClose={clearSelection}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-muted">
            <Folder size={28} strokeWidth={1} />
            <span className="text-xs">选择任务，查看详情</span>
          </div>
        )}
      </aside>

      {/* 多选浮动操作条 */}
      {selectedIds.length > 1 && (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-2xl glass-raised px-3 py-2 text-xs shadow-xl">
          <span className="px-1 text-muted">已选 {selectedIds.length} 项</span>
          {pickAttach ? (
            <>
              <span className="px-1 text-[var(--accent-from)]">
                点击目标任务,把选中的一批挂到它下面(Esc 取消)
              </span>
              <button
                onClick={() => setPickAttach(false)}
                className="rounded-full px-3 py-1 text-muted hover:text-foreground"
              >
                取消
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setPickAttach(true)}
                className="rounded-full border border-[var(--border-strong)] px-3 py-1 text-muted transition-colors hover:text-foreground"
                title="再点击一个任务,把选中的这批挂到它下面"
              >
                挂到…
              </button>
              <button
                onClick={() =>
                  selectedIds.forEach((id) => {
                    const task = data.tasks.find((item) => item.id === id);
                    if (task && !isStructural(task)) store.setTaskStatus(id, 'done');
                  })
                }
                className="rounded-full gradient-bg px-3 py-1 text-white"
              >
                完成
              </button>
              <button
                onClick={() => {
                  // 每个所选:整棵子树一并删除;与其它所选重叠时 softDelete 对其已是幂等,无害
                  selectedIds.forEach((id) => softDeleteSubtree(id));
                  clearSelection();
                }}
                className="rounded-full px-3 py-1 text-[var(--danger)] hover:bg-[var(--danger)]/10"
              >
                删除
              </button>
            </>
          )}
          <button onClick={clearSelection} className="px-2 py-1 text-muted hover:text-foreground">
            清除
          </button>
        </div>
      )}
    </div>
  );
}

function ListIcon() {
  return <Plus className="h-6 w-6" />;
}

function TaskRow({
  task,
  progress,
  depth,
  hasChildren,
  selected,
  selectionIds,
  pickAttach,
  inDraggedBranch,
  dropHint,
  onSelect,
  forceEdit,
  onCreated,
  onConsumed,
}: {
  task: Task;
  progress?: { done: number; total: number };
  depth: number;
  hasChildren: boolean;
  selected: boolean;
  selectionIds: string[];
  /** 批量挂载拾取模式:整行可点作目标,悬停高亮 */
  pickAttach?: boolean;
  inDraggedBranch: boolean;
  dropHint: TaskDrop | null;
  onSelect: (id: string, e: React.MouseEvent) => void;
  /** 父级请求本行进入编辑态(新建任务后聚焦) */
  forceEdit: boolean;
  /** 本行通过回车新建了任务,通知父级聚焦该新任务 */
  onCreated: (id: string) => void;
  /** 本行已进入编辑态,父级可清掉 forceEdit 标记 */
  onConsumed: () => void;
}) {
  const data = useCortexData();
  const store = useCortex();
  const ui = useUI();
  const navigate = useNavigate();
  const timerStart = useTimer((s) => s.start);
  const collapsed = !!ui.collapsed[task.id];
  const node = isStructural(task); // 结构节点:无勾选/状态/优先级/截止,标题可编辑、子树照常
  const [editing, setEditing] = useState(false);
  const { attributes, listeners, setNodeRef: setDragRef, setActivatorNodeRef } = useDraggable({
    id: task.id,
    disabled: editing || !!pickAttach,
  });
  const { setNodeRef: setDropRef } = useDroppable({
    id: task.id,
    data: { task, depth },
    disabled: inDraggedBranch,
  });
  const setNodeRef = useCallback((element: HTMLDivElement | null) => {
    setDragRef(element);
    setDropRef(element);
  }, [setDragRef, setDropRef]);
  const titleRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 父级请求聚焦:进入编辑态并自动聚焦输入框,随后消费该信号
  useEffect(() => {
    if (forceEdit) {
      setEditing(true);
      onConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceEdit]);

  // 进入编辑态:显式聚焦 + 全选(autoFocus 在跨提交时序下会落空)
  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editing]);

  const tags = task.tags
    .map((tid) => data.tags.find((t) => t.id === tid))
    .filter(Boolean) as typeof data.tags;

  const onKey = (e: React.KeyboardEvent) => {
    if (editing || isComposing(e)) return;
    const siblings =
      buildChildrenMap(activeTasks(data.tasks).filter((t) => t.status !== 'inbox')).get(task.parentId) ?? [];
    const idx = siblings.findIndex((t) => t.id === task.id);
    if (e.key === 'Enter') {
      e.preventDefault();
      const created = store.createTask({
        title: '',
        status: 'todo',
        parentId: task.parentId,
        order: newOrder(task.order, siblings[idx + 1]?.order),
      });
      if (created) onCreated(created.id);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (!e.shiftKey && idx > 0) {
        // 缩进:挂到前一个兄弟下
        const newParent = siblings[idx - 1]!;
        const kids = buildChildrenMap(activeTasks(data.tasks)).get(newParent.id) ?? [];
        store.reparent(task.id, newParent.id, newOrder(kids.at(-1)?.order));
      } else if (e.shiftKey) {
        // 升级:挂到祖父下,排在原父级之后
        const parent = task.parentId ? data.tasks.find((t) => t.id === task.parentId) : null;
        if (parent?.parentId !== undefined && parent) {
          const pSiblings = buildChildrenMap(activeTasks(data.tasks)).get(parent.parentId) ?? [];
          const pIdx = pSiblings.findIndex((t) => t.id === parent.id);
          store.reparent(task.id, parent.parentId, newOrder(parent.order, pSiblings[pIdx + 1]?.order));
        }
      }
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
      if (node) return; // 结构节点无完成态(store 层也会拦,这里直接不吃按键)
      e.preventDefault();
      store.toggleTaskDone(task.id);
    } else if (['1', '2', '3', '4'].includes(e.key)) {
      if (node) return; // 结构节点无优先级
      // P0/P1/P2/P3(= 重要×紧急 四个象限)
      const idx = ['1', '2', '3', '4'].indexOf(e.key);
      store.setTaskPriority(task.id, PRIORITY_ORDER[idx]);
    } else if (e.key.toLowerCase() === 't') {
      if (node) return; // 结构节点不排期
      store.updateTask(task.id, { dueAt: endOfDay(new Date()).getTime() - 60000 });
    } else if (e.key.toLowerCase() === 'm') {
      if (node) return;
      store.updateTask(task.id, { dueAt: endOfDay(addDays(new Date(), 1)).getTime() - 60000 });
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      if (selected) return; // 该行已选中 → 交父级整批删除
      store.softDeleteTask(task.id);
    }
  };

  const openMenu = (x: number, y: number) =>
    ui.openTaskMenu(task.id, x, y, selectionIds.length > 1 ? selectionIds : undefined);

  return (
    <div
      ref={setNodeRef}
      data-row
      data-task-id={task.id}
      data-drop-placement={dropHint?.groupedRoot ? 'root' : dropHint?.placement}
      onClick={(e) => onSelect(task.id, e)}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!selected) onSelect(task.id, e);
        openMenu(e.clientX, e.clientY);
      }}
      style={{ marginLeft: depth * TASK_INDENT }}
      className={cn(
        'task-row group relative flex cursor-default items-center gap-1.5 px-1 py-0.5 transition-colors',
        'hover:bg-[var(--surface)] focus-within:bg-[var(--surface)]',
        selected && !pickAttach && 'bg-[var(--selection)]',
        pickAttach && 'cursor-copy hover:ring-2 hover:ring-[var(--accent-from)]',
        inDraggedBranch && 'opacity-35',
        (dropHint?.groupedRoot || dropHint?.placement === 'inside') && 'bg-[var(--selection)] ring-1 ring-inset ring-[var(--accent-solid)]',
        task.status === 'done' && 'text-muted',
      )}
    >
      {dropHint && !dropHint.groupedRoot && dropHint.placement !== 'inside' && (
        <span
          className="pointer-events-none absolute right-0 z-10 h-0.5 bg-[var(--accent-solid)]"
          style={{ left: (dropHint.depth - depth) * TASK_INDENT, top: dropHint.placement === 'before' ? 0 : undefined, bottom: dropHint.placement === 'after' ? 0 : undefined }}
        />
      )}
      {/* 折叠 */}
      {hasChildren ? (
        <button
          onClick={(event) => {
            event.stopPropagation();
            ui.toggleCollapsed(task.id);
          }}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? '展开' : '收起'} ${task.title || 'Untitled'}`}
          className="flex h-5 w-5 shrink-0 items-center justify-center text-muted hover:text-foreground"
        >
          <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', !collapsed && 'rotate-90')} />
        </button>
      ) : (
        <span className="w-5 shrink-0" />
      )}

      {/* 拖拽把手 */}
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        onClick={(event) => event.stopPropagation()}
        className="flex h-7 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted/50 hover:bg-[var(--surface)] hover:text-foreground active:cursor-grabbing"
        aria-label={`拖动任务 ${task.title || 'Untitled'}`}
        title="拖动关联或排序；行中部挂为子任务，边缘排序，向左移出层级"
      >
        <GripVertical size={14} />
      </button>

      {node ? (
        <span
          className="grid h-[22px] w-[22px] shrink-0 place-items-center text-muted/70"
          title="结构节点(无完成态)"
        >
          <Folder className="h-4 w-4" />
        </span>
      ) : (
        <>
          <TaskCheckbox done={task.status === 'done'} onChange={() => store.toggleTaskDone(task.id)} />
          {priorityOf(task) !== 'P3' && <PriorityDot task={task} />}
        </>
      )}

      {editing ? (
        <input
          ref={inputRef}
          autoFocus
          defaultValue={task.title}
          onBlur={(e) => {
            store.updateTask(task.id, { title: e.target.value.trim() || 'Untitled' });
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (isComposing(e)) return;
            if (e.key === 'Enter') {
              store.updateTask(task.id, { title: e.currentTarget.value.trim() || 'Untitled' });
              setEditing(false);
              titleRef.current?.focus(); // 完成后把焦点还给标题按钮,再回车即新建子任务
            } else if (e.key === 'Escape') setEditing(false);
          }}
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
        />
      ) : (
        <button
          ref={titleRef}
          {...listeners}
          onDoubleClick={() => setEditing(true)}
          onKeyDown={onKey}
          tabIndex={0}
          className={cn(
            'min-w-0 flex-1 touch-pan-y truncate text-left text-[13px] outline-none',
            node && 'font-medium',
            task.status === 'done' && 'line-through',
            task.title === '' && 'text-muted/50',
          )}
        >
          {task.title || 'Untitled'}
        </button>
      )}

      {tags.slice(0, 3).map((tag) => (
        <TagChip key={tag.id} tag={tag} />
      ))}
      {progress && progress.total > 0 && <SubtreeProgress {...progress} />}
      {!node && task.status === 'doing' && <span className="shrink-0 text-[11px] text-muted">进行中</span>}
      {!node && <DueBadge task={task} />}
      {task.estimateMin != null && task.estimateMin > 0 && (
        <Badge className="hidden md:inline-flex">{task.estimateMin}m</Badge>
      )}

      {!node && (
        <button
          onClick={() => {
            timerStart({ mode: 'focus', taskId: task.id });
            navigate('/focus');
          }}
          className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-lg text-muted/0 transition-colors group-hover:text-[var(--accent-from)] hover:bg-[var(--surface)] md:flex"
          title="开始专注"
        >
          <Play className="h-3.5 w-3.5" />
        </button>
      )}

      {/* ⋯ 菜单(桌触屏通用,右键的兜底) */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          const r = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
          openMenu(r.right - 24, r.bottom + 4);
        }}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-muted/50 transition-colors hover:text-foreground hover:bg-[var(--surface)]"
        aria-label="任务菜单"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
    </div>
  );
}
