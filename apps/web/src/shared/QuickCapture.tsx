import React, { useEffect, useRef, useState } from 'react';
import { Inbox, Hash, AlertTriangle, Clock, Minus } from 'lucide-react';
import { Dialog, DialogContent, Badge } from '@cortex/ui';
import { parseCapture } from '@cortex/core';
import { useCortex } from '@cortex/crdt';
import { useUI } from '../state/ui';
import { fmtHM, addDays, startOfDay } from '@cortex/core';

export function QuickCapture() {
  const open = useUI((s) => s.quickCaptureOpen);
  const setQuickCapture = useUI((s) => s.setQuickCapture);
  const store = useCortex();
  const [text, setText] = useState('');
  const [count, setCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setCount(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    } else setText('');
  }, [open]);

  const parsed = parseCapture(text || '');

  const saved = async () => {
    setSaving(true); setSaveError('');
    try { await store.flushPersistence(); setCount((c) => c + 1); }
    catch (error) { setSaveError(`保存失败:${(error as Error).message}`); }
    finally { setSaving(false); }
  };
  const submit = async () => {
    if (!text.trim() || saving) return;
    const p = parseCapture(text);
    const tagIds = p.tags.map((name) => store.ensureTag(name).id);
    store.createTask({
      title: p.title,
      status: 'inbox',
      dueAt: p.dueAt ?? null,
      estimateMin: p.estimateMin,
      priority: p.priority ?? null,
      important: p.priority === 'P0' || p.priority === 'P1',
      urgent: p.priority === 'P0' || p.priority === 'P2',
      tags: tagIds,
    });
    setText('');
    await saved();
  };

  const dueHint = () => {
    if (parsed.dueAt == null) return null;
    const d = new Date(parsed.dueAt);
    const today = startOfDay(new Date()).getTime();
    const label =
      d.getTime() < addDays(today, 1).getTime() ? '今天' : d.getTime() < addDays(today, 2).getTime() ? '明天' : `${d.getMonth() + 1}/${d.getDate()}`;
    return `${label} ${fmtHM(parsed.dueAt)}`;
  };

  return (
    <Dialog open={open} onOpenChange={setQuickCapture}>
      <DialogContent title="⚡ 快速收集" className="top-[12%] w-[min(94vw,640px)]">
        <input
          ref={inputRef}
          value={text}
          disabled={saving}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="想到什么写什么… #标签  !P0  ~45m  @明天 @9:30"
          className="h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 text-base outline-none transition-colors focus:border-[color-mix(in_srgb,var(--accent-from)_60%,transparent)] focus:ring-2 focus:ring-[var(--ring)]/25"
        />
        <div className="mt-3 flex min-h-6 flex-wrap items-center gap-1.5 text-xs text-muted">
          {parsed.tags.length > 0 && (
            <Badge variant="accent">
              <Hash className="h-3 w-3" />
              {parsed.tags.join(' ')}
            </Badge>
          )}
          {parsed.priority && (
            <Badge variant={parsed.priority === 'P0' ? 'danger' : 'warning'}>
              <AlertTriangle className="h-3 w-3" />
              {parsed.priority}
            </Badge>
          )}
          {parsed.estimateMin != null && (
            <Badge>
              <Minus className="h-3 w-3" />
              {parsed.estimateMin}m
            </Badge>
          )}
          {dueHint() && (
            <Badge variant="success">
              <Clock className="h-3 w-3" />
              {dueHint()}
            </Badge>
          )}
          {text.trim() === '' && <span className="opacity-70">Enter 收集,连续录入不清弹窗 · Esc 关闭</span>}
          {saving && <span role="status">正在保存…</span>}
          {saveError && <span role="alert">{saveError} <button onClick={() => void saved()}>重试保存</button></span>}
          {!saving && !saveError && count > 0 && text.trim() === '' && (
            <span className="ml-auto inline-flex items-center gap-1 text-[var(--success)]">
              <Inbox className="h-3.5 w-3.5" />
              已收集 {count} 条
            </span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
