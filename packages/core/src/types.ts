/** 领域模型 — 见 DESIGN.md §3。时间戳一律 UTC epoch ms,渲染按本地时区。 */

export type ID = string;

/** 任务状态机: inbox → todo → done / archived */
export type TaskStatus = 'inbox' | 'todo' | 'doing' | 'done' | 'archived';
export type Priority = 'P0' | 'P1' | 'P2' | 'P3';

export interface Task {
  id: ID;
  title: string;
  notes?: string;
  status: TaskStatus;
  /**
   * 节点类型:todo = 可勾选完成的任务(默认,老数据缺省即 todo);
   * node = 结构性节点(分组/主题/里程碑)—— 无完成态、无状态/优先级/时间,
   * 各视图按纯容器渲染(列表/甘特无勾选框,矩阵/时间线不出现)。
   * 右击菜单或详情面板可双向转换。
   */
  kind?: 'todo' | 'node' | null;
  /** Explicit project identity. Legacy root structural nodes remain projects when omitted. */
  project?: boolean;
  parentId: ID | null; // 任意层级子任务(单亲森林)
  order: number; // 同级排序(数值中点法,见 order.ts)
  important: boolean;
  urgent: boolean;
  /** 显式优先级(P0~P3);未设置时由 important/urgent 推导(见 quadrant.priorityOf) */
  priority?: Priority | null;
  tags: ID[];
  startAt?: number | null; // 开始时间(UTC epoch ms);空 = 由 dueAt 推当天开头(见 taskRange)
  dueAt?: number | null; // UTC epoch ms
  estimateMin?: number;
  ownerId: ID;
  createdAt: number;
  updatedAt: number;
  completedAt?: number | null;
  deletedAt?: number | null; // 软删 = 回收站
}

export type EventKind = 'focus' | 'meeting' | 'personal' | 'routine';

export interface ScheduleEvent {
  id: ID;
  taskId: ID | null;
  title: string;
  start: number; // UTC epoch ms
  end: number;
  kind: EventKind;
  completed?: boolean;
  ownerId: ID;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

export type LinkType = 'obsidian' | 'yuque' | 'url' | 'agent' | 'tmux';

/** 服务器档案:归当前账号所有的 SSH 连接目标 */
export interface ServerConfig {
  id: ID;
  name: string; // 展示名,如「A100 训练机」
  host: string; // ssh 目标 user@host[:port],禁用宿主机 SSH 配置
  /** 仅用于读取旧备份;新凭据保存在服务端,不再写入 CRDT。 */
  password?: string;
  passwordSet?: boolean;
  registered?: boolean;
}

export interface TaskLink {
  id: ID;
  taskId: ID;
  type: LinkType;
  target: string; // obsidian://open?vault=..&file=.. | https://... | agent run url | tmux://<serverName>/<session>
  title?: string;
  /** type=tmux:服务器档案 id(settings.servers)与 tmux session 名,二者定位一个会话 */
  serverId?: string;
  session?: string;
  ownerId: ID;
  createdAt: number;
  deletedAt?: number | null;
}

export type FocusMode = 'focus' | 'short-break' | 'long-break';

export interface FocusSession {
  id: ID;
  taskId: ID | null;
  startedAt: number;
  endedAt: number;
  plannedMin: number;
  actualMin: number;
  mode: FocusMode;
  completed: boolean;
  distractions?: number;
  ownerId: ID;
}

export type Cadence =
  | { type: 'daily' }
  | { type: 'weekly'; timesPerWeek: number; days?: number[] } // days: 1=Mon..7=Sun,缺省为弹性
  | { type: 'interval'; everyNDays: number }
  | { type: 'custom'; cron: string }; // 后期

export interface Habit {
  id: ID;
  name: string;
  icon: string; // lucide 图标名
  color: string; // hex,热力图/卡片用
  cadence: Cadence;
  reminderAt?: string; // 'HH:mm' 本地时区
  linkedTaskTemplateId?: ID | null;
  targetPerDay?: number; // 每日多次打卡目标,如喝水 8 杯
  ownerId: ID;
  createdAt: number;
  archivedAt?: number | null;
  deletedAt?: number | null;
}

export interface HabitLog {
  id: ID;
  habitId: ID;
  date: string; // 'YYYY-MM-DD' 本地时区日界
  count: number;
  /** 不可变撤销记录引用的打卡单位(logId:index),并发撤销同一单位只扣一次。 */
  cancelledUnits?: string[];
  ownerId: ID;
}

export interface Tag {
  id: ID;
  name: string;
  color?: string;
  ownerId: ID;
  deletedAt?: number | null;
}

export interface PomodoroSettings {
  focusMin: number;
  shortBreakMin: number;
  longBreakMin: number;
  longEvery: number; // 每 N 个专注来一次长休
  autoStartBreak: boolean;
}

export const DEFAULT_POMODORO: PomodoroSettings = {
  focusMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  longEvery: 4,
  autoStartBreak: false,
};

export const ACCENTS = ['cyan-violet', 'emerald', 'amber', 'rose', 'mono'] as const;
export type Accent = (typeof ACCENTS)[number];

export type ReviewKind = 'daily' | 'weekly';
export interface ReviewPeriod {
  kind: ReviewKind;
  start: string; // Local YYYY-MM-DD, inclusive.
  end: string; // Local YYYY-MM-DD, exclusive.
}
export interface ReviewTaskFact { id: ID; title: string; project: string }
export interface ReviewFacts {
  capturedAt: number;
  completed: ReviewTaskFact[];
  pending: ReviewTaskFact[];
  focusMin: number;
  projects: { id: ID; title: string; done: number; total: number }[];
}
export interface Review {
  id: ID;
  kind: ReviewKind;
  periodStart: string;
  periodEnd: string;
  highlights: string;
  friction: string;
  nextSteps: string;
  facts: ReviewFacts | null;
  completedAt: number | null;
  ownerId: ID;
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  accent: Accent;
  pomodoro: PomodoroSettings;
  weekStartsOn: 0 | 1; // 0=Sun 1=Mon
  completedDisplay: 'inline-gray' | 'hidden'; // 已完成任务在任务视图中:原位变灰 / 隐藏
  hiddenRoots: string[]; // 导图「全部」视图里被隐藏的根任务 id(随账号同步)
  mindEdgeStyle: 'curve' | 'straight' | 'step'; // 导图连线样式:舒缓曲线/直线/折线(随账号同步)
  servers: ServerConfig[]; // 服务器档案(ssh 目标),任务关联 tmux 用
  reviewDailyEnabled: boolean;
  reviewDailyTime: string;
  reviewWeeklyEnabled: boolean;
  reviewWeeklyDay: number; // Date.getDay(): 0=Sun.
  reviewWeeklyTime: string;
}

export const DEFAULT_SETTINGS: Settings = {
  accent: 'cyan-violet',
  pomodoro: DEFAULT_POMODORO,
  weekStartsOn: 1,
  completedDisplay: 'inline-gray',
  hiddenRoots: [],
  mindEdgeStyle: 'curve',
  servers: [],
  reviewDailyEnabled: true,
  reviewDailyTime: '21:30',
  reviewWeeklyEnabled: true,
  reviewWeeklyDay: 0,
  reviewWeeklyTime: '20:00',
};

export interface CortexData {
  tasks: Task[];
  events: ScheduleEvent[];
  links: TaskLink[];
  sessions: FocusSession[];
  habits: Habit[];
  habitLogs: HabitLog[];
  tags: Tag[];
  reviews: Review[];
  settings: Settings;
}

export const EMPTY_DATA: CortexData = {
  tasks: [],
  events: [],
  links: [],
  sessions: [],
  habits: [],
  habitLogs: [],
  tags: [],
  reviews: [],
  settings: DEFAULT_SETTINGS,
};

/** 全量导出快照(备份/导入) */
export interface CortexSnapshot {
  format: 'cortex.export';
  version: 2;
  exportedAt: number;
  data: CortexData;
  docs: Record<string, string>;
}
