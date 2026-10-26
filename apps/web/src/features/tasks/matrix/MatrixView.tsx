import React, { useMemo, useState } from 'react';
import {
  DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, useDraggable, useDroppable,
} from '@dnd-kit/core';
import { Crosshair, Zap } from 'lucide-react';
import { cn, Badge } from '@cortex/ui';
import {
  QuadrantKey, QUADRANTS, Task, matrixTasks, quadrantOf, subtreeProgress, buildChildrenMap, quadrantToPriority,
} from '@cortex/core';
import { useCortex, useCortexData } from '@cortex/crdt';
import { useUI } from '@/state/ui';
import { DueBadge, PriorityDot, StatusBadge } from '@/shared/components';

// 语义色走 CSS 变量:随强调色/主题切换(mono 时自动转灰阶)
const QUADRANT_STYLE: Record<QuadrantKey, { glow: string; chip: string }> = {
  do: { glow: 'var(--quad-do-glow)', chip: 'var(--quad-do)' },
  plan: { glow: 'var(--quad-plan-glow)', chip: 'var(--quad-plan)' },
  delegate: { glow: 'var(--quad-delegate-glow)', chip: 'var(--quad-delegate)' },
  eliminate: { glow: 'var(--quad-eliminate-glow)', chip: 'var(--quad-eliminate)' },
};

export function MatrixView() {
  const data = useCortexData();
  const store = useCortex();
  const ui = useUI();
  const [now] = useState(() => new Date());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const tasks = useMemo(() => matrixTasks(data.tasks, now), [data.tasks, now]);
  const childrenMap = useMemo(() => buildChildrenMap(data.tasks), [data.tasks]);
  // 任意层级的任务都进矩阵(子任务设了重要/紧急同样该被看见),按到期先后排序
  const byQ = useMemo(() => {
    const map = { do: [], plan: [], delegate: [], eliminate: [] } as Record<QuadrantKey, Task[]>;
    for (const t of tasks) {
      map[quadrantOf(t)].push(t);
    }
    for (const arr of Object.values(map)) {
      arr.sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || a.createdAt - b.createdAt);
    }
    return map;
  }, [tasks]);

  const onDragEnd = (e: DragEndEvent) => {
    const overId = String(e.over?.id ?? '');
    if (!overId.startsWith('q-')) return;
    const q = QUADRANTS.find((x) => overId === `q-${x.key}`);
    const task = tasks.find((t) => t.id === String(e.active.id));
    if (!q || !task) return;
    store.setTaskPriority(task.id, quadrantToPriority(q.key));
  };

  return (
    <div className="h-full overflow-y-auto p-4 pb-24 md:p-6">
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        {/* 轴标 */}
        <div className="mb-2 flex items-center justify-between px-1 text-[10px] uppercase tracking-widest text-muted/70">
          <span className="flex items-center gap-1"><Zap className="h-3 w-3" />紧迫 →</span>
          <span className="flex items-center gap-1"><Crosshair className="h-3 w-3" />重要 ↑</span>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 md:gap-3" style={{ maxWidth: 1200 }}>
          {QUADRANTS.map((q) => (
            <QuadrantCell key={q.key} quadrant={q} tasks={byQ[q.key]} childrenMap={childrenMap} onNew={() => {
              const siblings = tasks.filter((t) => quadrantOf(t) === q.key && t.parentId == null);
              store.createTask({ title: '', status: 'todo', important: q.important, urgent: q.urgent, order: siblings.length * 1000 });
              const created = store.getData().tasks.at(-1);
              if (created) ui.selectTask(created.id);
            }} />
          ))}
        </div>
        <div className="mt-3 px-1 text-[10px] text-muted/60">
          拖动任务在象限间移动 = 改写「重要/紧急」 · 双击象限空白新建 · 显示所有未完成任务(含子任务),按到期先后排序
        </div>
      </DndContext>
    </div>
  );
}

function QuadrantCell({
  quadrant,
  tasks,
  childrenMap,
  onNew,
}: {
  quadrant: (typeof QUADRANTS)[number];
  tasks: Task[];
  childrenMap: Map<string | null, Task[]>;
  onNew: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `q-${quadrant.key}` });
  const style = QUADRANT_STYLE[quadrant.key];
  return (
    <div
      ref={setNodeRef}
      onDoubleClick={onNew}
      className={cn(
        'flex min-h-[240px] flex-col gap-1.5 rounded-2xl border p-3 transition-all md:min-h-[320px]',
        isOver ? 'glow-border' : 'border-[var(--border)]',
      )}
      style={{ background: style.glow }}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: style.chip }} />
            <span className="text-sm font-semibold">{quadrant.title}</span>
          </div>
          <div className="mt-0.5 text-[10px] text-muted">{quadrant.sub}</div>
        </div>
        <Badge>{tasks.length}</Badge>
      </div>
      <div className="flex flex-col gap-1">
        {tasks.slice(0, 24).map((t) => (
          <MatrixChip key={t.id} task={t} progress={subtreeProgress(t.id, childrenMap)} />
        ))}
        {tasks.length > 24 && (
          <div className="px-1 text-[10px] text-muted/60">+{tasks.length - 24} 条更多</div>
        )}
        {tasks.length === 0 && (
          <div className="flex flex-1 items-center justify-center py-8 text-xs text-muted/40">拖任务进来 / 双击新建</div>
        )}
      </div>
    </div>
  );
}

function MatrixChip({ task, progress }: { task: Task; progress: { done: number; total: number } }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  const ui = useUI();
  const store = useCortex();
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => !isDragging && ui.selectTask(task.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!isDragging) ui.openTaskMenu(task.id, e.clientX, e.clientY);
      }}
      className={cn(
        'group flex cursor-grab touch-none items-center gap-2 rounded-xl glass px-2.5 py-2 text-sm transition-all active:cursor-grabbing active:scale-[0.98]',
        isDragging && 'opacity-40',
        task.status === 'done' && 'opacity-50',
      )}
    >
      <PriorityDot task={task} />
      <StatusBadge task={task} />
      <button
        onClick={(e) => {
          e.stopPropagation();
          store.toggleTaskDone(task.id);
        }}
        className={cn(
          'h-4 w-4 shrink-0 rounded-full border-2 transition-colors',
          task.status === 'done' ? 'gradient-bg border-transparent' : 'border-[var(--border-strong)] hover:border-[var(--accent-from)]',
        )}
        aria-label="完成"
      />
      <span className={cn('min-w-0 flex-1 truncate', task.status === 'done' && 'line-through')}>{task.title || 'Untitled'}</span>
      {progress.total > 0 && (
        <span className="text-[9px] text-muted">
          {progress.done}/{progress.total}
        </span>
      )}
      <DueBadge task={task} />
    </div>
  );
}
