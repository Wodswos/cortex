import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button, Input } from '@cortex/ui';
import { isProject, newOrder, type Priority } from '@cortex/core';
import { useCortex, useCortexData } from '@cortex/crdt';
import { isComposing } from '@/shared/ime';

export type TaskDraftAnchor = { dueAt: number; x: number; y: number };

/** A calendar draft stays outside the CRDT until the user explicitly confirms it. */
export function CalendarTaskDraft({
  anchor,
  onDismiss,
  onCreated,
}: {
  anchor: TaskDraftAnchor;
  onDismiss: () => void;
  onCreated: () => void;
}) {
  const store = useCortex();
  const data = useCortexData();
  const [params] = useSearchParams();
  const panel = useRef<HTMLFormElement>(null);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(() => {
    const value = new Date(anchor.dueAt);
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}T${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
  });
  const [projectId, setProjectId] = useState(() => params.get('project') ?? '');
  const [priority, setPriority] = useState<Priority>('P3');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirmed = useRef(false);
  const composing = useRef(false);
  const created = useRef(false);
  const latestDismiss = useRef(onDismiss);
  latestDismiss.current = onDismiss;
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !confirmed.current) latestDismiss.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isComposing(event) && !composing.current && !confirmed.current) {
        event.stopPropagation();
        latestDismiss.current();
      }
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', escape, true);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', escape, true);
    };
  }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const dueAt = new Date(date).getTime();
    if (composing.current || !title.trim() || !Number.isFinite(dueAt) || busy) return;
    if (
      projectId &&
      !data.tasks.some((task) => task.id === projectId && !task.deletedAt && task.status !== 'archived' && isProject(task))
    ) {
      setError('该项目已移除，请重新选择');
      return;
    }
    confirmed.current = true;
    setBusy(true);
    setError('');
    try {
      if (!created.current) {
        const siblings = data.tasks.filter(
          (task) => task.parentId === (projectId || null) && !task.deletedAt,
        );
        store.createTask({
          title: title.trim(),
          status: 'todo',
          parentId: projectId || null,
          dueAt,
          priority,
          important: priority === 'P0' || priority === 'P1',
          urgent: priority === 'P0' || priority === 'P2',
          order: newOrder(Math.max(-1, ...siblings.map((task) => task.order))),
        });
        store.stopUndoCapture();
        created.current = true;
      }
      await store.flushPersistence();
      onCreated();
    } catch {
      setError('任务已创建，本地保存失败。请重试保存，或从设置导出备份。');
    } finally {
      setBusy(false);
    }
  };
  return createPortal(
    <form
      ref={panel}
      onSubmit={(event) => void submit(event)}
      role="dialog"
      aria-label="新建日历任务"
      className="fixed z-40 w-[min(320px,calc(100vw-24px))] space-y-3 rounded-lg border border-[var(--border-strong)] bg-[var(--background)] p-4 shadow-lg"
      style={{
        left: Math.max(12, Math.min(anchor.x, window.innerWidth - 332)),
        top: Math.max(12, Math.min(anchor.y, window.innerHeight - 360)),
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">新建任务</span>
        <button
          type="button"
          aria-label="取消新建任务"
          disabled={confirmed.current}
          onClick={onDismiss}
          className="text-muted"
        >
          <X size={15} />
        </button>
      </div>
      <Input
        autoFocus
        aria-label="新任务标题"
        placeholder="准备做什么？"
        value={title}
        disabled={created.current}
        onChange={(event) => setTitle(event.target.value)}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (isComposing(event) || composing.current)) event.preventDefault();
        }}
      />
      <label className="block space-y-1 text-xs text-muted">
        <span>截止日期</span>
        <input
          aria-label="新任务截止日期"
          required
          type="datetime-local"
          value={date}
          disabled={created.current}
          onChange={(event) => setDate(event.target.value)}
          className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-transparent px-2 text-foreground"
        />
      </label>
      <div className="flex gap-2">
        <select
          aria-label="新任务所属项目"
          value={projectId}
          disabled={created.current}
          onChange={(event) => setProjectId(event.target.value)}
          className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border-strong)] bg-transparent px-2 text-xs"
        >
          <option value="">无项目</option>
          {data.tasks
            .filter((task) => isProject(task) && !task.deletedAt && task.status !== 'archived')
            .map((task) => (
              <option key={task.id} value={task.id}>
                {task.title || '未命名项目'}
              </option>
            ))}
        </select>
        <select
          aria-label="新任务优先级"
          value={priority}
          disabled={created.current}
          onChange={(event) => setPriority(event.target.value as Priority)}
          className="h-8 rounded-md border border-[var(--border-strong)] bg-transparent px-2 text-xs"
        >
          <option value="P3">普通</option>
          <option value="P2">紧急</option>
          <option value="P1">重要</option>
          <option value="P0">最高</option>
        </select>
      </div>
      {error && (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" disabled={confirmed.current} onClick={onDismiss}>
          取消
        </Button>
        <Button
          type="submit"
          size="sm"
          variant="primary"
          disabled={busy || !title.trim() || !Number.isFinite(new Date(date).getTime())}
        >
          {busy ? '保存中…' : created.current ? '重试保存' : '创建任务'}
        </Button>
      </div>
    </form>,
    document.body,
  );
}
