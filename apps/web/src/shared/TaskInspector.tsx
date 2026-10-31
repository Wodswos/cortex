import React from 'react';
import { Plus, X, MoreHorizontal, ChevronRight, CalendarDays, Flag, Folder } from 'lucide-react';
import { cn } from '@cortex/ui';
import { Task, ancestorsOf, isStructural, isProject, priorityOf, type Priority } from '@cortex/core';
import { useCortex, useCortexData } from '@cortex/crdt';
import { useUI } from '@/state/ui';
import { TaskCheckbox, DateTimeField } from './components';
import { isComposing } from './ime';
import { TaskResources } from './TaskResources';
import { useTaskTextDraft } from './useTaskTextDraft';

/** Shared task details, with advanced connection management behind one explicit action. */
export function TaskInspector({
  task: selectedTask,
  onAddChild,
  onClose,
  position,
  docked,
}: {
  task: Task | null;
  onAddChild: () => void;
  onClose: () => void;
  position?: { x: number; y: number };
  docked?: boolean;
}) {
  const data = useCortexData();
  const store = useCortex();
  const selectTask = useUI((s) => s.selectTask);
  const task = selectedTask ? (data.tasks.find((item) => item.id === selectedTask.id) ?? null) : null;
  const draft = useTaskTextDraft(task);
  if (!task) return null;
  const parents = ancestorsOf(task.id, new Map(data.tasks.map((item) => [item.id, item])));
  const children = data.tasks.filter((item) => item.parentId === task.id && !item.deletedAt);
  const node = isStructural(task);
  const style = !docked
    ? {
        right: position ? Math.max(12, window.innerWidth - position.x) : 12,
        top: position ? Math.max(12, Math.min(position.y, window.innerHeight - 430)) : 12,
      }
    : undefined;
  return (
    <section
      data-inspector
      aria-label="任务详情"
      style={style}
      className={cn(
        docked
          ? 'flex h-full min-h-0 w-full flex-col'
          : 'fixed z-30 flex max-h-[85vh] w-80 flex-col rounded-lg border border-[var(--border)] bg-[var(--background)] shadow-lg',
      )}
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--border)] px-5">
        <span className="text-xs text-muted">{isProject(task) ? '项目详情' : node ? '分组详情' : '任务详情'}</span>
        <span role="status" aria-label="任务保存状态" className="ml-auto mr-3 text-[10px] text-muted">
          {draft.status}
        </span>
        <button
          aria-label="关闭任务详情"
          onClick={() => draft.close(onClose)}
          className="text-muted hover:text-foreground"
        >
          <X size={16} strokeWidth={1.6} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {parents.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-1 text-[11px] text-muted">
            {parents.map((parent) => (
              <React.Fragment key={parent.id}>
                <span>{parent.title}</span>
                <ChevronRight size={11} />
              </React.Fragment>
            ))}
          </div>
        )}
        <div className="mb-5 flex items-start gap-2">
          {node ? (
            <Folder size={18} className="mt-1 shrink-0 text-muted" />
          ) : (
            <TaskCheckbox
              className="-ml-1 -mt-0.5"
              done={task.status === 'done'}
              onChange={() => store.toggleTaskDone(task.id)}
            />
          )}
          <input
            aria-label="任务标题"
            className={cn(
              'min-w-0 flex-1 bg-transparent text-[15px] font-medium leading-6 outline-none',
              task.status === 'done' && 'text-muted line-through',
            )}
            value={draft.value('title')}
            onChange={(event) => draft.change('title', event.target.value)}
            onBlur={draft.commit}
            onCompositionStart={draft.compositionStart}
            onCompositionEnd={draft.compositionEnd}
            onKeyDown={(event) => {
              if (isComposing(event)) return;
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
        </div>
        {!node && (
          <div className="mb-6 space-y-4 border-b border-[var(--border)] pb-5 text-xs">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-muted">
                <CalendarDays size={14} />
                开始日期
              </span>
              <DateTimeField
                title="开始时间"
                value={task.startAt}
                onChange={(value) => store.updateTask(task.id, { startAt: value })}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-muted">
                <CalendarDays size={14} />
                截止日期
              </span>
              <DateTimeField
                title="截止时间"
                value={task.dueAt}
                onChange={(value) => store.updateTask(task.id, { dueAt: value })}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-muted">
                <Flag size={14} />
                优先级
              </span>
              <select
                aria-label="优先级"
                value={priorityOf(task)}
                onChange={(event) => store.setTaskPriority(task.id, event.target.value as Priority)}
                className="bg-transparent text-right text-xs outline-none"
              >
                <option value="P0">高优先级</option>
                <option value="P1">重要</option>
                <option value="P2">紧急</option>
                <option value="P3">普通</option>
              </select>
            </div>
            <button
              className="text-muted hover:text-[var(--accent-solid)]"
              onClick={() => store.setTaskStatus(task.id, task.status === 'doing' ? 'todo' : 'doing')}
            >
              {task.status === 'doing' ? '正在进行 · 改为待办' : '标为进行中'}
            </button>
          </div>
        )}
        <label className="mb-2 block text-xs text-muted" htmlFor={`notes-${task.id}`}>
          描述
        </label>
        <textarea
          id={`notes-${task.id}`}
          aria-label="任务备注"
          value={draft.value('notes')}
          placeholder="添加描述或记录下一步…"
          rows={6}
          className="w-full resize-y bg-transparent text-[13px] leading-6 outline-none placeholder:text-muted/60"
          onChange={(event) => draft.change('notes', event.target.value)}
          onBlur={draft.commit}
          onCompositionStart={draft.compositionStart}
          onCompositionEnd={draft.compositionEnd}
        />
        {children.length > 0 && (
          <div className="mt-5 border-t border-[var(--border)] pt-4">
            <div className="mb-3 text-xs text-muted">
              子任务 · {children.filter((item) => item.status === 'done').length}/{children.length}
            </div>
            {children.map((item) => (
              <div key={item.id} className="flex items-center gap-1 py-1">
                {!isStructural(item) && (
                  <TaskCheckbox
                    done={item.status === 'done'}
                    onChange={() => store.toggleTaskDone(item.id)}
                  />
                )}
                <button
                  onClick={() => selectTask(item.id)}
                  className={cn(
                    'truncate text-left text-xs',
                    item.status === 'done' && 'text-muted line-through',
                  )}
                >
                  {item.title || '未命名任务'}
                </button>
              </div>
            ))}
          </div>
        )}
        <TaskResources key={task.id} taskId={task.id} />
      </div>
      <footer className="flex h-12 shrink-0 items-center justify-between border-t border-[var(--border)] px-5">
        <button
          onClick={onAddChild}
          className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground"
        >
          <Plus size={14} />
          添加子任务
        </button>
        <button
          aria-label="更多任务设置"
          onClick={() => selectTask(task.id)}
          className="text-muted hover:text-foreground"
        >
          <MoreHorizontal size={18} />
        </button>
      </footer>
    </section>
  );
}
