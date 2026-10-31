import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Play, Trash2, RotateCcw, Plus, X, ChevronRight, Flame, Folder } from 'lucide-react';
import { Button, Input, Textarea, Sheet, SheetContent, Badge, cn } from '@cortex/ui';
import { useCortex, useCortexData } from '@cortex/crdt';
import { useUI } from '../state/ui';
import { ancestorsOf, buildChildrenMap, quadrantOf, Task, priorityOf, isStructural, isProject } from '@cortex/core';
import {
  TaskCheckbox,
  TagChip,
  EVENT_KIND_STYLE,
  PriorityPicker,
  StatusBadge,
  DateTimeField,
  KindToggle,
} from './components';
import { useTimer } from '../focus/timer';
import { TaskResources } from './TaskResources';
import { isComposing } from './ime';
import { useTaskTextDraft } from './useTaskTextDraft';

export function TaskSheet() {
  const selectedId = useUI((s) => s.selectedTaskId);
  const selectTask = useUI((s) => s.selectTask);
  const data = useCortexData();
  const store = useCortex();
  const navigate = useNavigate();
  const timerStart = useTimer((s) => s.start);
  const [tagInput, setTagInput] = useState('');
  const [subInput, setSubInput] = useState('');
  /** 开始时间选完 → 自动弹出截止时间选择器(连续选两段;只在截止为空时链) */
  const [chainDue, setChainDue] = useState(0);

  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const task = useMemo(() => data.tasks.find((t) => t.id === selectedId) ?? null, [data.tasks, selectedId]);
  const draft = useTaskTextDraft(task);

  const childrenMap = useMemo(() => buildChildrenMap(data.tasks), [data.tasks]);
  const byId = useMemo(() => new Map(data.tasks.map((t) => [t.id, t])), [data.tasks]);
  const ancestors = task ? ancestorsOf(task.id, byId) : [];
  const directSubs = task ? (childrenMap.get(task.id) ?? []) : [];

  const update = (patch: Partial<Task>) => task && store.updateTask(task.id, patch);

  if (!task)
    return (
      <Sheet open={false} onOpenChange={() => selectTask(null)}>
        <SheetContent />
      </Sheet>
    );

  const quadrant = quadrantOf(task);
  const quadrantLabel = { do: '立即做', plan: '计划', delegate: '委托', eliminate: '淘汰' }[quadrant];
  const node = isStructural(task); // 结构节点:无完成态/状态/优先级/时间,详情里只保留类型、标签、备注、子任务
  const project = isProject(task);

  return (
    <Sheet
      open={!!selectedId}
      onOpenChange={(o) => !o && draft.close(() => selectTask(null))}
      modal={isMobile}
    >
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        title={project ? '项目详情' : node ? '分组详情' : '任务详情'}
        onInteractOutside={(event) => {
          event.preventDefault();
          draft.close(() => selectTask(null));
        }}
        onEscapeKeyDown={(e) => {
          // 「开始」选完会链式自动弹开「截止」输入框,此刻 Esc 只应关掉输入框。
          // Radix 在 document 捕获阶段监听 Esc(先于输入框自身),必须在这里
          // preventDefault 拦下,否则会顺手把整个抽屉也关掉
          if ((e.target as HTMLElement | null)?.closest?.('input[type="datetime-local"]')) e.preventDefault();
        }}
      >
        <div className="space-y-5 pb-8">
          {/* 标题 */}
          <div className="flex items-start gap-3">
            {node ? (
              <span
                className="mt-1.5 grid h-[22px] w-[22px] shrink-0 place-items-center text-muted/60"
                title="结构节点(无完成态)"
              >
                <Folder className="h-4 w-4" />
              </span>
            ) : (
              <TaskCheckbox
                done={task.status === 'done'}
                onChange={() => store.toggleTaskDone(task.id)}
                className="mt-1.5"
              />
            )}
            <input
              aria-label="任务标题"
              value={draft.value('title')}
              onChange={(e) => draft.change('title', e.target.value)}
              onBlur={draft.commit}
              onCompositionStart={draft.compositionStart}
              onCompositionEnd={draft.compositionEnd}
              className={cn(
                'w-full bg-transparent text-lg font-medium outline-none',
                task.status === 'done' && 'text-muted line-through',
              )}
            />
          </div>

          {/* 面包屑 */}
          {ancestors.length > 0 && (
            <div className="flex flex-wrap items-center gap-0.5 text-xs text-muted">
              {ancestors.map((a) => (
                <React.Fragment key={a.id}>
                  <button className="hover:text-foreground" onClick={() => selectTask(a.id)}>
                    {a.title}
                  </button>
                  <ChevronRight className="h-3 w-3 opacity-50" />
                </React.Fragment>
              ))}
              <span className="opacity-70">{quadrantLabel}象限</span>
            </div>
          )}

          {/* 节点类型:TODO 任务 ↔ 结构节点(右击菜单也能转) */}
          <div>
            <span className="text-xs text-muted">节点类型</span>
            <div className="mt-1.5">
              {project ? <span className="inline-flex items-center gap-2 text-sm"><Folder size={14} />项目根节点</span>
                : <KindToggle value={node ? 'node' : 'todo'} onChange={(k) => store.setTaskKind(task.id, k)} />}
            </div>
            {node && !project && (
              <div className="-mt-1 text-[10px] text-muted/60">
                结构节点 = 分组/主题容器:没有完成勾选、状态、优先级与排期;转回 TODO 任务即恢复
              </div>
            )}
          </div>

          {/* 状态:跟随 完成 + 开始/截止时间窗 自动判断,无需手动 */}
          {!node && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">状态</span>
                <div className="flex items-center gap-2">
                  <StatusBadge task={task} />
                  {task.startAt == null && task.dueAt == null && (
                    <button
                      onClick={() => store.setTaskStatus(task.id, task.status === 'doing' ? 'todo' : 'doing')}
                      className={cn(
                        'rounded-full px-2.5 py-0.5 text-[11px] transition-all',
                        task.status === 'doing'
                          ? 'gradient-bg text-white'
                          : 'glass text-muted hover:text-foreground',
                      )}
                      title="没设时间窗时手动标记(设了开始/截止就由时间窗自动判断)"
                    >
                      {task.status === 'doing' ? '进行中(手动)' : '标为进行中'}
                    </button>
                  )}
                </div>
              </div>
            </>
          )}

          {/* 优先级 P0~P3 = 四象限(重要×紧急) */}
          {!node && (
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">优先级</span>
                <span className="text-[10px] text-muted/60">当前 {quadrantLabel} · 快捷键 1~4</span>
              </div>
              <div className="mt-1.5">
                <PriorityPicker
                  value={priorityOf(task)}
                  onChange={(p) => store.setTaskPriority(task.id, p)}
                />
              </div>
            </div>
          )}

          {/* 时间:未设置时只显示「—」,点一下才弹原生选择器(不再有 yyyy/mm/dd 占位);结构节点不排期 */}
          {!node && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-xs text-muted">开始时间</span>
                  <DateTimeField
                    className="mt-1 w-full"
                    title="开始时间"
                    value={task.startAt}
                    onChange={(v) => {
                      update({ startAt: v });
                      if (v != null && task.dueAt == null) setChainDue((k) => k + 1); // 选完开始 → 接着选截止
                    }}
                  />
                </div>
                <div>
                  <span className="text-xs text-muted">截止时间</span>
                  <DateTimeField
                    className="mt-1 w-full"
                    title="截止时间"
                    value={task.dueAt}
                    onChange={(v) => update({ dueAt: v })}
                    autoOpenKey={chainDue}
                  />
                </div>
              </div>
              <div className="-mt-1 text-[10px] text-muted/60">
                两端都填 = 按此区间画条;只填一端 = 补齐当天;都不填 = 甘特图不显示(可从底部「未排期」拖进图里)
              </div>
            </>
          )}

          <TaskResources key={task.id} taskId={task.id} />

          {/* 标签(链接之后,弱化编辑区靠下) */}
          <div>
            <span className="text-xs text-muted">标签</span>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {task.tags.map((tid) => {
                const tag = data.tags.find((t) => t.id === tid);
                if (!tag) return null;
                return (
                  <span key={tid} className="inline-flex items-center">
                    <TagChip tag={tag} />
                    <button
                      className="ml-0.5 rounded-full p-0.5 text-muted hover:text-[var(--danger)]"
                      onClick={() => update({ tags: task.tags.filter((x) => x !== tid) })}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (isComposing(e)) return;
                  if (e.key === 'Enter' && tagInput.trim()) {
                    const tag = store.ensureTag(tagInput.trim());
                    if (!task.tags.includes(tag.id)) update({ tags: [...task.tags, tag.id] });
                    setTagInput('');
                  }
                }}
                placeholder="+ 标签"
                className="w-20 rounded-full border border-dashed border-[var(--border-strong)] bg-transparent px-2 py-0.5 text-[11px] outline-none placeholder:text-muted/50"
              />
            </div>
          </div>

          {/* 备注(Markdown) */}
          <div>
            <span className="text-xs text-muted">备注(Markdown)</span>
            <Textarea
              rows={4}
              className="mt-1.5"
              aria-label="任务备注"
              value={draft.value('notes')}
              onChange={(e) => draft.change('notes', e.target.value)}
              onBlur={draft.commit}
              onCompositionStart={draft.compositionStart}
              onCompositionEnd={draft.compositionEnd}
              placeholder="补充细节…"
            />
          </div>

          {/* 子任务 */}
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">子任务({directSubs.length})</span>
              {directSubs.length > 0 && task.status !== 'done' && (
                <button
                  className="text-[11px] text-muted hover:text-foreground"
                  onClick={() => {
                    for (const row of directSubs)
                      if (row.status !== 'done') store.setTaskStatus(row.id, 'done');
                  }}
                >
                  全部完成
                </button>
              )}
            </div>
            <div className="mt-1.5 space-y-0.5">
              {directSubs.map((sub) => (
                <div
                  key={sub.id}
                  className="flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-[var(--surface)]"
                >
                  <TaskCheckbox
                    done={sub.status === 'done'}
                    onChange={() => store.toggleTaskDone(sub.id)}
                    className="!h-4 !w-4"
                  />
                  <button
                    className={cn(
                      'min-w-0 flex-1 truncate text-left text-sm',
                      sub.status === 'done' && 'text-muted line-through',
                    )}
                    onClick={() => selectTask(sub.id)}
                  >
                    {sub.title}
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <Plus className="h-3.5 w-3.5 text-muted" />
                <input
                  value={subInput}
                  onChange={(e) => setSubInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (isComposing(e)) return;
                    if (e.key === 'Enter' && subInput.trim()) {
                      const siblings = childrenMap.get(task.id) ?? [];
                      store.createTask({
                        title: subInput,
                        status: 'todo',
                        parentId: task.id,
                        order: (siblings.at(-1)?.order ?? 0) + 1,
                      });
                      setSubInput('');
                    }
                  }}
                  placeholder="添加子任务,回车"
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted/50"
                />
              </div>
            </div>
          </div>

          {/* 专注统计 */}
          {(() => {
            const sessions = data.sessions.filter((s) => s.taskId === task.id && s.mode === 'focus');
            const total = sessions.reduce((acc, s) => acc + s.actualMin, 0);
            if (sessions.length === 0) return null;
            return (
              <div className="flex items-center gap-2 text-xs text-muted">
                <Flame className="h-3.5 w-3.5 text-[var(--accent-from)]" />
                已专注 {sessions.length} 次 · 共 {Math.round(total)} 分钟
              </div>
            );
          })()}

          {/* 操作 */}
          <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-4">
            {!node && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  timerStart({ mode: 'focus', taskId: task.id });
                  navigate('/focus');
                }}
              >
                <Play className="h-3.5 w-3.5" /> 开始专注
              </Button>
            )}
            {task.deletedAt ? (
              <Button variant="secondary" size="sm" onClick={() => store.restoreTask(task.id)}>
                <RotateCcw className="h-3.5 w-3.5" /> 恢复
              </Button>
            ) : (
              <Button variant="danger" size="sm" onClick={() => store.softDeleteTask(task.id)}>
                <Trash2 className="h-3.5 w-3.5" /> 删除
              </Button>
            )}
            <div className="ml-auto self-center text-[10px] text-muted/60">
              创建于 {new Date(task.createdAt).toLocaleString('zh-CN')}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
