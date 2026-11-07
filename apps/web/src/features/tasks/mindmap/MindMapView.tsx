import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  MiniMap,
  SelectionMode,
  useNodesState,
  useEdgesState,
  useReactFlow,
  BaseEdge,
  type Node,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import {
  Crosshair,
  Eye,
  EyeOff,
  Check,
  Palette,
  Info,
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import '@xyflow/react/dist/style.css';
import { cn } from '@cortex/ui';
import {
  Task,
  activeTasks,
  buildChildrenMap,
  newOrder,
  gapTooSmall,
  sortSiblings,
  canReparent,
  fullyDoneIds,
  isProject,
  descendantsOf,
  workSignals,
  workProgress,
  taskContextIds,
  type WorkFocus,
  type MindFont,
} from '@cortex/core';
import { useCortex, useCortexData } from '@cortex/crdt';
import { useUI } from '@/state/ui';
import { TaskInspector } from '@/shared/TaskInspector';
import { AppearancePanel } from './AppearancePanel';
import { MapControls } from './MapControls';
import { MapHelp } from './MapHelp';
import { usePanSpeed } from './panSpeed';
import { branchColor } from './appearance';
import { TaskNode, type MindNodeData } from './TaskNode';
import { layoutMindTree, mindMetrics, VIRTUAL_ROOT_ID } from './layout';
import { useMindFonts } from './fonts';
import { useMapViewport } from './viewport';
import { useMindGeometry } from './geometry';
import { useTaskViewData } from '../useTaskViewData';
import { useTaskWindow } from '../TaskWindowControls';
import { windowDueAt } from '../taskWindow';
import { readTaskFilters, selectWorkspaceTasks, workspaceTaskDefaults } from '../taskFilters';
import { useAuth } from '@/app/auth';

/** 「全部」视图的虚拟真根:所有顶层根任务连到同一个点上 */
const VIRTUAL_ROOT_TASK: Task = {
  id: VIRTUAL_ROOT_ID,
  title: '我的工作空间',
  status: 'todo',
  parentId: null,
  order: 0,
  important: false,
  urgent: false,
  tags: [],
  dueAt: null,
  estimateMin: undefined,
  ownerId: '__virtual__',
  createdAt: 0,
  updatedAt: 0,
  completedAt: null,
  deletedAt: null,
};

type NodeData = MindNodeData;

const NODE_TYPES = { task: TaskNode };
const EMPTY_IDS: string[] = [];
const MULTI_SELECTION_KEYS = ['Control', 'Meta', 'Shift'];
const PAN_BUTTONS = [1, 2];
const PRO_OPTIONS = { hideAttribution: true };
const MINIMAP_STYLE = { width: 140, height: 90, bottom: 100, right: 12, background: 'var(--surface-solid)', border: '1px solid var(--border)', borderRadius: 6 };
const preventContextMenu = (event: { preventDefault: () => void }) => event.preventDefault();

/** 树形折线:横出 → 父子走廊中线竖干 → 横入目标,恰好三段、共用竖干、永不回折。
 *  RF 内置 step 是"两端各探 20px 再拐",走廊一窄(卡片实际宽过布局假设时)路径会
 *  越过目标 x 再折回,产生双竖线的回折 S 线 —— 大子树在折线模式下"一坨乱线"的根因 */
function TreeStepEdge({ id, sourceX, sourceY, targetX, targetY, style }: EdgeProps) {
  const mx = (sourceX + targetX) / 2;
  const path = `M ${sourceX} ${sourceY} L ${mx} ${sourceY} L ${mx} ${targetY} L ${targetX} ${targetY}`;
  return <BaseEdge id={id} path={path} style={style} />;
}
const EDGE_TYPES = { tree: TreeStepEdge };
const EDGE_TYPE = { curve: 'default', straight: 'straight', step: 'tree' } as const;

/** 内容自适应、向右展开的导图；聚焦只改变强调，不改变节点位置。 */
function MindMapInner({
  rootTaskId,
  focusMode,
  focusToolbar,
}: {
  rootTaskId: string | null;
  focusMode: WorkFocus;
  focusToolbar?: HTMLElement | null;
}) {
  const data = useTaskViewData({ window: true, context: true });
  const [filterParams] = useSearchParams();
  const { range } = useTaskWindow();
  const store = useCortex();
  const { user } = useAuth();
  const virtualRootTask = useMemo(() => ({ ...VIRTUAL_ROOT_TASK, title: user?.username ?? '我的工作空间' }), [user?.username]);
  const collapsed = useUI((s) => s.collapsed);
  const openTaskMenu = useUI((s) => s.openTaskMenu);
  /** 连线形态(舒缓/直线/折线):存 settings 随账号同步,切换即重排应用到所有连线 */
  const edgeStyle = data.settings.mindEdgeStyle ?? 'curve';
  const { getIntersectingNodes } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  useMindGeometry();
  void onEdgesChange;
  const draggingId = useRef<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mapRegionRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<Node<NodeData>[]>([]);
  nodesRef.current = nodes;
  // ---------- 选中状态机 ----------
  // 选中只有一份存储:RF 节点的 selected 标志(点选/框选由 RF 写,经 onNodesChange 落
  // 到我们的 nodes 状态)。重排会整体重建 nodes,applyLayout 从旧 nodes 自携带 selected,
  // 选中因此跨重排存活;新建节点要选中时用 selectOnCreateRef 一次性指定(排他)。
  // 删除/右键批量只读 nodesRef 的标志位 —— 不再维护第二份"真源",也就没有回声打架。
  const selectOnCreateRef = useRef<string | null>(null);
  /** 上一次 onSelectionChange 的集合(逗号串),用来跳过 RF 重排后的等值重发 */
  const lastSelKeyRef = useRef('');

  /** 强制重排计数:删除等操作后即便布局 dep 未变也重排一次,杜绝节点残留/复活 */
  const [relayoutTick, bumpRelayout] = useReducer((x: number) => x + 1, 0);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [sideOpen, setSideOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [panSpeed, setPanSpeed] = usePanSpeed(store.userId);
  const onConfigOpenChange = useCallback((open: boolean) => {
    setConfigOpen(open);
    if (open) { setAppearanceOpen(false); setSideOpen(false); }
  }, []);
  const [newTaskIds, setNewTaskIds] = useState<string[]>([]);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  /** 拖拽中的落点提示:{目标节点, 语义}(child=挂子 / before|after=同级插前插后) */
  const [dropHint, setDropHint] = useState<{ id: string; mode: 'child' | 'before' | 'after' } | null>(null);
  /** 某节点编辑态的起始字符(类型触发时预置;普通编辑为 null) */
  const seedById = useRef<Record<string, string | null>>({});
  /** 新建节点尚未入图时的待编辑请求(id + 种子) */
  const editingIds = useRef(new Set<string>());
  const pendingEdit = useRef<{ id: string; seed: string | null } | null>(null);

  /** 直接给某节点打上编辑态(不改布局,不触发 fitView 跳动)。
   *  编辑期间同时关闭节点拖拽:点击输入框内文本应是移动光标,
   *  而不是被拖拽手势/节点点击抢走焦点导致退出编辑。 */
  const patchEdit = useCallback(
    (id: string, editing: boolean) => {
      if (editing) editingIds.current.add(id); else editingIds.current.delete(id);
      setNodes((ns) =>
        ns.map((n) =>
          n.id === id
            ? {
                ...n,
                draggable: !editing && n.id !== rootTaskId && n.id !== VIRTUAL_ROOT_ID,
                data: { ...n.data, editing, seedChar: editing ? (seedById.current[id] ?? null) : null },
              }
            : n,
        ),
      );
    },
    [setNodes, rootTaskId],
  );

  // 新建任务后,等节点被布局产出再补上编辑态(直接 patch 会因节点尚未存在而漏掉)
  useEffect(() => {
    const p = pendingEdit.current;
    if (!p) return;
    if (nodesRef.current.some((n) => n.id === p.id)) {
      patchEdit(p.id, true);
      pendingEdit.current = null;
    }
  }, [nodes, patchEdit]);

  // 「已完成项隐藏」模式:整棵子树都完成的节点不出图(布局自动收拢);
  // 已完成但子级仍在进行的保持灰色可见。设置切换即时生效。
  const hideDone = (data.settings.completedDisplay ?? 'inline-gray') === 'hidden';
  const tasks = useMemo(() => {
    const base = activeTasks(data.tasks).filter((t) => t.status !== 'inbox');
    if (!hideDone) return base;
    const gone = fullyDoneIds(data.tasks);
    return base.filter((t) => !gone.has(t.id));
  }, [data.tasks, hideDone]);
  const childrenMap = useMemo(() => buildChildrenMap(tasks), [tasks]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const progress = useMemo(() => workProgress(tasks), [tasks]);
  const hiddenRoots = data.settings.hiddenRoots ?? EMPTY_IDS;
  const scopedTasks = useMemo(() => {
    if (rootTaskId) {
      const ids = descendantsOf(rootTaskId, childrenMap).add(rootTaskId);
      return tasks.filter((task) => ids.has(task.id));
    }
    const hidden = new Set<string>();
    for (const id of hiddenRoots) {
      hidden.add(id);
      for (const child of descendantsOf(id, childrenMap)) hidden.add(child);
    }
    return tasks.filter((task) => !hidden.has(task.id));
  }, [tasks, childrenMap, rootTaskId, hiddenRoots]);
  const signals = useMemo(
    () => workSignals(scopedTasks, data.events, now, data.settings.weekStartsOn),
    [scopedTasks, data.events, now, data.settings.weekStartsOn],
  );
  const matches = data.hasTaskFilters ? data.matchingTaskIds : null;
  const contextIds = useMemo(
    () =>
      matches
        ? taskContextIds(tasks, [...matches, ...newTaskIds, ...(selectedTask ? [selectedTask.id] : [])])
        : null,
    [tasks, matches, newTaskIds, selectedTask],
  );
  const contextKey = contextIds ? [...contextIds].sort().join(',') : '*';
  const contextIdsRef = useRef(contextIds);
  contextIdsRef.current = contextIds;
  useEffect(() => { setNewTaskIds([]); }, [filterParams]);
  const fonts = useMindFonts(scopedTasks);
  const camera = useMapViewport(store.userId, rootTaskId, nodes, wrapperRef);

  /** 令某节点进入行内标题编辑;seed = 起始按键字符(无则沿用现有标题)。
   *  节点已在图中 → 直接 patch;新建节点尚未入图 → 记入 pendingEdit,等布局产出后补齐。 */
  const beginEdit = useCallback(
    (id: string, seed?: string | null) => {
      editingIds.current.add(id);
      seedById.current[id] = seed ?? null;
      if (nodesRef.current.some((n) => n.id === id)) patchEdit(id, true);
      else pendingEdit.current = { id, seed: seed ?? null };
    },
    [patchEdit],
  );

  /** 提交行内标题:写回 CRDT 并退出编辑态 */
  const commitTitle = useCallback(
    (id: string, title: string) => {
      const clean = title.trim() || 'Untitled';
      const task = byId.get(id);
      if (task && task.title !== clean) {
        store.updateTask(id, { title: clean });
        store.stopUndoCapture(); // 一次标题提交 = 一个撤销单元
      }
      delete seedById.current[id];
      patchEdit(id, false);
    },
    [store, byId, patchEdit],
  );

  /** 提交编辑后把键盘焦点还给导图容器,让「再按回车 = 再新建」连续可用 */
  const refocusWrapper = useCallback(() => {
    wrapperRef.current?.focus();
  }, []);

  /** 可见性:被任何 collapsed 节点覆盖的后代标记隐藏,折叠后再展开即恢复 */
  const hiddenIds = useMemo(() => {
    const hidden = new Set<string>();
    for (const [cid, isCollapsed] of Object.entries(collapsed)) {
      if (!isCollapsed) continue;
      const stack = [cid];
      while (stack.length) {
        const cur = stack.pop()!;
        for (const c of childrenMap.get(cur) ?? []) {
          hidden.add(c.id);
          stack.push(c.id);
        }
      }
    }
    return hidden;
  }, [collapsed, childrenMap]);

  const kidsOf = useCallback(
    (id: string | null) =>
      (childrenMap.get(id) ?? []).filter(
        (c) => !hiddenIds.has(c.id),
      ),
    [childrenMap, hiddenIds],
  );

  /** 可见的根(虚拟根或指定任务);「全部」模式下应用用户的根任务显隐设置 */
  const rootChildren = useMemo(() => {
    const visible = (list: Task[]) =>
      list.filter(
        (t) =>
          !hiddenIds.has(t.id) &&
          (rootTaskId != null || !hiddenRoots.includes(t.id)),
      );
    if (rootTaskId) {
      const root = byId.get(rootTaskId);
      return root ? visible([root]) : visible(childrenMap.get(null) ?? []);
    }
    return visible(childrenMap.get(null) ?? []);
  }, [rootTaskId, byId, childrenMap, hiddenIds, hiddenRoots]);

  /** 布局输入:「全部」时以虚拟真根为唯一根,顶层任务全部连到它上面;单根时直接用该根 */
  const layoutRoots = useMemo(
    () => (rootTaskId ? rootChildren : [virtualRootTask]),
    [rootTaskId, rootChildren, virtualRootTask],
  );
  const layoutKids = useCallback(
    (id: string | null) => (id === VIRTUAL_ROOT_ID ? rootChildren : kidsOf(id)),
    [rootChildren, kidsOf],
  );

  // ResizeObserver measurements refine estimated text heights without resetting selection or camera.
  const measuredKey = nodes.map((node) => `${node.id}:${node.measured?.width ?? 0}:${node.measured?.height ?? 0}`).join('|');
  const applyLayout = useCallback(() => {
    if (!rootChildren.length) { setNodes([]); setEdges([]); return; }
    const previousNodes = new Map(nodesRef.current.map((node) => [node.id, node]));
    const exclusive = selectOnCreateRef.current;
    const metadata = new Map<string, { task: Task; parent: string | null; depth: number; font: MindFont | null; metrics: ReturnType<typeof mindMetrics> }>();
    const sizes = new Map<string, { width: number; height: number }>();
    const pending = layoutRoots.map((task) => ({ task, parent: null as string | null, depth: 0, font: null as MindFont | null }));
    const labelFor = (task: Task) => [
      signals.doing.has(task.id) ? '进行中' : '',
      signals.overdue.has(task.id) ? '逾期' : signals.unscheduled.has(task.id) ? '重要未排期' : signals.week.has(task.id) && !signals.doing.has(task.id) ? '本周安排' : '',
    ].filter(Boolean).join(' · ');
    while (pending.length) {
      const item = pending.pop()!;
      const font = item.task.mindFontFamily ?? item.font;
      const footer = (progress.get(item.task.id)?.total ?? 0) > 0 || !!labelFor(item.task);
      const metrics = mindMetrics(item.task, item.depth, footer, font);
      metadata.set(item.task.id, { ...item, font, metrics });
      const previous = previousNodes.get(item.task.id);
      // Keep the last DOM measurement until ResizeObserver reports an actual size change.
      // Clearing it during a relayout also clears React Flow's connection anchors.
      const valid = previous?.measured?.width === metrics.width;
      sizes.set(item.task.id, editingIds.current.has(item.task.id) && previous?.measured?.width && previous.measured.height
        ? { width: previous.measured.width, height: previous.measured.height }
        : { width: metrics.width, height: valid && previous.measured?.height ? previous.measured.height : metrics.height });
      for (const child of layoutKids(item.task.id)) pending.push({ task: child, parent: item.task.id, depth: item.depth + 1, font });
    }
    const positions = layoutMindTree(layoutRoots, layoutKids, sizes);
    const nextNodes: Node<NodeData>[] = [];
    const nextEdges: Edge[] = [];
    for (const [id, item] of metadata) {
      const position = positions.get(id)!;
      const previous = previousNodes.get(id);
      const muted = !!contextIdsRef.current && id !== VIRTUAL_ROOT_ID && !contextIdsRef.current.has(id);
      nextNodes.push({
        ...previous,
        id, type: 'task', position: { x: position.x, y: position.y },
        draggable: id !== VIRTUAL_ROOT_ID && !editingIds.current.has(id) && id !== rootTaskId,
        selectable: id !== VIRTUAL_ROOT_ID,
        selected: exclusive ? id === exclusive : previous?.selected ?? false,
        data: {
          task: item.task, depth: item.depth, side: position.side, branch: position.branch,
          metrics: item.metrics, font: item.font, muted,
          progress: progress.get(id) ?? { done: 0, total: 0 },
          hasChildren: (childrenMap.get(id)?.length ?? 0) > 0,
          signalLabel: labelFor(item.task),
          attention: signals.overdue.has(id) || signals.unscheduled.has(id),
          editing: editingIds.current.has(id), seedChar: seedById.current[id] ?? null,
          onCommit: (title: string) => commitTitle(id, title), onRefocus: refocusWrapper,
        },
      });
      if (item.parent) nextEdges.push({
        id: `${item.parent}->${id}`, source: item.parent, target: id,
        sourceHandle: `source-${position.side}`, targetHandle: `target-${position.side === 'left' ? 'right' : 'left'}`,
        type: EDGE_TYPE[edgeStyle],
        style: { stroke: branchColor(position.branch), strokeWidth: item.depth === 1 ? 2 : 1.4, opacity: muted ? 0.16 : 0.7, strokeLinecap: 'round' },
      });
    }
    selectOnCreateRef.current = null;
    // A ResizeObserver or selection update may already be queued since this render.
    // Merge with the latest state, so a layout never erases its measurements/selection.
    setNodes((current) => {
      const latest = new Map(current.map((node) => [node.id, node]));
      return nextNodes.map((node) => {
        const live = latest.get(node.id);
        return live ? {
          ...node,
          measured: live.measured,
          selected: exclusive ? node.selected : live.selected,
          dragging: live.dragging,
        } : node;
      });
    });
    setEdges(nextEdges);
  }, [rootChildren, layoutRoots, layoutKids, childrenMap, edgeStyle, setNodes, setEdges, commitTitle, refocusWrapper, progress, signals, rootTaskId, fonts.revision]);

  useEffect(() => {
    if (!draggingId.current) applyLayout();
  }, [applyLayout, measuredKey, relayoutTick]);

  // Highlighting a selection changes only its context, never measures or lays out the graph.
  useEffect(() => {
    const muted = (id: string) => !!contextIds && id !== VIRTUAL_ROOT_ID && !contextIds.has(id);
    setNodes((previous) => {
      let changed = false;
      const next = previous.map((node) => {
        const value = muted(node.id);
        if (node.data.muted === value) return node;
        changed = true;
        return { ...node, data: { ...node.data, muted: value } };
      });
      return changed ? next : previous;
    });
    setEdges((previous) => {
      let changed = false;
      const next = previous.map((edge) => {
        const opacity = muted(edge.target) ? 0.16 : 0.7;
        if (edge.style?.opacity === opacity) return edge;
        changed = true;
        return { ...edge, style: { ...edge.style, opacity } };
      });
      return changed ? next : previous;
    });
  }, [contextKey, setNodes, setEdges]);

  const onNodeDragStart = useCallback((_e: unknown, node: Node) => {
    draggingId.current = node.id;
  }, []);

  /** 三段式落点判定(与列表一致):拖动节点中心落在目标节点
   *  上沿外=插它前面 · 下沿外=插它后面 · 中段=挂为它的子任务 */
  const computeDrop = useCallback((node: Node): { targetId: string | null; mode: 'child' | 'before' | 'after' } => {
    const hits = getIntersectingNodes(node).filter((n) => n.id !== node.id);
    const t = hits[0];
    if (!t) return { targetId: null, mode: 'child' };
    const dh = node.measured?.height ?? 44;
    const th = t.measured?.height ?? 44;
    const rel = (node.position.y + dh / 2 - (t.position.y + th / 2)) / th;
    if (rel < -0.35) return { targetId: t.id, mode: 'before' };
    if (rel > 0.35) return { targetId: t.id, mode: 'after' };
    if (!canReparent(node.id, t.id === VIRTUAL_ROOT_ID ? null : t.id, childrenMap))
      return { targetId: null, mode: 'child' };
    return { targetId: t.id, mode: 'child' };
  }, [getIntersectingNodes, childrenMap]);

  // 拖拽中实时提示
  const onNodeDrag = useCallback((_e: unknown, node: Node) => {
    const { targetId, mode } = computeDrop(node);
    setDropHint((prev) =>
      prev?.id === targetId && prev.mode === mode ? prev : targetId ? { id: targetId, mode } : null,
    );
  }, [computeDrop]);

  // dropHint → 烘到节点 data 上,让目标节点显示对应的提示样式
  useEffect(() => {
    setNodes((ns) =>
      ns.map((n) => {
        const hint = dropHint?.id === n.id ? dropHint.mode : undefined;
        return n.data.dropHint === hint ? n : { ...n, data: { ...n.data, dropHint: hint } };
      }),
    );
  }, [dropHint, setNodes]);

  const applyDragResult = useCallback((node: Node) => {
    const draggedTask = byId.get(node.id);
    if (!draggedTask) return;
    const { targetId, mode } = computeDrop(node);

    // 1) 非根节点拖到虚拟真根上 = 升为根任务(排末尾)
    if (targetId === VIRTUAL_ROOT_ID && draggedTask.parentId != null) {
      const roots = childrenMap.get(null) ?? [];
      store.reparent(node.id, null, (roots.at(-1)?.order ?? 0) + 1);
      return;
    }

    // 2) 同级插前/插后:落到目标的上/下沿,插进它的兄弟队列(可跨分支平移)
    if (targetId && targetId !== VIRTUAL_ROOT_ID && targetId !== node.id && mode !== 'child') {
      const targetTask = byId.get(targetId);
      const parent = targetTask?.parentId ?? null;
      if (targetTask && parent !== node.id && canReparent(node.id, parent, childrenMap)) {
        const siblings = (childrenMap.get(parent) ?? []).filter((t) => t.id !== node.id);
        const i = siblings.findIndex((t) => t.id === targetId);
        if (i >= 0) {
          const prev = mode === 'after' ? siblings[i] : siblings[i - 1];
          const next = mode === 'after' ? siblings[i + 1] : siblings[i];
          store.reparent(node.id, parent, newOrder(prev?.order, next?.order));
          if (gapTooSmall(prev?.order, next?.order)) store.renumberParent(parent);
          return;
        }
      }
    }

    // 3) 中段 = 挂为它的子任务(不能挂到自己/自己的后代上)
    if (targetId && targetId !== VIRTUAL_ROOT_ID && targetId !== node.id && mode === 'child') {
      const descendants = new Set<string>();
      const stack = [node.id];
      while (stack.length) {
        const cur = stack.pop()!;
        for (const c of childrenMap.get(cur) ?? []) {
          descendants.add(c.id);
          stack.push(c.id);
        }
      }
      if (!descendants.has(targetId)) {
        const siblings = childrenMap.get(targetId) ?? [];
        store.reparent(node.id, targetId, (siblings.at(-1)?.order ?? 0) + 1);
        return;
      }
    }

    // 4) 空白处松手 = 在同父级的兄弟之间按上下位置调序
    //    单根视图里拖"被查看的根"本身没有意义,忽略。
    if (rootTaskId != null && draggedTask.parentId == null) return;
    const siblings = (childrenMap.get(draggedTask.parentId) ?? []).filter((t) => t.id !== node.id);
    const yOf = (id: string) => nodesRef.current.find((n) => n.id === id)?.position.y;
    const y = node.position.y;
    let idx = siblings.length;
    for (let i = 0; i < siblings.length; i++) {
      const ry = yOf(siblings[i]!.id);
      if (ry != null && ry > y) {
        idx = i;
        break;
      }
    }
    const prev = idx > 0 ? siblings[idx - 1] : undefined;
    const next = siblings[idx];
    store.reparent(node.id, draggedTask.parentId, newOrder(prev?.order, next?.order));
    if (gapTooSmall(prev?.order, next?.order)) store.renumberParent(draggedTask.parentId);
  }, [byId, childrenMap, store, rootTaskId]);

  /** 拖动只是"改变关系"的手势:不保留自由位移,松手后一律回到整洁布局 */
  const onNodeDragStop = useCallback((_e: unknown, node: Node) => {
    draggingId.current = null;
    applyDragResult(node);
    setDropHint(null);
    store.stopUndoCapture(); // 一次拖拽(挂靠 + 可能的重编号)= 一个撤销单元
    bumpRelayout();
  }, [applyDragResult, store]);

  const addChild = (parentId: string) => {
    const siblings = childrenMap.get(parentId) ?? [];
    const parent = byId.get(parentId);
    const created = store.createTask({
      title: '',
      ...workspaceTaskDefaults(new URLSearchParams(window.location.search), undefined, windowDueAt(range)),
      parentId,
      order: (siblings.at(-1)?.order ?? 0) + 1,
      important: parent?.important ?? false,
      urgent: parent?.urgent ?? false,
    });
    if (created) {
      setNewTaskIds((ids) => [...ids, created.id]);
      if (collapsed[parentId]) useUI.getState().toggleCollapsed(parentId);
      store.stopUndoCapture(); // 新建 = 一个撤销单元
      selectOnCreateRef.current = created.id; // 新建即选中:紧接着 Delete 删的就是它
      setSelectedTask(created);
      setSideOpen(false);
      beginEdit(created.id, '');
    }
  };

  const addSibling = (taskId: string) => {
    const task = byId.get(taskId);
    if (!task) return;
    const siblings = childrenMap.get(task.parentId ?? null) ?? [];
    const idx = siblings.findIndex((t) => t.id === taskId);
    const next = siblings[idx + 1];
    const created = store.createTask({
      title: '',
      ...workspaceTaskDefaults(new URLSearchParams(window.location.search), undefined, windowDueAt(range)),
      parentId: task.parentId,
      order: newOrder(task.order, next?.order),
      important: task.important ?? false,
      urgent: task.urgent ?? false,
    });
    if (created) {
      setNewTaskIds((ids) => [...ids, created.id]);
      store.stopUndoCapture(); // 新建 = 一个撤销单元
      selectOnCreateRef.current = created.id; // 新建即选中:紧接着 Delete 删的就是它
      setSelectedTask(created);
      setSideOpen(false);
      beginEdit(created.id, '');
    }
  };

  const handleSelect = useCallback((id: string) => {
    // 把键盘焦点放到导图容器上:这样 Enter/Tab 一定落在容器(非按钮/输入框),不会被守卫拦
    wrapperRef.current?.focus({ preventScroll: true });
    setSelectedTask(byId.get(id) ?? null);
    setSideOpen(false);
  }, [byId]);

  // Plain mouse presses select immediately. Leave modifiers, touch scrolling and
  // node controls to their existing handlers, and retain a selected drag batch.
  const onPointerDownCapture = useCallback((event: React.PointerEvent) => {
    if (event.pointerType !== 'mouse' || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, button, a, [contenteditable], .nodrag')) return;
    const id = target.closest('.react-flow__node')?.getAttribute('data-id');
    if (!id || id === VIRTUAL_ROOT_ID || !byId.has(id)) return;
    setNodes((previous) => {
      const targetNode = previous.find((node) => node.id === id);
      if (!targetNode || targetNode.selected) return previous;
      return previous.map((node) => {
        const selected = node.id === id;
        return !!node.selected === selected ? node : { ...node, selected };
      });
    });
    handleSelect(id);
  }, [byId, handleSelect, setNodes]);

  // Stable callbacks let React Flow keep unrelated node wrappers memoized when
  // selection changes. Read the current selection from its single source above.
  const onSelectionChange = useCallback(({ nodes: selection }: { nodes: Node[] }) => {
    const key = selection.map((node) => node.id).sort().join(',');
    if (key === lastSelKeyRef.current) return;
    lastSelKeyRef.current = key;
    if (selection.filter((node) => node.id !== VIRTUAL_ROOT_ID).length !== 1) {
      setSelectedTask(null);
      setSideOpen(false);
    }
  }, []);
  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    if ((event.target as HTMLElement).closest('input, textarea, select')) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey || node.id === VIRTUAL_ROOT_ID) {
      wrapperRef.current?.focus({ preventScroll: true });
      setSelectedTask(null);
      setSideOpen(false);
      return;
    }
    handleSelect(node.id);
  }, [handleSelect]);
  const onNodeDoubleClick = useCallback((_event: React.MouseEvent, node: Node) => {
    if (node.id === VIRTUAL_ROOT_ID) return;
    handleSelect(node.id);
    beginEdit(node.id);
  }, [handleSelect, beginEdit]);
  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    if (node.id === VIRTUAL_ROOT_ID) return;
    handleSelect(node.id);
    const batch = nodesRef.current.filter((item) => item.selected && item.id !== node.id && item.id !== VIRTUAL_ROOT_ID).map((item) => item.id);
    openTaskMenu(node.id, event.clientX, event.clientY, batch.length ? [...batch, node.id] : undefined);
  }, [handleSelect, openTaskMenu]);
  const onPaneClick = useCallback(() => {
    wrapperRef.current?.focus({ preventScroll: true });
    setSelectedTask(null);
    setSideOpen(false);
  }, []);

  // 选中节点后的键盘(挂在容器上,焦点已由 handleSelect 移到容器):
  // TAB=加子,Enter=加同级;某个可打印字符 → 直接进入该节点标题的编辑(首键即输入)。
  // 若该节点已在编辑态但输入框丢了焦点,再打字会重新播种(seedChar 变化)并重新聚焦。
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    if (!selectedTask) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest('input, textarea, select, button, a, [contenteditable="true"], [role="dialog"]')) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      addChild(selectedTask.id);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) { setAppearanceOpen(false); setSideOpen(true); }
      else if (selectedTask.id === rootTaskId || isProject(selectedTask)) addChild(selectedTask.id);
      else addSibling(selectedTask.id);
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      beginEdit(selectedTask.id, e.key);
    }
  };

  // Ctrl/Cmd+A selects visible diagram nodes; text editors retain native selection.
  useEffect(() => {
    const onSelectAll = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'a' || event.isComposing) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable], .xterm, [role="dialog"]')) return;
      if (target !== document.body && target !== document.documentElement && !mapRegionRef.current?.contains(target) && !focusToolbar?.contains(target)) return;
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      setNodes((previous) => previous.map((node) => ({ ...node, selected: node.id !== VIRTUAL_ROOT_ID })));
      setSelectedTask(null);
      setSideOpen(false);
      wrapperRef.current?.focus();
    };
    window.addEventListener('keydown', onSelectAll);
    return () => window.removeEventListener('keydown', onSelectAll);
  }, [setNodes, focusToolbar]);

  // 删除/退格 = 软删选中节点(选中 = RF 节点标志位,重排时 applyLayout 自携带;
  // 输入框聚焦时放行,让退格正常编辑文字)
  useEffect(() => {
    const onDelete = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      const t = e.target as HTMLElement | null;
      // 只在真正输入文字时放行;按钮/链接不再拦截(删除是有意为之的破坏性操作)
      if (e.isComposing || t?.closest('input, textarea, select, [contenteditable], [role="dialog"]')) return;
      if (t !== document.body && !wrapperRef.current?.contains(t)) return;
      // 选中集合 = 当前节点的 selected 标志(点选/框选/新建聚焦都在上面)
      const ids = nodesRef.current.filter((n) => n.selected && n.id !== VIRTUAL_ROOT_ID).map((n) => n.id);
      if (ids.length === 0) return;
      e.preventDefault();
      if (store.getData().tasks.some((task) => ids.includes(task.id) && isProject(task))) {
        useUI.getState().requestTaskDeletion(store.userId, ids);
        return;
      }
      store.stopUndoCapture();
      for (const id of ids) store.softDeleteTask(id);
      store.stopUndoCapture(); // 整批删除 = 一个撤销单元(⌘Z 一次全回来)
      pendingEdit.current = null;
      setSelectedTask(null);
      setSideOpen(false);
      setNodes((ns) => ns.filter((n) => !ids.includes(n.id)).map((n) => ({ ...n, selected: false })));
      // 数据变化理应触发重排;再兜底强制一次,防止个别 dep 未变导致节点残留/复活
      bumpRelayout();
    };
    window.addEventListener('keydown', onDelete);
    return () => window.removeEventListener('keydown', onDelete);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, setNodes]);

  // 框选/点选计数(来自唯一真源,而非 RF 残留标记)
  const selectedNodes = nodes.filter((n) => n.selected && n.id !== VIRTUAL_ROOT_ID);
  const selectedCount = selectedNodes.length;

  return (
    <div ref={mapRegionRef} className="flex min-h-0 flex-1 flex-col">
      <div
        ref={wrapperRef}
        tabIndex={0}
        role="region"
        aria-label="任务导图画布"
        onKeyDown={handleKeyDown}
        onPointerDownCapture={onPointerDownCapture}
        className="relative min-h-0 flex-1 outline-none"
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onSelectionChange={onSelectionChange}
          nodeTypes={NODE_TYPES}
          multiSelectionKeyCode={MULTI_SELECTION_KEYS}
          edgeTypes={EDGE_TYPES}
          selectionOnDrag
          selectionMode={SelectionMode.Partial}
          selectNodesOnDrag={false}
          nodeDragThreshold={6}
          nodeClickDistance={6}
          deleteKeyCode={null}
          panOnDrag={PAN_BUTTONS}
          panOnScroll
          panOnScrollSpeed={panSpeed}
          zoomOnScroll={false}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onNodeContextMenu={onNodeContextMenu}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onPaneClick={onPaneClick}
          onPaneContextMenu={preventContextMenu}
          onMove={camera.onMove}
          onMoveEnd={camera.onMoveEnd}
          minZoom={0.12}
          maxZoom={2}
          proOptions={PRO_OPTIONS}
          className="mindmap-flow bg-[var(--mind-canvas)] [&_.react-flow__attribution]:hidden"
        >
          <Background gap={24} size={1} color="var(--mind-grid)" />
          <MapControls
            onRoot={camera.rootPosition}
            edgeStyle={edgeStyle}
            onEdgeStyleChange={(value) => store.updateSettings({ mindEdgeStyle: value })}
            panSpeed={panSpeed}
            onPanSpeedChange={setPanSpeed}
            configOpen={configOpen}
            onConfigOpenChange={onConfigOpenChange}
          />
          <MiniMap
            pannable
            zoomable
            className="!hidden lg:!block"
            maskColor="rgba(112,119,131,0.12)"
            style={MINIMAP_STYLE}
          />
        </ReactFlow>
        {fonts.failed && <p role="status" className="absolute left-14 top-3 rounded bg-[var(--background)] px-3 py-2 text-xs text-muted">字体暂未加载，已使用系统字体。</p>}
        {selectedCount > 0 && !configOpen && (
          <div className="absolute bottom-14 right-3 z-20 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs">
            <span>已选 {selectedCount} 项</span>
            {selectedCount === 1 && <button aria-label="查看所选任务详情" onClick={() => { setSelectedTask(selectedNodes[0]!.data.task); setAppearanceOpen(false); setSideOpen(true); }} className="flex items-center gap-1 rounded px-1 py-1 text-muted hover:text-foreground"><Info size={13} />详情</button>}
            <button
              aria-label="调整所选节点样式"
              aria-expanded={appearanceOpen}
              onClick={() => {
                setAppearanceOpen((open) => !open);
                setSideOpen(false);
              }}
              className="flex items-center gap-1 rounded px-1 py-1 text-muted hover:bg-[var(--surface)] hover:text-foreground"
            >
              <Palette size={13} />样式
            </button>
            <button
              onClick={() => {
                setNodes((ns) => ns.map((n) => ({ ...n, selected: false })));
                setAppearanceOpen(false);
                setSideOpen(false);
                setSelectedTask(null);
                refocusWrapper();
              }}
              className="text-muted hover:text-foreground"
            >
              清除
            </button>
          </div>
        )}
        {appearanceOpen && selectedCount > 0 && (
          <AppearancePanel
            tasks={selectedNodes.map((node) => node.data.task)}
            onChange={(patch) => store.setMindAppearance(selectedNodes.map((node) => node.id), patch)}
            onClose={() => { setAppearanceOpen(false); refocusWrapper(); }}
          />
        )}
        <TaskInspector
          task={sideOpen ? selectedTask : null}
          onAddChild={selectedTask ? () => addChild(selectedTask.id) : () => {}}
          onClose={() => setSideOpen(false)}
        />
        {!rootChildren.length && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted">
            {focusMode === 'all' ? '还没有任务' : '没有符合条件的任务，可切回全图查看。'}
          </div>
        )}
        <MapHelp />
      </div>
    </div>
  );
}

/** 可拖拽排序的根任务标签:拖动 = 调整根顺序(与画布内拖动、列表视图全部一致) */
function SortableRootChip({ task, active, onSelect }: { task: Task; active: boolean; onSelect: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onSelect}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'hidden max-w-[120px] shrink-0 cursor-grab touch-none truncate rounded-full px-2.5 py-1 text-xs md:inline-block active:cursor-grabbing',
        active ? 'gradient-bg text-white' : 'glass text-muted hover:text-foreground',
        isDragging && 'z-10 opacity-70',
      )}
      title={`${task.title || 'Untitled'}(可拖动排序)`}
    >
      {task.title || 'Untitled'}
    </button>
  );
}

export function MindMapView({ focusToolbar }: { focusToolbar?: HTMLElement | null }) {
  const data = useCortexData();
  const store = useCortex();
  const [params, setParams] = useSearchParams();
  const { range, now } = useTaskWindow();
  const projectId = params.get('project');
  // 根任务进 URL(?root=<id>):刷新/分享/回退都保留当前视图
  const rootTaskId = params.get('root') ?? params.get('project');
  const focusMode = readTaskFilters(params).focus;
  const rootContext = useMemo(() => {
    if (!range.scheduledOnly) return null;
    const dateParams = new URLSearchParams();
    for (const key of ['scope', 'from', 'to']) {
      const value = params.get(key);
      if (value) dateParams.set(key, value);
    }
    return selectWorkspaceTasks(data, dateParams, now).context;
  }, [data, params, now, range.scheduledOnly]);
  const setRootTaskId = (id: string | null) => {
    const next = new URLSearchParams(params);
    next.delete('project');
    if (id) next.set('root', id);
    else next.delete('root');
    setParams(next, { replace: true });
  };
  const roots = data.tasks
    .filter((t) => !t.parentId && !t.deletedAt && t.status !== 'inbox' && t.status !== 'archived' && (!rootContext || rootContext.has(t.id)))
    .sort(sortSiblings); // 按 order 排:标签行、画布、列表三处顺序一致,拖动换序才可见
  const hiddenRoots = data.settings.hiddenRoots ?? EMPTY_IDS;
  const visibleRoots = roots.filter((t) => !hiddenRoots.includes(t.id));
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // 点外部收起选择器
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !pickerRef.current?.contains(e.target)) setPickerOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [pickerOpen]);

  const toggleRoot = (id: string) => {
    store.updateSettings({
      hiddenRoots: hiddenRoots.includes(id) ? hiddenRoots.filter((x) => x !== id) : [...hiddenRoots, id],
    });
  };

  // 标签行拖拽 = 调整根顺序(order 字段全局一致)
  const chipSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const onChipDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = visibleRoots.findIndex((t) => t.id === active.id);
    const to = visibleRoots.findIndex((t) => t.id === over.id);
    if (from < 0 || to < 0) return;
    const others = visibleRoots.filter((t) => t.id !== active.id);
    const idx = to;
    const prev = idx > 0 ? others[idx - 1] : undefined;
    const next = others[idx];
    store.reparent(String(active.id), null, newOrder(prev?.order, next?.order));
    if (gapTooSmall(prev?.order, next?.order)) store.renumberParent(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!projectId && <div className="relative z-10 flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--border)] px-4 py-2 md:px-6">
        <button
          aria-label="显示全部项目"
          onClick={() => setRootTaskId(null)}
          className={cn(
            'rounded-full px-2.5 py-1 text-xs',
            rootTaskId == null ? 'gradient-bg text-white' : 'glass text-muted hover:text-foreground',
          )}
        >
          全部
        </button>
        <DndContext sensors={chipSensors} collisionDetection={closestCenter} onDragEnd={onChipDragEnd}>
          <SortableContext
            items={visibleRoots.slice(0, 6).map((t) => t.id)}
            strategy={horizontalListSortingStrategy}
          >
            {visibleRoots.slice(0, 6).map((t) => (
              <SortableRootChip
                key={t.id}
                task={t}
                active={rootTaskId === t.id}
                onSelect={() => setRootTaskId(t.id)}
              />
            ))}
          </SortableContext>
        </DndContext>
        {visibleRoots.length > 6 && (
          <span className="flex items-center gap-1 text-[10px] text-muted/60">
            <Crosshair className="h-3 w-3" />
            {visibleRoots.length - 6}+
          </span>
        )}

        {/* 根任务显隐管理:隐藏的根在「全部」视图不渲染,状态存 settings 随账号同步,刷新保留 */}
        <div ref={pickerRef} className="relative">
          <button
            onClick={() => setPickerOpen((o) => !o)}
            className={cn(
              'flex items-center gap-1 rounded-full px-2 py-1 text-xs',
              hiddenRoots.length > 0
                ? 'glass text-[var(--accent-from)]'
                : 'glass text-muted hover:text-foreground',
            )}
            title="选择「全部」视图里要显示哪些根任务"
          >
            {hiddenRoots.length > 0 ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {hiddenRoots.length > 0 && `隐 ${hiddenRoots.length}`}
          </button>
          {pickerOpen && (
            <div className="absolute left-0 top-full z-40 mt-1.5 max-h-[60vh] w-56 overflow-y-auto rounded-xl glass-raised p-1.5 shadow-xl">
              <div className="px-2 py-1 text-[10px] text-muted">
                「全部」视图显示的根任务(取消勾选 = 该根及其整棵子树不在图中显示)
              </div>
              {roots.map((t) => {
                const on = !hiddenRoots.includes(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => toggleRoot(t.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-muted transition-colors hover:bg-[var(--surface)] hover:text-foreground"
                  >
                    <span
                      className={cn(
                        'grid h-3.5 w-3.5 shrink-0 place-items-center rounded border',
                        on ? 'gradient-bg border-transparent text-white' : 'border-[var(--border-strong)]',
                      )}
                    >
                      {on && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                    </span>
                    <span className="truncate">{t.title || 'Untitled'}</span>
                  </button>
                );
              })}
              {roots.length === 0 && <div className="px-2 py-2 text-xs text-muted/60">还没有根任务</div>}
            </div>
          )}
        </div>
      </div>}
      <ReactFlowProvider key={`${store.userId}:${rootTaskId ?? VIRTUAL_ROOT_ID}`}>
        <MindMapInner rootTaskId={rootTaskId} focusMode={focusMode} focusToolbar={focusToolbar} />
      </ReactFlowProvider>
    </div>
  );
}
