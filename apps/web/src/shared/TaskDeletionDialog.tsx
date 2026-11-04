import React, { useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Button, Dialog, DialogContent } from '@cortex/ui';
import { currentStore, useCortex } from '@cortex/crdt';
import { isProject, taskBranchIds } from '@cortex/core';
import { useUI } from '@/state/ui';

export function TaskDeletionDialog() {
  const request = useUI((state) => state.taskDeletion);
  const store = useCortex();
  useEffect(() => {
    if (request && request.userId !== store.userId && useUI.getState().taskDeletion === request) useUI.getState().cancelTaskDeletion();
  }, [request, store.userId]);
  if (!request || request.userId !== store.userId) return null;
  return <ConfirmDeletion key={`${request.userId}:${request.ids.join(',')}`} request={request} />;
}

function ConfirmDeletion({ request }: { request: NonNullable<ReturnType<typeof useUI.getState>['taskDeletion']> }) {
  const store = useCortex();
  const [data] = useState(() => store.getData());
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const descriptionId = useId();
  const targets = data.tasks.filter((task) => request.ids.includes(task.id) && task.deletedAt == null);
  const affected = taskBranchIds(data.tasks, targets.map((task) => task.id));
  const count = data.tasks.filter((task) => affected.has(task.id) && task.deletedAt == null).length;
  const project = targets.some(isProject);
  const close = () => { if (!busy && useUI.getState().taskDeletion === request) useUI.getState().cancelTaskDeletion(); };
  const confirm = async () => {
    if (busy || currentStore() !== store) return;
    setBusy(true); setError('');
    try {
      store.softDeleteTasks(request.ids);
      await store.flushPersistence();
      if (currentStore() !== store || useUI.getState().taskDeletion !== request) return;
      const ui = useUI.getState();
      const deleted = new Set(store.getData().tasks.filter((task) => task.deletedAt != null).map((task) => task.id));
      if (ui.selectedTaskId && deleted.has(ui.selectedTaskId)) ui.selectTask(null);
      ui.cancelTaskDeletion();
      const currentProject = new URLSearchParams(location.search).get('project');
      if (currentProject && deleted.has(currentProject)) navigate('/tasks', { replace: true });
    } catch { setError('本地保存失败，请重试；也可先从设置导出备份。'); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent
        title={project ? '删除项目' : '删除任务'} aria-describedby={descriptionId}
        data-destructive-dialog
        className="w-[min(92vw,420px)]"
        onOpenAutoFocus={(event) => { event.preventDefault(); cancelRef.current?.focus(); }}
        onEscapeKeyDown={(event) => { event.stopPropagation(); if (busy) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}
      >
        <p id={descriptionId} className="break-words text-sm leading-6">
          {targets.length === 1 ? `将「${targets[0]!.title || '未命名'}」` : `将选中的 ${targets.length} 项`}
          及其子项移入回收站，共 {count} 项。
        </p>
        <p className="mt-2 text-xs leading-5 text-muted">可以在侧边栏的「回收站」中查看和恢复，也可以使用撤销。</p>
        {error && <p role="alert" className="mt-3 text-xs text-[var(--danger)]">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button ref={cancelRef} variant="ghost" disabled={busy} onClick={close}>取消</Button>
          <Button variant="danger" disabled={busy} onClick={() => void confirm()}>{busy ? '正在保存…' : '移入回收站'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
