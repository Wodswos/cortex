import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useCortex, useCortexData } from '@cortex/crdt';
import { savedViewHref, type SavedTaskView } from '@cortex/core';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { cn, Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from '@cortex/ui';
import { SaveViewDialog } from './SaveViewDialog';
import { TASK_VIEWS } from '../viewOptions';

export function SavedViewsNav() {
  const store = useCortex();
  const { settings } = useCortexData();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<SavedTaskView | null>(null);
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const update = async (views: SavedTaskView[]) => {
    store.stopUndoCapture(); store.updateSettings({ savedViews: views }); store.stopUndoCapture();
    try { await store.flushPersistence(); setStatus('已保存'); } catch { setStatus('保存失败，请保留页面并重试'); }
  };
  const reorder = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const views = [...store.getData().settings.savedViews];
    const from = views.findIndex((item) => item.id === active.id), to = views.findIndex((item) => item.id === over.id);
    if (from < 0 || to < 0) return;
    views.splice(to, 0, views.splice(from, 1)[0]!);
    void update(views);
  };
  return <>
    <div className="workspace-section flex items-center justify-between"><span>快捷视图</span><button aria-label="添加快捷视图" title="添加快捷视图" onClick={() => setAdding(true)} className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-[var(--surface)] hover:text-foreground"><Plus size={14} /></button></div>
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorder} accessibility={{
      screenReaderInstructions: { draggable: '按空格开始排序，按上下方向键移动，再按空格确认；按 Esc 取消。' },
      announcements: {
        onDragStart: ({ active }) => `开始移动快捷视图 ${settings.savedViews.find((item) => item.id === active.id)?.name ?? ''}`,
        onDragOver: ({ active, over }) => over ? `快捷视图 ${settings.savedViews.find((item) => item.id === active.id)?.name ?? ''} 移到 ${settings.savedViews.find((item) => item.id === over.id)?.name ?? ''} 位置` : '已离开快捷视图列表',
        onDragEnd: () => '快捷视图排序完成',
        onDragCancel: () => '已取消快捷视图排序',
      },
    }}>
      <SortableContext items={settings.savedViews.map((view) => view.id)} strategy={verticalListSortingStrategy}>
        <nav aria-label="快捷视图" className="max-h-[25vh] space-y-0.5 overflow-y-auto">
          {settings.savedViews.map((item) => <SavedViewRow key={item.id} item={item} selected={params.get('saved') === item.id} onEdit={() => setEditing(item)} onRemove={() => {
            void update(store.getData().settings.savedViews.filter((view) => view.id !== item.id));
            if (params.get('saved') === item.id) navigate('/tasks?scope=week');
          }} />)}
          {!settings.savedViews.length && <p className="px-3 py-2 text-xs text-muted">保存常用的视图与时间范围</p>}
        </nav>
      </SortableContext>
    </DndContext>
    <span role="status" aria-label="快捷视图保存状态" className="sr-only">{status}</span>
    {editing && <SaveViewDialog key={editing.id} initial={editing} editing onClose={() => setEditing(null)} />}
    {adding && <SaveViewDialog initial={{ id: '', name: '全局四象限', view: 'matrix', scope: 'all', projectId: null }} onClose={() => setAdding(false)} />}
  </>;
}

function SavedViewRow({ item, selected, onEdit, onRemove }: { item: SavedTaskView; selected: boolean; onEdit: () => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const Icon = TASK_VIEWS.find((view) => view.key === item.view)!.icon;
  return <div ref={setNodeRef} data-saved-view={item.id} data-selected={selected || undefined} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn('workspace-project-row group flex items-center rounded-md', isDragging && 'relative z-10 bg-[var(--background)] shadow-sm')}>
    <button ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`拖动快捷视图 ${item.name} 排序`} title="拖动排序；按空格后可用上下键移动" className="workspace-project-action ml-1 grid h-8 w-5 shrink-0 touch-none place-items-center text-muted/50 hover:text-foreground"><GripVertical size={14} /></button>
    <Link to={savedViewHref(item)} className="workspace-nav min-w-0 flex-1 !pl-1.5" aria-current={selected ? 'page' : undefined} title={item.name}><Icon /><span className="truncate">{item.name}</span></Link>
    <Dropdown><DropdownTrigger asChild><button aria-label={`快捷视图 ${item.name} 菜单`} className="workspace-project-action mr-1 grid h-8 w-6 shrink-0 place-items-center rounded text-muted hover:bg-[var(--surface)] hover:text-foreground"><MoreHorizontal size={15} /></button></DropdownTrigger><DropdownContent align="start" collisionPadding={12}>
      <DropdownItem onSelect={onEdit}><Pencil size={14} />编辑快捷视图</DropdownItem>
      <DropdownItem danger onSelect={onRemove}><Trash2 size={14} />移除快捷视图</DropdownItem>
    </DropdownContent></Dropdown>
  </div>;
}
