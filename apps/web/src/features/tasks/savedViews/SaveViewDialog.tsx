import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import { useCortex, useCortexData } from '@cortex/crdt';
import { activeTasks, dayKeyOf, isProject, newId, savedViewHref, sortSiblings, validateSavedViews, type SavedTaskView } from '@cortex/core';
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
    const item: SavedTaskView = { id: value.id, name: value.name.trim(), view: value.view, scope: value.scope, projectId: value.projectId || null, ...(value.scope === 'custom' ? { from: value.from, to: value.to } : {}) };
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
            change({ view, ...(['gantt', 'timeline'].includes(view) && ['all', 'undated'].includes(value.scope) ? { scope: view === 'timeline' ? 'month' as const : 'week' as const } : {}) });
          }}>{TASK_VIEWS.map((view) => <option key={view.key} value={view.key}>{view.label}</option>)}</select></label>
          <label className="block min-w-0 space-y-1.5 text-sm"><span>默认时间范围</span><select aria-label="默认时间范围" className={field} disabled={busy} value={value.scope} onChange={(event) => change({ scope: event.target.value as SavedTaskView['scope'], from: value.from ?? dayKeyOf(new Date()), to: value.to ?? dayKeyOf(new Date()) })}>
            <option value="today">今天</option><option value="week">本周</option><option value="month">本月</option><option value="custom">固定日期区间</option>
            {!['gantt', 'timeline'].includes(value.view) && <><option value="all">全部时间</option><option value="undated">未排期</option></>}
          </select></label>
        </div>
        <label className="block min-w-0 space-y-1.5 text-sm"><span>项目范围</span><select aria-label="项目范围" className={field} disabled={busy} value={value.projectId ?? ''} onChange={(event) => change({ projectId: event.target.value || null })}><option value="">全部项目与独立任务</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label>
        {value.scope === 'custom' && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block min-w-0 space-y-1.5 text-sm"><span>起始日期</span><input type="date" required className={field} disabled={busy} value={value.from ?? ''} onChange={(event) => change({ from: event.target.value })} /></label>
          <label className="block min-w-0 space-y-1.5 text-sm"><span>截止日期</span><input type="date" required min={value.from} className={field} disabled={busy} value={value.to ?? ''} onChange={(event) => change({ to: event.target.value })} /></label>
        </div>}
        <p className="text-xs leading-relaxed text-muted">今天、本周、本月会随日期自动更新。侧栏入口始终按这里保存的默认配置打开。</p>
        {error && <p role="alert" className="text-xs text-[var(--danger)]">{error}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>取消</Button><Button type="submit" disabled={busy || !value.name.trim()}>{busy ? '正在保存…' : editing ? '保存修改' : '保存快捷视图'}</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}
