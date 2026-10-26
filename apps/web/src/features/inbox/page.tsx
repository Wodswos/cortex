import React from 'react';
import { useNavigate } from 'react-router';
import { Inbox, ArrowUpRight, Trash2, Plus } from 'lucide-react';
import { Button, EmptyState, Badge } from '@cortex/ui';
import { inboxTasks, parseCapture, isStructural } from '@cortex/core';
import { useCortex, useCortexData } from '@cortex/crdt';
import { useUI } from '@/state/ui';
import { TaskCheckbox, PriorityDot, TagChip, DueBadge } from '@/shared/components';

export default function InboxPage() {
  const data = useCortexData();
  const store = useCortex();
  const ui = useUI();
  const navigate = useNavigate();
  const items = inboxTasks(data.tasks);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 px-4 pt-4 md:px-6">
        <h1 className="text-lg font-semibold">收集箱</h1>
        <Badge variant={items.length > 0 ? 'warning' : 'success'}>待处理 {items.length}</Badge>
        <Button size="sm" variant="secondary" className="ml-auto" onClick={() => ui.setQuickCapture(true)}>
          <Plus className="h-3.5 w-3.5" /> 收集 <span className="font-mono text-[10px] opacity-60">N</span>
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-24 md:px-6">
        {items.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-7 w-7" />}
            title="收集箱是空的"
            sub="点右下角 + 随时捕获想法,稍后再整理到任务结构里"
          />
        ) : (
          <div className="mx-auto max-w-2xl space-y-2">
            {items.map((t) => (
              <div
                key={t.id}
                className="group flex animate-fade-up items-center gap-3 rounded-2xl glass px-4 py-3 transition-all hover:border-[var(--border-strong)]"
              >
                {!isStructural(t) && (
                  <TaskCheckbox
                    done={false}
                    onChange={() => {
                      // 直接从收件箱完成(速记即办)
                      store.setTaskStatus(t.id, 'done');
                    }}
                  />
                )}
                {!isStructural(t) && <PriorityDot task={t} />}
                <button className="min-w-0 flex-1 text-left" onClick={() => ui.selectTask(t.id)}>
                  <div className="truncate text-sm">{t.title || '(未命名草稿)'}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted/70">
                    {new Date(t.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    {t.tags.map((tid) => {
                      const tag = data.tags.find((x) => x.id === tid);
                      return tag ? <TagChip key={tid} tag={tag} /> : null;
                    })}
                  </div>
                </button>
                <DueBadge task={t} />
                <Button
                  size="sm"
                  variant="primary"
                  className="shrink-0"
                  onClick={() => {
                    store.setTaskStatus(t.id, 'todo');
                    ui.selectTask(t.id);
                    navigate('/tasks');
                  }}
                >
                  <ArrowUpRight className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">升级为任务</span>
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => store.softDeleteTask(t.id)}
                  aria-label="丢弃"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}

            <div className="pt-2 text-center text-[11px] text-muted/60">
              「升级为任务」后进入列表/四象限/导图 · 标题支持 #标签 !P0 ~45m @明天 语法(
              {(() => {
                const p = parseCapture('#提示');
                return p.tags.join('');
              })()}
              演示见 Quick Capture)
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
