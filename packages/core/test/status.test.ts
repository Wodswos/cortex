import { describe, it, expect } from 'vitest';
import { taskViewStatus } from '../src/status';
import { priorityOf, quadrantToPriority, PRIORITY_ORDER } from '../src/quadrant';
import { Task } from '../src/types';

function task(over: Partial<Task>): Task {
  return {
    id: 't', title: 't', status: 'todo', parentId: null, order: 0,
    important: false, urgent: false, tags: [], ownerId: 'u',
    createdAt: 0, updatedAt: 0,
    ...over,
  };
}

// status 测试从 quadrant 与 status 模块分别导出
const t2 = task;

describe('taskViewStatus(自动状态: 完成 + 时间窗推导)', () => {
  const NOW = 1000;
  const now = new Date(NOW);

  it('已完成 → 已完成', () => {
    expect(taskViewStatus(t2({ status: 'done' }), now).label).toBe('已完成');
  });

  it('无时间窗 → 待办(不需手动状态)', () => {
    expect(taskViewStatus(t2({}), now)).toMatchObject({ kind: 'todo', label: '待办' });
  });

  it('在开始~截止时间窗内 → 进行中', () => {
    expect(taskViewStatus(t2({ startAt: 900, dueAt: 1200 }), now)).toMatchObject({ kind: 'running' });
  });

  it('还没到开始 → 未开始', () => {
    expect(taskViewStatus(t2({ startAt: 2000, dueAt: 3000 }), now)).toMatchObject({ kind: 'planned', label: '未开始' });
  });

  it('已过截止 → 已逾期', () => {
    expect(taskViewStatus(t2({ dueAt: 500 }), now)).toMatchObject({ kind: 'overdue', label: '已逾期' });
  });

  it('截止刚过边界即逾期(含等于)', () => {
    expect(taskViewStatus(t2({ dueAt: NOW }), now).kind).toBe('overdue');
  });

  it('手动 doing 优先于时间窗', () => {
    expect(taskViewStatus(t2({ status: 'doing', startAt: 2000, dueAt: 3000 }), now).kind).toBe('running');
  });

  it('收件箱/归档沿用', () => {
    expect(taskViewStatus(t2({ status: 'inbox' }), now).kind).toBe('inbox');
    expect(taskViewStatus(t2({ status: 'archived' }), now).kind).toBe('archived');
  });

  it('只设开始时间,当前在开始之后 → 进行中', () => {
    expect(taskViewStatus(t2({ startAt: 500 }), now).kind).toBe('running');
  });
});

describe('优先级(P0~P3 = 四象限)', () => {
  it('priorityOf:显式优先,否则由 important/urgent 推导', () => {
    expect(priorityOf(t2({ priority: 'P1', important: true, urgent: true }))).toBe('P1');
    expect(priorityOf(t2({ important: true, urgent: true }))).toBe('P0');
    expect(priorityOf(t2({ important: true }))).toBe('P1');
    expect(priorityOf(t2({ urgent: true }))).toBe('P2');
    expect(priorityOf(t2({}))).toBe('P3');
  });

  it('quadrantToPriority 与象限一致', () => {
    expect(quadrantToPriority('do')).toBe('P0');
    expect(quadrantToPriority('plan')).toBe('P1');
    expect(quadrantToPriority('delegate')).toBe('P2');
    expect(quadrantToPriority('eliminate')).toBe('P3');
  });

  it('PRIORITY_ORDER 为 P0→P3', () => {
    expect(PRIORITY_ORDER).toEqual(['P0', 'P1', 'P2', 'P3']);
  });
});