import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  SelectionMode,
  useNodesState,
  useEdgesState,
  useReactFlow,
  BaseEdge,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
} from '@xyflow/react';
import {
  Crosshair,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Check,
  Maximize2,
  HelpCircle,
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
import { cn, Badge } from '@cortex/ui';
import {
  Task,
  activeTasks,
  buildChildrenMap,
  quadrantOf,
  newOrder,
  gapTooSmall,
  sortSiblings,
  canReparent,
  fullyDoneIds,
  QuadrantKey,
  isStructural,
  isProject,
  descendantsOf,
  workSignals,
  workProgress,
  taskContextIds,
  WORK_FOCUS,
  type WorkFocus,
} from '@cortex/core';
import { useCortex, useCortexData } from '@cortex/crdt';
import { useUI } from '@/state/ui';
import { TaskInspector } from '@/shared/TaskInspector';
import { TaskCheckbox } from '@/shared/components';

/** 层级树排布常量:同层纵向间距、父子横向间距、节点高度 */
const ROW_GAP = 28;
const COL_GAP = 64;
const NODE_H = 44;
// Non-interactive handles mark the exact node boundary. React Flow's default handles
// protrude beyond it, which leaves gaps beside cards and overlaps structural lines.
const HANDLE_STYLE: React.CSSProperties = {
  opacity: 0,
  width: 0,
  height: 0,
  minWidth: 0,
  minHeight: 0,
  border: 0,
};

// 语义色走 CSS 变量:随设置里的强调色/主题切换(mono 时自动转灰阶)
const QUAD_COLOR: Record<QuadrantKey, string> = {
  do: 'var(--quad-do)',
  plan: 'var(--quad-plan)',
  delegate: 'var(--quad-delegate)',
  eliminate: 'var(--quad-eliminate)',
};

/** 连线统一中性色:优先级只体现在节点卡片边框上,连线保持安静(此前跟随任务边框色,画面花) */
const EDGE_COLOR = 'var(--border-strong)';
/** 连线形态:舒缓曲线(默认)/ 直线 / 折线(自绘树形三段),存 settings.mindEdgeStyle 随账号同步 */
const EDGE_TYPE: Record<'curve' | 'straight' | 'step', string> = {
  curve: 'default',
  straight: 'straight',
  step: 'tree',
};
/** Use one neutral stroke throughout, including the segment beneath structural labels. */
const edgeWidth = (_depth: number) => 1.5;

/**
 * XMind 式层级树(右侧扇出、根在左):按节点物理尺寸排布,同层纵向堆叠、按列横向错开,
 * 物理上不可能重叠。纯函数,便于单测与后续微调。
 */
function tidyTreeLayout(
  roots: Task[],
  kidsOf: (id: string | null) => Task[],
): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();

  // 后序:子树整列竖直跨度(叶子=NODE_H;否则 = Σ子跨度 + 父子间隙)
  const span = (task: Task): number => {
    const kids = kidsOf(task.id);
    if (kids.length === 0) return NODE_H;
    let s = 0;
    for (const k of kids) s += span(k);
    return s + (kids.length - 1) * ROW_GAP;
  };

  // 前序:根垂直居中,子级向右一列、自顶向下堆叠
  const place = (task: Task, x: number, y: number) => {
    // The layout works in centerlines; React Flow positions use the top-left corner.
    pos.set(task.id, { x, y: y - NODE_H / 2 });
    const kids = kidsOf(task.id);
    if (kids.length === 0) return;
    const childX = x + nodeWidth(task) + COL_GAP;
    let cursor = y - span(task) / 2;
    for (const k of kids) {
      const s = span(k);
      place(k, childX, cursor + s / 2);
      cursor += s + ROW_GAP;
    }
  };

  // 多根:从上到下堆叠在 x=0 一列
  let y = 0;
  for (const r of roots) {
    place(r, 0, y + span(r) / 2);
    y += span(r) + ROW_GAP;
  }
  return pos;
}

/** 标题像素宽:canvas 实测(与真实 DOM 同字体),测不到的环境按 CJK/ASCII 估算。
 *  布局宽度必须等于卡片真实 DOM 宽度 —— 差一点,连线走廊就被吃掉
 *  (R17 根因:长标题卡片真实 ~256px,公式只算 200,64px 走廊剩 7.5px,
 *   折线在窄走廊里全部回折成"一坨乱线") */
let measureCtx: CanvasRenderingContext2D | null | undefined;
let uiFont: string | null = null;
const fontOf = (px: number, weight = '400') => {
  if (!uiFont && typeof document !== 'undefined')
    uiFont = getComputedStyle(document.body).fontFamily || 'system-ui';
  return `${weight} ${px}px ${uiFont ?? 'system-ui'}, sans-serif`;
};
function textWidth(s: string, font: string): number {
  const est = () => {
    let w = 0;
    for (const ch of s) w += /[⺀-鿿豈-﫿＀-￯]/.test(ch) ? 14 : 8;
    return w;
  };
  if (typeof document === 'undefined') return est();
  if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return est();
  measureCtx.font = font;
  return measureCtx.measureText(s).width;
}

function nodeWidth(t: Task): number {
  if (isStructural(t)) {
    // 结构标签:text-xs(12px medium)标题截断 150 + 进度徽标预算
    const label = Math.min(150, textWidth(t.title ?? '', fontOf(12, '500'))) + 38;
    return Math.min(200, Math.max(64, Math.round(label)));
  }
  // 任务卡片:text-sm(14px)标题截断 150;chrome = px-3×2 + 勾选框 16 + 象限点 8 + 3×gap8 + 徽标预算
  const title = Math.min(150, textWidth(t.title ?? '', fontOf(14)));
  return Math.min(260, Math.max(130, Math.round(24 + 16 + 8 + 8 + 8 + title + 28 + 6)));
}

/** 「全部」视图的虚拟真根:所有顶层根任务连到同一个点上 */
const VIRTUAL_ROOT_ID = '__cortex_all__';
const virtualRootTask: Task = {
  id: VIRTUAL_ROOT_ID,
  title: '全部任务',
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

interface NodeData extends Record<string, unknown> {
  task: Task;
  progress: { done: number; total: number };
  hasChildren: boolean;
  signalLabel?: string;
  attention?: boolean;
  /** 行内编辑标题 */
  editing: boolean;
  /** 开始编辑时预置的起始字符(从一个按键触发的情况) */
  seedChar?: string | null;
  /** 结构节点穿线粗细(= 该节点连入连线的粗细,随层级收细) */
  lineWidth?: number;
  /** 拖拽时该节点是落点目标:child=挂为子任务,before/after=同级插前/插后 */
  dropHint?: 'child' | 'before' | 'after';
  onCommit?: (title: string) => void;
  /** 提交后把键盘焦点还给导图容器(回车=继续新建) */
  onRefocus?: () => void;
}

function TaskNode({ data, selected }: NodeProps<Node<NodeData>>) {
  const { task, progress, hasChildren, editing, seedChar, lineWidth, dropHint, onCommit, onRefocus } = data;
  const toggleCollapsed = useUI((s) => s.toggleCollapsed);
  const isCollapsed = useUI((s) => !!s.collapsed[task.id]);
  const store = useCortex();
  // 结构节点 = 无边框文字标签,悬在连线上方(不压线、不遮线),不占卡片形态;
  // 任务节点框色 = 优先级(红 P0 / 橙 P1 / 蓝 P2 / 灰 P3),固定语义色不随主题变
  const structural = isStructural(task);
  const accent = QUAD_COLOR[quadrantOf(task)];
  const [draft, setDraft] = useState(task.title ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  // 进入编辑态:预置 seedChar(某按键触发)或现有标题,并显式聚焦 + 全选输入框。
  // 不依赖 autoFocus —— 新建节点要经两次提交(布局产出 → 补编辑态)才挂载输入框,autoFocus 常会落空;
  // focus 还可能被同帧的其它处理抹掉,故再用 rAF/短延时双保险补焦。
  useEffect(() => {
    if (!editing) return;
    setDraft(seedChar ?? task.title ?? '');
    const focusSel = () => {
      const el = inputRef.current;
      if (!el) return;
      if (document.activeElement !== el) {
        el.focus();
        el.select();
      }
    };
    focusSel();
    const r = requestAnimationFrame(focusSel);
    const t = setTimeout(focusSel, 60);
    return () => {
      cancelAnimationFrame(r);
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, seedChar]);

  const finish = () => onCommit?.(draft);

  return (
    <div
      className={cn(
        'group relative flex items-center transition-colors',
        !structural && 'gap-2 rounded-md border bg-[var(--background)] px-3 text-sm',
        !structural && selected && 'glow-border',
        editing && !structural && 'ring-2 ring-[var(--accent-from)] bg-[var(--surface-solid)]',
        task.status === 'done' && 'opacity-50',
      )}
      style={
        structural
          ? {
              // 子元素全是绝对定位,容器自身撑不出宽度;不给宽度的话左右 Handle 会挤在
              // 同一点上,ReactFlow 连不出任何线。显式取布局同款宽度,连线/子列起点都对齐
              width: nodeWidth(task),
              height: NODE_H,
            }
          : {
              // 卡片同样显式定宽:真实 DOM 宽 = 布局宽(nodeWidth 实测文字宽),
              // 子列走廊(COL_GAP)不再被超长标题吃掉 —— 卡片宽过假设时布局照旧把
              // 子列排在 64px 外,真实却只剩几px,折线/曲线全在窄缝里打架
              width: nodeWidth(task),
              // Cards, labels and the virtual root share the layout's centerline,
              // including on touch screens where the checkbox has a larger hit area.
              height: NODE_H,
              // 选中时加粗加光晕,而不是换色(换色会让人分不清"选中的是谁"和"哪个更紧急")
              borderColor: selected ? 'var(--accent-solid)' : 'var(--border-strong)',
              borderWidth: 1,
              boxShadow: undefined,
              ...(dropHint === 'child'
                ? { outline: '2px dashed var(--accent-from)', outlineOffset: 3, borderRadius: 12 }
                : dropHint
                  ? {
                      outline: '2px solid var(--accent-from)',
                      outlineOffset: 3,
                      borderRadius: 12,
                      borderTop: dropHint === 'after' ? '3px solid var(--accent-from)' : undefined,
                      borderBottom: dropHint === 'before' ? '3px solid var(--accent-from)' : undefined,
                    }
                  : {}),
            }
      }
    >
      {data.signalLabel && !editing && (
        <span
          className="pointer-events-none absolute -top-5 left-1 text-[10px] font-medium"
          style={{ color: data.attention ? 'var(--warning)' : 'var(--accent-solid)' }}
        >
          {data.signalLabel}
        </span>
      )}
      {/* Structural lines meet the boundary handles without extending into adjacent edges. */}
      {structural && (
        <span
          data-structural-line
          className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2"
          style={{ height: lineWidth ?? 2.5, background: EDGE_COLOR, opacity: 1 }}
        />
      )}
      {/* 拖拽提示:中段=挂子,上/下沿=同级插前/插后(与列表三段式一致) */}
      {dropHint && (
        <span className="pointer-events-none absolute -top-7 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full gradient-bg px-2 py-0.5 text-[10px] font-medium text-white shadow-lg">
          {task.id === VIRTUAL_ROOT_ID
            ? '↳ 升为根任务'
            : dropHint === 'child'
              ? '↳ 挂到它下面'
              : dropHint === 'before'
                ? '↳ 插到它前面'
                : '↳ 插到它后面'}
        </span>
      )}
      {/* 隐藏的连接锚点:让连线有明确起止点(缺了会连不出来);左侧入/右侧出,经典右向脑图 */}
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        // Absolute offsets start at the padding box; include a card's 1px border.
        style={{ ...HANDLE_STYLE, left: structural ? 0 : -1 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        style={{ ...HANDLE_STYLE, right: structural ? 0 : -1 }}
      />
      {/* 折叠钮:有直接子级才显示;stopPropagation 避免触发选中/拖动 */}
      {hasChildren && (
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            toggleCollapsed(task.id);
          }}
          className="absolute -right-2.5 -top-2.5 z-10 grid h-5 w-5 place-items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-solid)] text-[var(--foreground)] opacity-0 shadow-sm transition-all hover:scale-110 hover:bg-[var(--accent-from)] hover:text-white group-hover:opacity-100"
          title={isCollapsed ? '展开子级' : '收起子级'}
        >
          {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      )}
      {/* 便捷勾选:一键完成/取消完成;阻止冒泡,避免触发选中与节点拖动(虚拟真根/结构节点不可勾选) */}
      {task.id !== VIRTUAL_ROOT_ID && !structural && (
        <span onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <TaskCheckbox
            done={task.status === 'done'}
            onChange={() => store.toggleTaskDone(task.id)}
            className="!h-4 !w-4 rounded-md"
          />
        </span>
      )}
      {!structural && (
        <span
          className={cn('h-2 w-2 shrink-0 rounded-full', task.status !== 'done' && 'animate-breathe')}
          style={{ background: task.status === 'done' ? 'var(--success)' : accent }}
        />
      )}
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={finish}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
            if (e.key === 'Enter') {
              finish();
              onRefocus?.(); // 回车提交后把焦点还给容器,再按回车 = 再新建下一个
            } else if (e.key === 'Escape') {
              setDraft(task.title ?? '');
              e.currentTarget.blur();
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            'min-w-0 flex-1 rounded bg-transparent text-sm outline-none placeholder:text-muted/50',
            // 结构节点行内编辑:输入框落在标签的位置(中线上方),带底色才看得清
            structural &&
              'absolute bottom-[calc(50%+4px)] left-0 w-44 rounded-md bg-[var(--surface-solid)] px-1.5 ring-1 ring-[var(--accent-from)]',
          )}
          placeholder="输入标题…"
        />
      ) : structural ? (
        <span
          className={cn(
            'absolute inset-x-0 flex items-center justify-center gap-1 text-xs font-medium transition-colors',
            selected ? 'text-foreground' : 'text-muted group-hover:text-foreground',
          )}
          style={{
            // 文字悬在连线上方:连线锚定在节点竖直中线,标签整体抬到中线上方,不压线不遮线
            // (缝 4px:第一层穿线粗 4px 半高 2px,标签底到线面还留 2px)
            bottom: 'calc(50% + 4px)',
            // 拖放落点提示挪到标签上(容器本体是无形的,框它没有意义)
            ...(dropHint
              ? { outline: '2px dashed var(--accent-from)', outlineOffset: 3, borderRadius: 8 }
              : {}),
          }}
        >
          <span className="max-w-[150px] truncate">{task.title || 'Untitled'}</span>
          {progress.total > 0 && (
            <Badge className="!px-1.5 !py-0 !text-[9px]">
              {progress.done}/{progress.total}
            </Badge>
          )}
        </span>
      ) : (
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            task.status === 'done' && 'line-through',
            task.id === VIRTUAL_ROOT_ID && 'font-semibold',
          )}
        >
          {task.title || 'Untitled'}
        </span>
      )}
      {progress.total > 0 && !structural && (
        <Badge className="!px-1.5 !py-0 !text-[9px] shrink-0">
          {progress.done}/{progress.total}
        </Badge>
      )}
      {task.status === 'doing' && !structural && (
        <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-[var(--warning)]" title="进行中" />
      )}
    </div>
  );
}

const NODE_TYPES = { task: TaskNode };

/** 树形折线:横出 → 父子走廊中线竖干 → 横入目标,恰好三段、共用竖干、永不回折。
 *  RF 内置 step 是"两端各探 20px 再拐",走廊一窄(卡片实际宽过布局假设时)路径会
 *  越过目标 x 再折回,产生双竖线的回折 S 线 —— 大子树在折线模式下"一坨乱线"的根因 */
function TreeStepEdge({ id, sourceX, sourceY, targetX, targetY, style }: EdgeProps) {
  const mx = (sourceX + targetX) / 2;
  const path = `M ${sourceX} ${sourceY} L ${mx} ${sourceY} L ${mx} ${targetY} L ${targetX} ${targetY}`;
  return <BaseEdge id={id} path={path} style={style} />;
}
const EDGE_TYPES = { tree: TreeStepEdge };

/** 导图:任务森林的层级树。根在左、子向右;单击选中,双击或直接打字改标题,拖到别的节点上 = 重挂层级。 */
function MindMapInner({
  rootTaskId,
  focusMode,
  onFocusChange,
}: {
  rootTaskId: string | null;
  focusMode: WorkFocus;
  onFocusChange: (mode: WorkFocus) => void;
}) {
  const data = useCortexData();
  const store = useCortex();
  const collapsed = useUI((s) => s.collapsed);
  const openTaskMenu = useUI((s) => s.openTaskMenu);
  /** 连线形态(舒缓/直线/折线):存 settings 随账号同步,切换即重排应用到所有连线 */
  const edgeStyle = data.settings.mindEdgeStyle ?? 'curve';
  const { getIntersectingNodes, fitView, setCenter, getZoom } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  void onEdgesChange;
  const draggingId = useRef<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  /** 单击居中的延时器:双击(编辑)到来时取消 */
  const centerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const [newTaskIds, setNewTaskIds] = useState<string[]>([]);
  const [focusRevision, refreshFocus] = useReducer((value: number) => value + 1, 0);
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
  const pendingEdit = useRef<{ id: string; seed: string | null } | null>(null);

  /** 直接给某节点打上编辑态(不改布局,不触发 fitView 跳动)。
   *  编辑期间同时关闭节点拖拽:点击输入框内文本应是移动光标,
   *  而不是被拖拽手势/节点点击抢走焦点导致退出编辑。 */
  const patchEdit = useCallback(
    (id: string, editing: boolean) => {
      setNodes((ns) =>
        ns.map((n) =>
          n.id === id
            ? {
                ...n,
                draggable: !editing,
                data: { ...n.data, editing, seedChar: editing ? (seedById.current[id] ?? null) : null },
              }
            : n,
        ),
      );
    },
    [setNodes],
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
  const hiddenRoots = data.settings.hiddenRoots ?? [];
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
  const matches = focusMode === 'all' ? null : signals[focusMode];
  const emptyCurrent = focusMode === 'current' && matches?.size === 0 && newTaskIds.length === 0;
  const contextIds = useMemo(
    () =>
      matches && !emptyCurrent
        ? taskContextIds(tasks, [...matches, ...newTaskIds, ...(selectedTask ? [selectedTask.id] : [])])
        : null,
    [tasks, matches, emptyCurrent, newTaskIds, selectedTask],
  );
  const contextKey = contextIds ? [...contextIds].sort().join(',') : '*';
  useEffect(() => {
    setNewTaskIds([]);
    setSelectedTask(null);
    setSideOpen(false);
    if (!matches) return;
    const paths = taskContextIds(tasks, matches);
    useUI.setState((state) => {
      if (![...paths].some((id) => state.collapsed[id])) return state;
      const next = { ...state.collapsed };
      for (const id of paths) delete next[id];
      return { collapsed: next };
    });
    // Only an explicit focus/root change expands paths; ordinary edits keep the viewport stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMode, rootTaskId, focusRevision]);

  /** 令某节点进入行内标题编辑;seed = 起始按键字符(无则沿用现有标题)。
   *  节点已在图中 → 直接 patch;新建节点尚未入图 → 记入 pendingEdit,等布局产出后补齐。 */
  const beginEdit = useCallback(
    (id: string, seed?: string | null) => {
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
        (c) => !hiddenIds.has(c.id) && (!contextIds || contextIds.has(c.id)),
      ),
    [childrenMap, hiddenIds, contextIds],
  );

  /** 可见的根(虚拟根或指定任务);「全部」模式下应用用户的根任务显隐设置 */
  const rootChildren = useMemo(() => {
    const visible = (list: Task[]) =>
      list.filter(
        (t) =>
          !hiddenIds.has(t.id) &&
          (!contextIds || contextIds.has(t.id)) &&
          (rootTaskId != null || !hiddenRoots.includes(t.id)),
      );
    if (rootTaskId) {
      const root = byId.get(rootTaskId);
      return root ? visible([root]) : visible(childrenMap.get(null) ?? []);
    }
    return visible(childrenMap.get(null) ?? []);
  }, [rootTaskId, byId, childrenMap, hiddenIds, hiddenRoots, contextIds]);

  /** 布局输入:「全部」时以虚拟真根为唯一根,顶层任务全部连到它上面;单根时直接用该根 */
  const layoutRoots = useMemo(
    () => (rootTaskId ? rootChildren : [virtualRootTask]),
    [rootTaskId, rootChildren],
  );
  const layoutKids = useCallback(
    (id: string | null) => (id === VIRTUAL_ROOT_ID ? rootChildren : kidsOf(id)),
    [rootChildren, kidsOf],
  );

  /** 层级树坐标 → ReactFlow nodes/edges */
  const applyLayout = useCallback(() => {
    if (!rootChildren.length) {
      setNodes([]);
      setEdges([]);
      return;
    }
    const goal = tidyTreeLayout(layoutRoots, layoutKids);
    // 选中自携带:新 nodes 继承旧 nodes 的 selected;新建节点走一次性排他选中
    const prevSelected = new Set(nodesRef.current.filter((n) => n.selected).map((n) => n.id));
    const exclusive = selectOnCreateRef.current;
    const previousNodes = new Map(nodesRef.current.map((node) => [node.id, node]));
    const nextNodes: Node<NodeData>[] = [];
    const nextEdges: Edge[] = [];
    const visit = (task: Task, parentId: string | null, depth: number) => {
      const g = goal.get(task.id);
      if (!g) return;
      nextNodes.push({
        id: task.id,
        type: 'task',
        draggable: !previousNodes.get(task.id)?.data.editing && !(rootTaskId === task.id && isProject(task)),
        position: { x: g.x, y: g.y },
        selected: exclusive ? task.id === exclusive : prevSelected.has(task.id),
        data: {
          task,
          progress: progress.get(task.id) ?? { done: 0, total: 0 },
          hasChildren: (childrenMap.get(task.id)?.length ?? 0) > 0,
          signalLabel: [
            signals.doing.has(task.id) ? '进行中' : '',
            signals.overdue.has(task.id)
              ? '逾期'
              : signals.unscheduled.has(task.id)
                ? '重要未排期'
                : signals.week.has(task.id) && !signals.doing.has(task.id)
                  ? '本周安排'
                  : '',
          ]
            .filter(Boolean)
            .join(' · '),
          attention: signals.overdue.has(task.id) || signals.unscheduled.has(task.id),
          editing: previousNodes.get(task.id)?.data.editing ?? false,
          seedChar: seedById.current[task.id] ?? null,
          lineWidth: edgeWidth(depth), // 结构节点穿线粗细 = 连入它的连线粗细
          dropHint: undefined,
          onCommit: (title: string) => commitTitle(task.id, title),
          onRefocus: refocusWrapper,
        },
      });
      if (parentId) {
        nextEdges.push({
          id: `${parentId}->${task.id}`,
          source: parentId,
          target: task.id,
          type: EDGE_TYPE[edgeStyle],
          style: {
            stroke: EDGE_COLOR, // 统一中性色:不再按任务优先级/结构类型各自染色
            strokeWidth: edgeWidth(depth), // 粗细随层级收细,此外全图同款
            opacity: 1,
            strokeLinecap: 'round',
          },
        });
      }
      for (const c of layoutKids(task.id)) visit(c, task.id, depth + 1);
    };
    for (const root of layoutRoots) visit(root, null, 0);
    selectOnCreateRef.current = null; // 一次性排他选中消费掉
    setNodes(nextNodes);
    setEdges(nextEdges);
    // 注意:这里不自动 fitView —— 新增/删除节点只重排,视图保持稳定;
    // 视口校正只在挂载与切换根任务时做(见下方 effect)
  }, [
    layoutRoots,
    layoutKids,
    rootChildren,
    childrenMap,
    edgeStyle,
    setNodes,
    setEdges,
    commitTitle,
    refocusWrapper,
    progress,
    signals,
    rootTaskId,
  ]);

  // 校正视口的情形:初次挂载、切换根任务、根任务显隐变化、折叠/展开子树、已完成显隐切换(图变小自动收拢视口);
  // 平时的增删改一律保持用户当前视图
  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.18, duration: 0 }), 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootTaskId, focusMode, focusRevision, fitView]);

  // 数据/折叠状态变化 → 重布局(tasks 引用变化即触发,保证软删后的节点从图中移除)
  useEffect(() => {
    applyLayout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    rootChildren.length,
    childrenMap.size,
    tasks,
    contextKey,
    signals,
    relayoutTick,
    edgeStyle,
    JSON.stringify(rootChildren.map((t) => t.id + t.status + t.title)),
    JSON.stringify(collapsed),
  ]);

  const onNodeDragStart = (_e: unknown, node: Node) => {
    draggingId.current = node.id;
  };

  /** 三段式落点判定(与列表一致):拖动节点中心落在目标节点
   *  上沿外=插它前面 · 下沿外=插它后面 · 中段=挂为它的子任务 */
  const computeDrop = (node: Node): { targetId: string | null; mode: 'child' | 'before' | 'after' } => {
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
  };

  // 拖拽中实时提示
  const onNodeDrag = (_e: unknown, node: Node) => {
    const { targetId, mode } = computeDrop(node);
    setDropHint((prev) =>
      prev?.id === targetId && prev.mode === mode ? prev : targetId ? { id: targetId, mode } : null,
    );
  };

  // dropHint → 烘到节点 data 上,让目标节点显示对应的提示样式
  useEffect(() => {
    setNodes((ns) =>
      ns.map((n) => ({
        ...n,
        data: { ...n.data, dropHint: dropHint?.id === n.id ? dropHint.mode : undefined },
      })),
    );
  }, [dropHint, setNodes]);

  /** 拖动只是"改变关系"的手势:不保留自由位移,松手后一律回到整洁布局 */
  const onNodeDragStop = (_e: unknown, node: Node) => {
    draggingId.current = null;
    applyDragResult(node);
    setDropHint(null);
    store.stopUndoCapture(); // 一次拖拽(挂靠 + 可能的重编号)= 一个撤销单元
    bumpRelayout();
  };

  const applyDragResult = (node: Node) => {
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
  };

  const addChild = (parentId: string) => {
    const siblings = childrenMap.get(parentId) ?? [];
    const parent = byId.get(parentId);
    const created = store.createTask({
      title: '',
      status: 'todo',
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
      status: 'todo',
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

  const handleSelect = (id: string) => {
    // 把键盘焦点放到导图容器上:这样 Enter/Tab 一定落在容器(非按钮/输入框),不会被守卫拦
    wrapperRef.current?.focus();
    setSelectedTask(byId.get(id) ?? null);
    setSideOpen(true);
  };

  // 选中节点后的键盘(挂在容器上,焦点已由 handleSelect 移到容器):
  // TAB=加子,Enter=加同级;某个可打印字符 → 直接进入该节点标题的编辑(首键即输入)。
  // 若该节点已在编辑态但输入框丢了焦点,再打字会重新播种(seedChar 变化)并重新聚焦。
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    if (!selectedTask) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest('input, textarea, select, button, a')) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      addChild(selectedTask.id);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      addSibling(selectedTask.id);
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      beginEdit(selectedTask.id, e.key);
    }
  };

  // 删除/退格 = 软删选中节点(选中 = RF 节点标志位,重排时 applyLayout 自携带;
  // 输入框聚焦时放行,让退格正常编辑文字)
  useEffect(() => {
    const onDelete = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      const t = e.target as HTMLElement | null;
      // 只在真正输入文字时放行;按钮/链接不再拦截(删除是有意为之的破坏性操作)
      if (t?.closest('input, textarea, select') || t?.isContentEditable) return;
      // 选中集合 = 当前节点的 selected 标志(点选/框选/新建聚焦都在上面)
      const ids = nodesRef.current.filter((n) => n.selected && n.id !== VIRTUAL_ROOT_ID).map((n) => n.id);
      if (ids.length === 0) return;
      e.preventDefault();
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
  const selectedCount = nodes.filter((n) => n.selected && n.id !== VIRTUAL_ROOT_ID).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="region"
        className="shrink-0 border-b border-[var(--border)] px-4 py-2 md:px-6"
        aria-label="工作概览"
      >
        <div className="flex gap-1 overflow-x-auto pb-1 text-xs">
          {(
            [
              ['current', '当前工作', signals.current.size, '进行中或本周有安排的未完成任务'],
              ['doing', '进行中', signals.doing.size, '已明确标为进行中的任务'],
              ['week', '本周', signals.week.size, '本周的开始/截止区间或关联日程'],
              ['overdue', '逾期', signals.overdue.size, '截止时间已过且尚未完成'],
              ['unscheduled', '重要未排期', signals.unscheduled.size, 'P0/P1 任务，尚无日期或未来日程'],
              ['all', '全图', null, '查看所有任务与分支'],
            ] as const
          ).map(([mode, label, count, hint]) => (
            <button
              key={mode}
              type="button"
              aria-label={`${label}${count != null ? ` ${count}` : ''}`}
              aria-pressed={focusMode === mode}
              onClick={() => {
                onFocusChange(mode);
                refreshFocus();
              }}
              title={hint}
              className={cn(
                'shrink-0 rounded-md px-2.5 py-1.5 transition-colors',
                focusMode === mode
                  ? 'bg-[var(--selection)] font-medium text-[var(--accent-solid)]'
                  : 'text-muted hover:bg-[var(--surface)] hover:text-foreground',
              )}
            >
              {label}
              {count != null && <span className="ml-1.5 tabular-nums">{count}</span>}
            </button>
          ))}
        </div>
        <p className="pt-1 text-[10px] text-muted">
          {emptyCurrent
            ? '暂无进行中或本周安排，先展示全图。'
            : focusMode === 'all'
              ? '查看全部分支；点击上方数字可定位当前工作和待检查项。'
              : '保留任务所属的项目路径；进度按完整项目计算。'}
        </p>
      </div>
      <div
        ref={wrapperRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="relative min-h-0 flex-1 outline-none"
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onSelectionChange={({ nodes: sel }) => {
            // 选中事实由 RF 的标志位承载,这里只做跟随:非单选(框选多台/清空)时收起
            // 详情面板。面板的打开只来自单击(onNodeClick),编辑/重排期间不会被顶开。
            // RF 在重排后会用相同集合重发事件 —— 按内容去重,避免无谓的面板扰动。
            const key = sel
              .map((n) => n.id)
              .sort()
              .join(',');
            if (key === lastSelKeyRef.current) return;
            lastSelKeyRef.current = key;
            const real = sel.filter((n) => n.id !== VIRTUAL_ROOT_ID);
            if (real.length !== 1) {
              setSelectedTask(null);
              setSideOpen(false);
            }
          }}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          selectionOnDrag
          selectionMode={SelectionMode.Partial}
          selectNodesOnDrag={false}
          deleteKeyCode={null}
          panOnDrag={[1, 2]}
          panOnScroll
          zoomOnScroll={false}
          onNodeClick={(e, node) => {
            // 点击来自节点内输入框(编辑标题选光标)时不接管:否则把焦点还给画布容器
            // 会 blur 输入框 → 触发提交退出编辑
            if ((e.target as HTMLElement | null)?.closest('input, textarea, select')) return;
            // 虚拟真根不可选中/编辑,点它 = 取消当前选中
            if (node.id === VIRTUAL_ROOT_ID) {
              setSelectedTask(null);
              setSideOpen(false);
              return;
            }
            handleSelect(node.id);
            // 点击聚焦:平滑把该节点移到画面中心(保持当前缩放,不跳变)。
            // 延迟一拍:若随后来了双击(进入编辑)则取消 —— 编辑中途画布平移会让
            // 用户点向"文本原来的位置"而落空,失焦退出编辑。
            if (centerTimer.current) clearTimeout(centerTimer.current);
            const w = node.measured?.width ?? 160;
            const h = node.measured?.height ?? 44;
            centerTimer.current = setTimeout(() => {
              setCenter(node.position.x + w / 2, node.position.y + h / 2, {
                zoom: getZoom(),
                duration: 350,
              });
            }, 260);
          }}
          onNodeDoubleClick={(_e, node) => {
            if (node.id === VIRTUAL_ROOT_ID) return;
            if (centerTimer.current) clearTimeout(centerTimer.current);
            // 双击 = 行内编辑:只选中、不弹详情面板 —— 面板浮在画布右上角,
            // 会盖住正在编辑的节点,点文本就变成点面板 → 失焦退出编辑
            wrapperRef.current?.focus();
            setSelectedTask(byId.get(node.id) ?? null);
            setSideOpen(false);
            beginEdit(node.id);
          }}
          onNodeContextMenu={(e, node) => {
            e.preventDefault();
            if (node.id === VIRTUAL_ROOT_ID) return;
            handleSelect(node.id);
            // 已多选(框选)时,右键操作作用于整批
            // 右键时框选集合(>1)整批生效
            const batch = nodesRef.current.filter((n) => n.selected && n.id !== node.id).map((n) => n.id);
            openTaskMenu(node.id, e.clientX, e.clientY, batch.length > 0 ? [...batch, node.id] : undefined);
          }}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onPaneClick={() => {
            setSelectedTask(null);
            setSideOpen(false);
          }}
          onPaneContextMenu={(e) => e.preventDefault()}
          fitView
          minZoom={0.12}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          className={cn('[&_.react-flow__attribution]:hidden')}
        >
          <Background gap={24} size={1} color="var(--border)" />
          <Controls
            position="top-left"
            showInteractive={false}
            className="!glass-raised !rounded-md !border-none"
          />
          <MiniMap
            pannable
            zoomable
            className="!hidden lg:!block"
            maskColor="rgba(112,119,131,0.12)"
            style={{
              width: 140,
              height: 90,
              bottom: 52,
              right: 12,
              background: 'var(--surface-solid)',
              border: '1px solid var(--border)',
              borderRadius: 6,
            }}
          />
        </ReactFlow>
        {/* 回到全局视图:一键 fit 全图(单击节点会聚焦居中,用这个回来) */}
        <button
          onClick={() => fitView({ padding: 0.18, duration: 300 })}
          className="absolute bottom-3 right-3 z-20 flex items-center gap-1.5 rounded-xl glass-raised px-3 py-1.5 text-xs text-muted shadow-lg transition-colors hover:text-foreground"
          title="回到全局视图"
        >
          <Maximize2 className="h-3.5 w-3.5" /> 全局视图
        </button>
        {selectedCount > 0 && (
          <div className="absolute bottom-12 right-3 z-20 flex items-center gap-2 rounded-xl glass-raised px-3 py-1.5 text-xs">
            <span>已选 {selectedCount} 项</span>
            <button
              onClick={() => setNodes((ns) => ns.map((n) => ({ ...n, selected: false })))}
              className="text-muted hover:text-foreground"
            >
              清除
            </button>
          </div>
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
        <details className="absolute bottom-3 left-3 z-20 text-xs text-muted" aria-label="导图操作说明">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 shadow-sm">
            <HelpCircle size={14} />
            操作说明
            <ChevronDown size={12} />
          </summary>
          <div className="absolute bottom-full left-0 mb-2 max-h-[60vh] w-[min(300px,calc(100vw-48px))] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--background)] p-4 shadow-lg">
            <ul className="space-y-2 leading-relaxed">
              <li>单击选中，双击编辑标题。</li>
              <li>Tab 添加子任务，Enter 添加同级任务。</li>
              <li>拖到节点上调整层级，拖到空白处调整同级顺序。</li>
              <li>拖到“全部任务”可升为根任务。</li>
              <li>左键框选；滚轮平移；Ctrl/⌘ + 滚轮缩放。</li>
              <li>Delete 删除所选；Ctrl/⌘ + Z 撤销。</li>
            </ul>
            <div className="mt-4 flex items-center gap-1 border-t border-[var(--border)] pt-3">
              <span className="mr-0.5">连线</span>
              {(
                [
                  ['curve', '舒缓'],
                  ['straight', '直线'],
                  ['step', '折线'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => store.updateSettings({ mindEdgeStyle: k })}
                  className={cn(
                    'rounded-full px-2 py-0.5 transition-colors',
                    edgeStyle === k ? 'gradient-bg text-white' : 'text-muted hover:text-foreground',
                  )}
                  title={`连接线样式:${label}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </details>
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

export function MindMapView() {
  const data = useCortexData();
  const store = useCortex();
  const [params, setParams] = useSearchParams();
  const projectId = params.get('project');
  // 根任务进 URL(?root=<id>):刷新/分享/回退都保留当前视图
  const rootTaskId = params.get('root') ?? params.get('project');
  const focusParam = params.get('mindFocus');
  const focusMode: WorkFocus = WORK_FOCUS.includes(focusParam as WorkFocus)
    ? (focusParam as WorkFocus)
    : projectId ? 'all' : 'current';
  const setFocusMode = (mode: WorkFocus) => {
    const next = new URLSearchParams(params);
    next.set('mindFocus', mode);
    setParams(next, { replace: true });
  };
  const setRootTaskId = (id: string | null) => {
    const next = new URLSearchParams(params);
    next.delete('project');
    if (id) next.set('root', id);
    else next.delete('root');
    setParams(next, { replace: true });
  };
  const roots = data.tasks
    .filter((t) => !t.parentId && !t.deletedAt && t.status !== 'inbox' && t.status !== 'archived')
    .sort(sortSiblings); // 按 order 排:标签行、画布、列表三处顺序一致,拖动换序才可见
  const hiddenRoots = data.settings.hiddenRoots ?? [];
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
      <ReactFlowProvider>
        <MindMapInner rootTaskId={rootTaskId} focusMode={focusMode} onFocusChange={setFocusMode} />
      </ReactFlowProvider>
    </div>
  );
}
