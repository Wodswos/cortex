import React, { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Folder, GripVertical, Plus } from 'lucide-react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { activeTasks, gapTooSmall, isProject, newOrder, sortSiblings, type Task } from '@cortex/core';
import { useCortex } from '@cortex/crdt';
import { cn, Dialog, DialogContent, Input, Button } from '@cortex/ui';
import { isComposing } from '@/shared/ime';
import { projectView, rememberProjectView, useProjectViewMemory, type TaskViewKey } from '@/features/tasks/projectViews';

export function ProjectList({ projects, selectedId }: { projects: Task[]; selectedId: string | null }) {
  const store = useCortex();
  const navigate = useNavigate();
  const memory = useProjectViewMemory();
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const createdId = useRef<string | null>(null);
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      if (!createdId.current) {
        store.stopUndoCapture();
        createdId.current = store.createProject(name).id;
        store.stopUndoCapture();
      }
      await store.flushPersistence();
      rememberProjectView(store.userId, createdId.current, 'list');
      navigate(`/tasks?project=${encodeURIComponent(createdId.current)}`);
      setCreating(false);
    } catch {
      setError('项目保存失败，请重试保存');
    } finally {
      setBusy(false);
    }
  };
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const reorder = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const roots = activeTasks(store.getData().tasks)
      .filter((task) => !task.parentId)
      .sort(sortSiblings);
    const source = roots.find((task) => task.id === active.id);
    const target = roots.find((task) => task.id === over.id);
    if (!source || !target || !isProject(source) || !isProject(target)) return;
    const from = roots.indexOf(source),
      to = roots.indexOf(target);
    const others = roots.filter((task) => task.id !== source.id);
    const insertAt = others.indexOf(target) + (from < to ? 1 : 0);
    const prev = others[insertAt - 1],
      next = others[insertAt];
    store.stopUndoCapture();
    store.updateTask(source.id, { order: newOrder(prev?.order, next?.order) });
    if (gapTooSmall(prev?.order, next?.order)) store.renumberParent(null);
    store.stopUndoCapture();
    setStatus('正在保存顺序…');
    try {
      await store.flushPersistence();
      setStatus('顺序已保存');
    } catch {
      setStatus('顺序保存失败，请保留页面并从设置导出备份');
    }
  };
  return (
    <>
      <div className="workspace-section flex items-center justify-between">
        <span>项目</span>
        <button
          aria-label="新建项目"
          title="新建项目"
          onClick={() => {
            createdId.current = null;
            setName('');
            setError('');
            setCreating(true);
          }}
          className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-[var(--surface)] hover:text-foreground"
        >
          <Plus size={14} />
        </button>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={(event) => void reorder(event)}
        accessibility={{
          screenReaderInstructions: {
            draggable: '按空格开始排序，按上下方向键移动，再按空格确认；按 Esc 取消。',
          },
          announcements: {
            onDragStart: ({ active }) =>
              `开始移动项目 ${projects.find((task) => task.id === active.id)?.title ?? ''}`,
            onDragOver: ({ active, over }) =>
              over
                ? `项目 ${projects.find((task) => task.id === active.id)?.title ?? ''} 移到 ${projects.find((task) => task.id === over.id)?.title ?? ''} 位置`
                : '已离开项目列表',
            onDragEnd: () => '项目排序完成',
            onDragCancel: () => '已取消项目排序',
          },
        }}
      >
        <SortableContext items={projects.map((project) => project.id)} strategy={verticalListSortingStrategy}>
          <nav aria-label="项目" className="min-h-0 max-h-[30vh] space-y-0.5 overflow-y-auto">
            {projects.length ? (
              projects.map((task) => (
                <ProjectRow key={task.id} task={task} view={projectView(memory, task.id)} selected={selectedId === task.id} />
              ))
            ) : (
              <div className="px-3 py-2 text-xs text-muted">项目分组会显示在这里</div>
            )}
          </nav>
        </SortableContext>
      </DndContext>
      {status && (
        <span role="status" aria-label="项目排序保存状态" className="px-3 pt-1 text-[10px] text-muted">
          {status}
        </span>
      )}
      <Dialog open={creating} onOpenChange={(open) => { if (!busy) setCreating(open); }}>
        <DialogContent title="新建项目" className="w-[min(92vw,400px)]">
          <form onSubmit={(event) => void create(event)} className="space-y-4">
            <label className="block space-y-2 text-sm">
              <span>项目名称</span>
              <Input
                autoFocus
                value={name}
                disabled={busy || !!createdId.current}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter' && isComposing(event)) event.preventDefault(); }}
                placeholder="例如：产品改版"
              />
            </label>
            {error && <p role="alert" className="text-xs text-[var(--danger)]">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setCreating(false)}>取消</Button>
              <Button type="submit" disabled={!name.trim() || busy}>{busy ? '正在保存…' : createdId.current ? '重试保存' : '创建项目'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProjectRow({ task, selected, view }: { task: Task; selected: boolean; view: TaskViewKey }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({
      id: task.id,
    });
  return (
    <div
      ref={setNodeRef}
      data-project-row={task.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group flex items-center rounded-md',
        isDragging && 'relative z-10 bg-[var(--background)] shadow-sm',
      )}
    >
      <Link
        to={`/tasks?project=${encodeURIComponent(task.id)}&view=${view}`}
        aria-current={selected ? 'page' : undefined}
        className="workspace-nav min-w-0 flex-1"
      >
        <Folder />
        <span className="truncate">{task.title || '未命名项目'}</span>
      </Link>
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`拖动项目 ${task.title || '未命名项目'} 排序`}
        title="拖动排序；也可按空格后用上下键移动"
        className="mr-1 grid h-8 w-6 shrink-0 touch-none place-items-center text-muted/50 hover:text-foreground focus-visible:text-foreground md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
      >
        <GripVertical size={14} />
      </button>
    </div>
  );
}
