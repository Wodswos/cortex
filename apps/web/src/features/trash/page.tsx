import React, { useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Circle, Folder, RotateCcw, Search, Trash2 } from 'lucide-react';
import { Button, Dialog, DialogContent, EmptyState, Input, cn } from '@cortex/ui';
import { useCortex, useCortexData } from '@cortex/crdt';
import { ancestorsOf, buildChildrenMap, isProject, isStructural, normalizeTaskForest, taskBranchIds, trashRoots, type Task } from '@cortex/core';

type PermanentDelete = { ids: string[]; title: string; count: number; empty: boolean };
const labelOf = (task: Task) => isProject(task) ? '项目' : isStructural(task) ? '分组' : '任务';
const dateOf = (stamp: number) => new Date(stamp).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function TrashPage() {
  const store = useCortex();
  // Reset drafts and pending dialogs when the active account changes.
  return <TrashContents key={store.userId} />;
}

function TrashContents() {
  const store = useCortex();
  const data = useCortexData();
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PermanentDelete | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const permanentDescription = useId();
  const previewDescription = useId();
  const tasks = useMemo(() => normalizeTaskForest(data.tasks), [data.tasks]);
  const byId = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const children = useMemo(() => buildChildrenMap(tasks), [tasks]);
  const deleted = useMemo(() => tasks.filter((task) => task.deletedAt != null), [tasks]);
  const roots = useMemo(() => trashRoots(tasks), [tasks]);
  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const visible = new Set<string>();
    if (needle) for (const task of deleted) {
      if (!`${task.title} ${task.notes ?? ''}`.toLocaleLowerCase().includes(needle)) continue;
      visible.add(task.id);
      for (const parent of ancestorsOf(task.id, byId)) if (parent.deletedAt != null) visible.add(parent.id);
    }
    const result: { task: Task; depth: number; kids: Task[] }[] = [];
    const stack = [...roots].reverse().map((task) => ({ task, depth: 0 }));
    while (stack.length) {
      const { task, depth } = stack.pop()!;
      if (needle && !visible.has(task.id)) continue;
      const kids = (children.get(task.id) ?? []).filter((child) => child.deletedAt != null);
      result.push({ task, depth, kids });
      if (needle || !collapsed.has(task.id)) for (const child of [...kids].reverse()) stack.push({ task: child, depth: depth + 1 });
    }
    return result;
  }, [query, deleted, roots, children, byId, collapsed]);
  const preview = previewId ? deleted.find((task) => task.id === previewId) : null;
  const persist = async (action: () => void, message: string, onSaved?: () => void) => {
    if (busy) return;
    setBusy(true); setError(''); setStatus('正在保存…');
    try {
      action();
      await store.flushPersistence();
      setStatus(message);
      onSaved?.();
    } catch { setStatus(''); setError('本地保存失败，请重试保存，或从设置导出备份。'); }
    finally { setBusy(false); }
  };
  const restore = (task: Task) => void persist(() => store.restoreTask(task.id), `已恢复「${task.title || '未命名'}」及同次删除的子项。`);
  const askPermanent = (task?: Task) => {
    const ids = task ? [task.id] : deleted.map((item) => item.id);
    const scope = taskBranchIds(tasks, ids);
    setError('');
    setConfirm({ ids, title: task?.title || '未命名', count: deleted.filter((item) => scope.has(item.id)).length, empty: !task });
  };
  const context = (task: Task) => ancestorsOf(task.id, byId).map((parent) => parent.title || '未命名').join(' / ');

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="shrink-0 border-b border-[var(--border)] px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">回收站 <span className="ml-1 text-xs font-normal tabular-nums text-muted">{deleted.length} 项</span></h1>
            <p className="mt-1.5 text-xs leading-5 text-muted">已删除的项目和任务会保留在这里，直到你恢复或彻底删除。</p>
          </div>
          <Button size="sm" variant="ghost" disabled={busy || !deleted.length} onClick={() => askPermanent()}>
            <Trash2 size={14} />清空回收站
          </Button>
        </div>
        <label className="relative mt-4 block max-w-md">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input aria-label="搜索已删除内容" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题或备注…" className="pl-9" />
        </label>
        {status && <p role="status" aria-label="回收站保存状态" className="mt-2 text-xs text-muted">{status}</p>}
        {error && !confirm && <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--danger)]">{error}<button className="underline" disabled={busy} onClick={() => void persist(() => {}, '已保存。')}>重试保存</button></div>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:px-6">
        {!deleted.length ? (
          <EmptyState icon={<Trash2 size={24} />} title="回收站是空的" sub="删除的项目和任务会出现在这里。" />
        ) : !rows.length ? (
          <EmptyState icon={<Search size={24} />} title="没有找到匹配内容" sub="试试其他标题或备注关键词。" />
        ) : (
          <div className="mx-auto max-w-5xl overflow-hidden rounded-xl border border-[var(--border)]">
            {rows.map(({ task, depth, kids }) => (
              <div key={task.id} data-trash-id={task.id} className="flex min-w-0 items-center gap-2 border-b border-[var(--border)] py-3 pr-2 last:border-b-0 hover:bg-[var(--surface)] sm:pr-3" style={{ paddingLeft: 8 + Math.min(depth, 4) * 16 }}>
                {kids.length ? <button
                  aria-label={`${collapsed.has(task.id) ? '展开' : '折叠'}已删除的 ${task.title}`}
                  aria-expanded={!collapsed.has(task.id) || !!query.trim()}
                  disabled={!!query.trim()}
                  onClick={() => setCollapsed((previous) => { const next = new Set(previous); if (next.has(task.id)) next.delete(task.id); else next.add(task.id); return next; })}
                  className="grid h-7 w-6 shrink-0 place-items-center rounded text-muted hover:bg-[var(--border)]"
                >{collapsed.has(task.id) && !query.trim() ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button> : <span className="w-6 shrink-0" />}
                {isStructural(task) ? <Folder size={15} className="shrink-0 text-muted" /> : <Circle size={14} className="shrink-0 text-muted" />}
                <button aria-label={`查看已删除的 ${task.title}`} onClick={() => setPreviewId(task.id)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm">{task.title || '未命名'}</span>
                  <span className="mt-1 block truncate text-[10px] text-muted">{labelOf(task)} · {dateOf(task.deletedAt!)}{depth === 0 && task.parentId ? ` · ${context(task)}` : ''}</span>
                </button>
                <Button aria-label={`恢复 ${task.title}`} size="sm" variant="ghost" disabled={busy} onClick={() => restore(task)} className="shrink-0 !px-2"><RotateCcw size={14} /><span className="hidden sm:inline">恢复</span></Button>
                <Button aria-label={`彻底删除 ${task.title}`} size="icon-sm" variant="ghost" disabled={busy} onClick={() => askPermanent(task)} className="shrink-0 text-muted hover:text-[var(--danger)]"><Trash2 size={14} /></Button>
              </div>
            ))}
          </div>
        )}
      </div>
      <Dialog open={!!preview} onOpenChange={(open) => { if (!open) setPreviewId(null); }}>
        <DialogContent title="已删除内容" aria-describedby={previewDescription} className="max-h-[75dvh] overflow-y-auto">
          {preview && <>
            <p id={previewDescription} className="text-xs text-muted">{labelOf(preview)} · 删除于 {dateOf(preview.deletedAt!)}{context(preview) ? ` · ${context(preview)}` : ''}</p>
            <h2 className="mt-4 break-words text-lg font-medium">{preview.title || '未命名'}</h2>
            <div className={cn('mt-4 whitespace-pre-wrap break-words text-sm leading-7', !preview.notes && 'text-muted')}>{preview.notes || '没有备注。'}</div>
            <p className="mt-4 text-xs text-muted">{({ inbox: '收集箱', todo: '待完成', doing: '进行中', done: '已完成', archived: '已归档' })[preview.status]}{preview.dueAt != null ? ` · 截止 ${dateOf(preview.dueAt)}` : ''}</p>
            <div className="mt-5 flex justify-end"><Button variant="primary" disabled={busy} onClick={() => restore(preview)}><RotateCcw size={14} />恢复内容</Button></div>
          </>}
        </DialogContent>
      </Dialog>
      <Dialog open={!!confirm} onOpenChange={(open) => { if (!open && !busy) setConfirm(null); }}>
        <DialogContent
          title={confirm?.empty ? '清空回收站' : '彻底删除内容'} aria-describedby={permanentDescription} data-destructive-dialog
          className="w-[min(92vw,440px)]"
          onOpenAutoFocus={(event) => { event.preventDefault(); cancelRef.current?.focus(); }}
          onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
        >
          <p id={permanentDescription} className="break-words text-sm leading-6">
            {confirm?.empty ? `彻底删除回收站中全部 ${confirm.count} 项内容？` : `彻底删除「${confirm?.title}」及其已删除的子项，共 ${confirm?.count} 项？`}
          </p>
          <p className="mt-2 text-xs leading-5 text-muted">无法通过撤销或回收站恢复。相关资源链接会被移除，日程和专注记录会保留。</p>
          {error && <p role="alert" className="mt-3 text-xs text-[var(--danger)]">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <Button ref={cancelRef} variant="ghost" disabled={busy} onClick={() => setConfirm(null)}>取消</Button>
            <Button variant="danger" disabled={busy} onClick={() => { if (confirm) void persist(() => { store.permanentlyDeleteTasks(confirm.ids); }, '已彻底删除所选内容。', () => setConfirm(null)); }}>{busy ? '正在保存…' : '确认彻底删除'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
