import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import { useCortex, useCortexData } from '@cortex/crdt';
import { activeTasks, dayKeyOf, isProject, newId, savedViewHref, sortSiblings, validateSavedViews, TASK_FILTER_PRIORITIES, TASK_FILTER_STATUSES, type SavedTaskView } from '@cortex/core';
import { Button, Dialog, DialogContent, Input } from '@cortex/ui';
import { TASK_VIEWS } from '../viewOptions';
import { isComposing } from '@/shared/ime';

export function SaveViewDialog({ initial, editing = false, onClose }: { initial: SavedTaskView; editing?: boolean; onClose: () => void }) {
  const store = useCortex();
  const data = useCortexData();
  const navigate = useNavigate();
  const [value, setValue] = useState<SavedTaskView>(() => ({ ...initial, id: editing ? initial.id : newId() }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const projects = activeTasks(data.tasks).filter(isProject).sort(sortSiblings);
  const change = (patch: Partial<SavedTaskView>) => setValue((previous) => ({ ...previous, ...patch }));
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const item: SavedTaskView = { id: value.id, name: value.name.trim(), view: value.view, scope: value.scope, projectId: value.projectId || null, work: value.work ?? 'all', taskStatus: value.taskStatus ?? 'all', taskPriority: value.taskPriority ?? 'all', ...(value.taskTag ? { taskTag: value.taskTag } : {}), ...(value.scope === 'custom' ? { from: value.from, to: value.to } : {}) };
    try {
      const previous = store.getData().settings.savedViews;
      const next = previous.some((view) => view.id === item.id) ? previous.map((view) => view.id === item.id ? item : view) : [...previous, item];
      validateSavedViews(next);
      if (item.projectId && !projects.some((project) => project.id === item.projectId)) throw new Error('所属项目已被删除，请重新选择范围');
      setBusy(true); setError('');
      store.stopUndoCapture(); store.updateSettings({ savedViews: next }); store.stopUndoCapture();
      await store.flushPersistence();
      navigate(savedViewHref(item));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试');
    } finally { setBusy(false); }
  };
  const field = 'h-9 w-full min-w-0 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--accent-solid)]';
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent title={editing ? '编辑快捷视图' : '保存快捷视图'} className="top-[10%] max-h-[80dvh] w-[min(92vw,440px)] overflow-y-auto">
      <form onSubmit={(event) => void save(event)} className="space-y-4">
        <label className="block space-y-1.5 text-sm"><span>视图名称</span><Input autoFocus required maxLength={60} value={value.name} disabled={busy} onChange={(event) => change({ name: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter' && isComposing(event)) event.preventDefault(); }} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block min-w-0 space-y-1.5 text-sm"><span>展示方式</span><select aria-label="展示方式" className={field} disabled={busy} value={value.view} onChange={(event) => {
            const view = event.target.value as SavedTaskView['view'];
            change({ view });
          }}>{TASK_VIEWS.map((view) => <option key={view.key} value={view.key}>{view.label}</option>)}</select></label>
          <label className="block min-w-0 space-y-1.5 text-sm"><span>默认时间范围</span><select aria-label="默认时间范围" className={field} disabled={busy} value={value.scope} onChange={(event) => change({ scope: event.target.value as SavedTaskView['scope'], from: value.from ?? dayKeyOf(new Date()), to: value.to ?? dayKeyOf(new Date()) })}>
            <option value="today">今天</option><option value="week">本周</option><option value="month">本月</option><option value="custom">固定日期区间</option>
            <option value="all">全部时间</option><option value="undated">未排期</option>
          </select></label>
        </div>
        <label className="block min-w-0 space-y-1.5 text-sm"><span>项目范围</span><select aria-label="项目范围" className={field} disabled={busy} value={value.projectId ?? ''} onChange={(event) => change({ projectId: event.target.value || null })}><option value="">全部项目与独立任务</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label>
        {value.scope === 'custom' && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block min-w-0 space-y-1.5 text-sm"><span>起始日期</span><input type="date" required className={field} disabled={busy} value={value.from ?? ''} onChange={(event) => change({ from: event.target.value })} /></label>
          <label className="block min-w-0 space-y-1.5 text-sm"><span>截止日期</span><input type="date" required min={value.from} className={field} disabled={busy} value={value.to ?? ''} onChange={(event) => change({ to: event.target.value })} /></label>
        </div>}
        <div className="grid grid-cols-2 gap-3">
          <label className="block min-w-0 space-y-1.5 text-sm"><span>工作范围</span><select aria-label="快捷视图工作范围" className={field} disabled={busy} value={value.work ?? 'all'} onChange={event => change({ work: event.target.value as SavedTaskView['work'] })}><option value="all">全部</option><option value="current">当前工作 · 进行中或逾期</option><option value="overdue">逾期</option><option value="doing">仅进行中</option><option value="week">本周安排</option><option value="unscheduled">重要未排期</option></select></label>
          <label className="block min-w-0 space-y-1.5 text-sm"><span>状态</span><select aria-label="快捷视图任务状态" className={field} disabled={busy} value={value.taskStatus ?? 'all'} onChange={event => change({ taskStatus: event.target.value as SavedTaskView['taskStatus'] })}>{TASK_FILTER_STATUSES.map(status => <option key={status} value={status}>{{ all: '全部状态', unfinished: '未完成', todo: '待办', doing: '进行中', done: '已完成' }[status]}</option>)}</select></label>
          <label className="block min-w-0 space-y-1.5 text-sm"><span>优先级</span><select aria-label="快捷视图任务优先级" className={field} disabled={busy} value={value.taskPriority ?? 'all'} onChange={event => change({ taskPriority: event.target.value as SavedTaskView['taskPriority'] })}>{TASK_FILTER_PRIORITIES.map(priority => <option key={priority} value={priority}>{priority === 'all' ? '全部优先级' : priority === 'high' ? '高优先级 · P0 / P1' : priority}</option>)}</select></label>
          <label className="block min-w-0 space-y-1.5 text-sm"><span>标签</span><select aria-label="快捷视图任务标签" className={field} disabled={busy} value={value.taskTag ?? ''} onChange={event => change({ taskTag: event.target.value || undefined })}><option value="">全部标签</option>{data.tags.filter(tag => !tag.deletedAt).map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}{value.taskTag && !data.tags.some(tag => tag.id === value.taskTag && !tag.deletedAt) && <option value={value.taskTag}>已移除的标签</option>}</select></label>
        </div>
        <p className="text-xs leading-relaxed text-muted">今天、本周、本月会随日期自动更新。侧栏入口始终按这里保存的默认配置打开。</p>
        {error && <p role="alert" className="text-xs text-[var(--danger)]">{error}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>取消</Button><Button type="submit" disabled={busy || !value.name.trim()}>{busy ? '正在保存…' : editing ? '保存修改' : '保存快捷视图'}</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}
