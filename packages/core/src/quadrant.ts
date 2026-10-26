import { Task, Priority } from './types';
import { isStructural } from './tree';

export type QuadrantKey = 'do' | 'plan' | 'delegate' | 'eliminate';

/** 优先级 P0~P3 = 四象限(重要×紧急)的显式编码;两者互为同一事实 */
export const PRIORITY_META: Record<Priority, { label: string; important: boolean; urgent: boolean }> = {
  P0: { label: 'P0 · 重要且紧急', important: true, urgent: true },
  P1: { label: 'P1 · 重要', important: true, urgent: false },
  P2: { label: 'P2 · 紧急', important: false, urgent: true },
  P3: { label: 'P3 · 都可稍后', important: false, urgent: false },
};

export const PRIORITY_ORDER: Priority[] = ['P0', 'P1', 'P2', 'P3'];

/** 任务的显式优先级;缺省时回退到 important/urgent 推导,保证新老数据一致 */
export function priorityOf(task: Task): Priority {
  if (task.priority) return task.priority;
  if (task.important && task.urgent) return 'P0';
  if (task.important) return 'P1';
  if (task.urgent) return 'P2';
  return 'P3';
}

/** 优先级 → 重要/紧急(写数据时同时落两处,四象限与优先级不会漂移) */
export function quadrantFields(p: Priority): { important: boolean; urgent: boolean } {
  const m = PRIORITY_META[p];
  return { important: m.important, urgent: m.urgent };
}

/** 四象限 → 优先级(矩阵拖拽等按象限改任务时使用) */
export function quadrantToPriority(q: QuadrantKey): Priority {
  if (q === 'do') return 'P0';
  if (q === 'plan') return 'P1';
  if (q === 'delegate') return 'P2';
  return 'P3';
}

export const QUADRANTS: {
  key: QuadrantKey;
  title: string;
  sub: string;
  important: boolean;
  urgent: boolean;
}[] = [
  { key: 'plan', title: '计划', sub: '重要 · 不紧急', important: true, urgent: false },
  { key: 'do', title: '立即做', sub: '重要 · 紧急', important: true, urgent: true },
  { key: 'eliminate', title: '淘汰', sub: '不重要 · 不紧急', important: false, urgent: false },
  { key: 'delegate', title: '委托 / 快速处理', sub: '不重要 · 紧急', important: false, urgent: true },
];

export function quadrantOf(task: Task): QuadrantKey {
  if (task.important && task.urgent) return 'do';
  if (task.important && !task.urgent) return 'plan';
  if (!task.important && task.urgent) return 'delegate';
  return 'eliminate';
}

/** 进入四象限的任务:未完成、todo/doing、无日期或 7 天内(见 DESIGN §4.3) */
export function matrixTasks(tasks: Task[], now: Date): Task[] {
  // 不再按 7 天窗口过滤:远期有日期的任务也会在矩阵里消失,违背"设了时间就该看见"。
  // 由视图按到期先后排序、限量展示。保留未完成判定;结构性节点(非 TODO)不进矩阵。
  void now;
  return tasks.filter(
    (t) => !t.deletedAt && !isStructural(t) && (t.status === 'todo' || t.status === 'doing'),
  );
}
