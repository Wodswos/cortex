import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  DndContext, DragEndEvent, DragStartEvent, PointerSensor, useSensor, useSensors, closestCenter,
  DragOverlay,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronRight, Play, Plus, MoreHorizontal, Folder } from 'lucide-react';
import { cn, EmptyState, Badge } from '@cortex/ui';
import {
  Task, TaskFilter, activeTasks, buildChildrenMap, groupRoots, inboxTasks, fullyDoneIds,
  canReparent, newOrder, gapTooSmall, endOfDay, addDays, PRIORITY_ORDER, isStructural,
} from '@cortex/core';
import { useCortex, useCortexData } from '@cortex/crdt';
import { useUI } from '@/state/ui';
import { useTimer } from '@/focus/timer';
import { TaskCheckbox, DueBadge, PriorityDot, SubtreeProgress, TagChip, StatusBadge } from '@/shared/components';
import { TaskInspector } from '@/shared/TaskInspector';

/** 过滤 chips */
const FILTERS: { key: TaskFilter['kind']; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'today', label: '今天' },
  { key: 'next7', label: '未来 7 天' },
  { key: 'high', label: '高优先级' },
  { key: 'unscheduled', label: '无日期' },
];

export function ListView() {
  const data = useCortexData();
  const store = useCortex();
  const ui = useUI();
  const [now] = useState(() => new Date());
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { delay: 180, tolerance: 8 } }));
  // 列表多选:单击=单选,Shift+单击=区间,⌘/Ctrl+单击=增减
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [anchorId, setAnchorId] = useState<string | null>(null);
  // 新建任务后要聚焦并进入编辑的 id
  const [focusNewId, setFocusNewId] = useState<string | null>(null);
  /** 批量挂载模式:多选后点「挂到…」,再点任意行 = 把选中的一批挂到它下面 */
  const [pickAttach, setPickAttach] = useState(false);

  const filter = ui.filter;
  const showDone = (data.settings.completedDisplay ?? 'inline-gray') !== 'hidden';
  const active = useMemo(
    () => activeTasks(data.tasks).filter((t) => t.status !== 'inbox'),
    [data.tasks],
  );
  const childrenMap = useMemo(() => buildChildrenMap(active), [active]);
  // 隐藏模式:整棵子树都完成的行不再渲染(根级过滤在 groupRoots,子级在这里)
  const hiddenDone = useMemo(
    () => (showDone ? null : fullyDoneIds(data.tasks)),
    [data.tasks, showDone],
  );

  // 分组只对「根级」;子树跟随父级展示
  const groups = useMemo(() => groupRoots(data.tasks, now, filter, { showDone }), [data.tasks, now, filter, showDone]);

  /** 每组展开后的可见行:从组内根任务 DFS(子树跟随父级,应用折叠状态) */
  const rowsByGroup = useMemo(() => {
    const collapsed = new Set(Object.entries(ui.collapsed).filter(([, v]) => v).map(([k]) => k));
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

  /** 批量挂载:把选中的一批挂到 target 下(排在末尾);环/选区内目标自动跳过,一个撤销单元 */
  const attachSelectedTo = (targetId: string) => {
    if (selectedIds.includes(targetId)) return; // 点到选区内:忽略
    const target = data.tasks.find((t) => t.id === targetId);
    if (!target || target.deletedAt) return;
    const kids = childrenMap.get(targetId) ?? [];
    let order = newOrder(kids.at(-1)?.order);
    let moved = 0;
    for (const id of selectedIds) {
      if (!canReparent(id, targetId, childrenMap)) continue;
      store.reparent(id, targetId, order);
      order += 1;
      moved++;
    }
    if (moved > 0) store.stopUndoCapture(); // 整批 = 一次撤销
    setPickAttach(false);
    if (moved > 0) clearSelection();
  };

  const handleSelect = (id: string, e: React.MouseEvent) => {
    if (pickAttach) { // 挂载模式下点击 = 选目标,不改选区
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
  };

  const clearSelection = () => {
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
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPickAttach(false); };
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
    setFocusNewId(id);
    setSelectedIds([id]);
    setAnchorId(id);
  };

  const addChildTo = (parentId: string) => {
    const kids = childrenMap.get(parentId) ?? [];
    const created = store.createTask({ title: '', status: 'todo', parentId, order: newOrder(kids.at(-1)?.order) });
    if (created) {
      setSelectedIds([created.id]);
      setAnchorId(created.id);
    }
  };

  const onDragStart = (e: DragStartEvent) => setActiveDragId(String(e.active.id));

  const onDragEnd = (e: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const dragId = String(active.id);
    const overId = String(over.id);
    const task = data.tasks.find((t) => t.id === dragId);
    const overTask = data.tasks.find((t) => t.id === overId);
    if (!task || !overTask) return;

    // 落点相对目标行的纵向位置 → 三段式(经典 sortable-tree 语义,可预期):
    //   上 25% = 插到它前面(同级换序) · 中 50% = 成为它的子任务 · 下 25% = 插到它后面
    const dragTop = e.active.rect.current.translated?.top ?? 0;
    const overTop = e.over?.rect.top ?? 0;
    const overH = Math.max(1, e.over?.rect.height ?? 1);
    const rel = (dragTop - overTop) / overH;

    if (rel >= 0.25 && rel < 0.75) {
      // 中段 → 挂为其子任务(排末尾);不能挂到自己/自己的后代上则放弃
      if (overTask.id !== dragId && canReparent(dragId, overTask.id, childrenMap)) {
        const kids = childrenMap.get(overTask.id) ?? [];
        store.reparent(dragId, overTask.id, newOrder(kids.at(-1)?.order));
      }
      return;
    }

    // 上/下段 → 与目标同级,插到它前/后(纯排序;跨分支 = 移动到另一父级下)
    const newParent = overTask.parentId;
    if (overTask.id !== dragId && !canReparent(dragId, newParent, childrenMap)) return;
    const siblings = (childrenMap.get(newParent) ?? []).filter((t) => t.id !== dragId);
    const overIdx = siblings.findIndex((t) => t.id === overId);
    if (overIdx < 0) return;
    const below = rel >= 0.75;
    const prev = below ? siblings[overIdx] : siblings[overIdx - 1];
    const next = below ? siblings[overIdx + 1] : siblings[overIdx];
    store.reparent(dragId, newParent, newOrder(prev?.order, next?.order));
    if (gapTooSmall(prev?.order, next?.order)) store.renumberParent(newParent);
  };

  const addRoot = () => {
    const roots = childrenMap.get(null) ?? [];
    const created = store.createTask({ title: '', status: 'todo', order: newOrder(roots.at(-1)?.order) });
    if (created) onCreated(created.id);
  };

  const empty = groups.every((g) => g.tasks.length === 0);

  return (
    <div className="flex h-full min-h-0">
      <div className="relative flex min-w-0 flex-1 flex-col">
      {/* 过滤条 */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-4 py-3 md:px-6">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => ui.setFilter({ kind: f.key })}
            className={cn(
              'rounded-full px-2.5 py-1 text-xs transition-all',
              filter.kind === f.key ? 'gradient-bg text-white' : 'glass text-muted hover:text-foreground',
            )}
          >
            {f.label}
          </button>
        ))}
        {data.tags
          .filter((t) => !t.deletedAt)
          .map((tag) => (
            <button
              key={tag.id}
              onClick={() => ui.setFilter(filter.kind === 'tag' && filter.tagId === tag.id ? { kind: 'all' } : { kind: 'tag', tagId: tag.id })}
              className={cn(
                'rounded-full px-2.5 py-1 text-xs transition-all',
                filter.kind === 'tag' && filter.tagId === tag.id ? 'gradient-bg text-white' : 'glass text-muted hover:text-foreground',
              )}
            >
              #{tag.name}
            </button>
          ))}
        <button onClick={addRoot} className="ml-auto inline-flex items-center gap-1 rounded-full glass px-2.5 py-1 text-xs text-muted hover:text-foreground">
          <Plus className="h-3.5 w-3.5" /> 新任务
        </button>
      </div>

      {/* 列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-24 md:px-6">
        {empty ? (
          <EmptyState
            icon={<ListIcon />}
            title={filter.kind === 'all' ? '还没有任务' : '该过滤条件下没有任务'}
            sub={filter.kind === 'all' ? '点右上角新建,或 ⌘K 打开命令面板' : undefined}
          />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd}>
            <DragOverlay>
              {activeDragId && (() => {
                const dt = data.tasks.find((t) => t.id === activeDragId);
                return dt ? <div className="rounded-xl glass-raised px-3 py-2 text-sm text-foreground shadow-xl">{dt.title || 'Untitled'}</div> : null;
              })()}
            </DragOverlay>
            {rowsByGroup.map((g) => (
              <section key={g.key} className="mb-5">
                <div className="mb-1.5 flex items-center gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">{g.label}</h2>
                  <span className="text-[10px] text-muted/60">{g.tasks.length}</span>
                  {g.key === 'overdue' && <Badge variant="danger" className="!px-1.5 !py-0">!</Badge>}
                </div>
                <SortableContext items={g.rows.map((r) => r.task.id)} strategy={verticalListSortingStrategy}>
                  {g.rows.map((row) => (
                    <SortableRow
                      key={row.task.id}
                      task={row.task}
                      depth={row.depth}
                      hasChildren={row.hasChildren}
                      selected={selectedIds.includes(row.task.id)}
                      selectionIds={selectedIds}
                      pickAttach={pickAttach}
                      onSelect={handleSelect}
                      forceEdit={focusNewId === row.task.id}
                      onCreated={onCreated}
                      onConsumed={() => setFocusNewId(null)}
                    />
                  ))}
                </SortableContext>
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

      {/* 右栏:单选任务详情(dock 模式,替代跟手浮窗) */}
      {selectedIds.length === 1 && (() => {
        const t = data.tasks.find((x) => x.id === selectedIds[0]);
        if (!t) return null;
        return <TaskInspector docked task={t} onAddChild={() => addChildTo(t.id)} onClose={clearSelection} />;
      })()}

      {/* 多选浮动操作条 */}
      {selectedIds.length > 1 && (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-2xl glass-raised px-3 py-2 text-xs shadow-xl">
          <span className="px-1 text-muted">已选 {selectedIds.length} 项</span>
          {pickAttach ? (
            <>
              <span className="px-1 text-[var(--accent-from)]">点击目标任务,把选中的一批挂到它下面(Esc 取消)</span>
              <button onClick={() => setPickAttach(false)} className="rounded-full px-3 py-1 text-muted hover:text-foreground">
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
            onClick={() => selectedIds.forEach((id) => { const task = data.tasks.find((item) => item.id === id); if (task && !isStructural(task)) store.setTaskStatus(id, 'done'); })}
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

function SortableRow({
  task,
  depth,
  hasChildren,
  selected,
  selectionIds,
  pickAttach,
  onSelect,
  forceEdit,
  onCreated,
  onConsumed,
}: {
  task: Task;
  depth: number;
  hasChildren: boolean;
  selected: boolean;
  selectionIds: string[];
  /** 批量挂载拾取模式:整行可点作目标,悬停高亮 */
  pickAttach?: boolean;
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const [editing, setEditing] = useState(false);
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

  const progress = hasChildren
    ? (() => {
        const kids = data.tasks.filter((t) => t.parentId === task.id && !t.deletedAt);
        let done = 0, total = 0;
        const stack = [...kids];
        while (stack.length) {
          const t = stack.pop()!;
          total++;
          if (t.status === 'done') done++;
          stack.push(...data.tasks.filter((x) => x.parentId === t.id && !x.deletedAt));
        }
        return { done, total };
      })()
    : null;

  const onKey = (e: React.KeyboardEvent) => {
    if (editing) return;
    const siblings = (buildChildrenMap(activeTasks(data.tasks).filter((t) => t.status !== 'inbox')).get(task.parentId) ?? []);
    const idx = siblings.findIndex((t) => t.id === task.id);
    if (e.key === 'Enter') {
      e.preventDefault();
      const created = store.createTask({ title: '', status: 'todo', parentId: task.parentId, order: newOrder(task.order, siblings[idx + 1]?.order) });
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
      onClick={(e) => onSelect(task.id, e)}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!selected) onSelect(task.id, e);
        openMenu(e.clientX, e.clientY);
      }}
      style={{ transform: CSS.Transform.toString(transform), transition, marginLeft: depth * 18 }}
      className={cn(
        'group relative flex cursor-default items-center gap-2 rounded-xl px-2 py-2 transition-colors',
        'hover:bg-[var(--surface)] focus-within:bg-[var(--surface)]',
        selected && !pickAttach && 'bg-[var(--surface)] ring-1 ring-[var(--accent-from)]/40',
        pickAttach && 'cursor-copy hover:ring-2 hover:ring-[var(--accent-from)]',
        isDragging && 'z-20 opacity-60 glass-raised',
        task.status === 'done' && 'opacity-55',
      )}
    >
      {/* 折叠 */}
      {hasChildren ? (
        <button
          onClick={() => ui.toggleCollapsed(task.id)}
          className="flex h-5 w-5 shrink-0 items-center justify-center text-muted hover:text-foreground"
        >
          <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', !collapsed && 'rotate-90')} />
        </button>
      ) : (
        <span className="w-5 shrink-0" />
      )}

      {/* 拖拽把手 */}
      <button
        {...attributes}
        {...listeners}
        className="hidden h-5 w-3.5 shrink-0 cursor-grab touch-none items-center justify-center text-muted/0 group-hover:text-muted/70 active:cursor-grabbing md:flex"
        aria-label="拖拽排序"
      >
        ⋮⋮
      </button>

      {node ? (
        <span className="grid h-[22px] w-[22px] shrink-0 place-items-center text-muted/70" title="结构节点(无完成态)">
          <Folder className="h-4 w-4" />
        </span>
      ) : (
        <>
          <TaskCheckbox done={task.status === 'done'} onChange={() => store.toggleTaskDone(task.id)} />
          <PriorityDot task={task} />
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
            if (e.key === 'Enter') {
              store.updateTask(task.id, { title: e.currentTarget.value.trim() || 'Untitled' });
              setEditing(false);
              titleRef.current?.focus(); // 完成后把焦点还给标题按钮,再回车即新建子任务
            } else if (e.key === 'Escape') setEditing(false);
          }}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      ) : (
        <button
          ref={titleRef}
          onDoubleClick={() => setEditing(true)}
          onKeyDown={onKey}
          tabIndex={0}
          className={cn(
            'min-w-0 flex-1 truncate text-left text-sm outline-none',
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
      {progress && <SubtreeProgress {...progress} />}
      {!node && <StatusBadge task={task} />}
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
