import { Task } from './types';

/**
 * 任务「视图状态」= 完成度 + 开始/截止时间窗自动推导,无需用户手动维护:
 * - done / archived / inbox 直接沿用存储状态
 * - 手动 doing:手动标记优先,直接显示「进行中」
 * - 否则按时间窗:已过截止 → 已逾期;还没到开始 → 未开始;在窗内 → 进行中;没设时间 → 待办
 */
export type TaskViewStatus = 'todo' | 'planned' | 'running' | 'overdue' | 'done' | 'inbox' | 'archived';

export interface TaskViewStatusInfo {
  kind: TaskViewStatus;
  label: string;
  tone: 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'muted';
}

export function taskViewStatus(task: Task, now: Date = new Date()): TaskViewStatusInfo {
  if (task.status === 'done') return { kind: 'done', label: '已完成', tone: 'muted' };
  if (task.status === 'inbox') return { kind: 'inbox', label: '收件箱', tone: 'default' };
  if (task.status === 'archived') return { kind: 'archived', label: '归档', tone: 'muted' };
  if (task.status === 'doing') return { kind: 'running', label: '进行中', tone: 'success' };
  const t = now.getTime();
  if (task.dueAt != null && t >= task.dueAt) return { kind: 'overdue', label: '已逾期', tone: 'danger' };
  if (task.startAt != null && t < task.startAt) return { kind: 'planned', label: '未开始', tone: 'accent' };
  if (task.startAt != null || task.dueAt != null) return { kind: 'running', label: '进行中', tone: 'success' };
  return { kind: 'todo', label: '待办', tone: 'default' };
}