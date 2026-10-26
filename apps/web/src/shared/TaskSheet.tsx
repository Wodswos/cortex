import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Play, Trash2, RotateCcw, Plus, X, Link2, ChevronRight, Flame, Terminal, RefreshCw, SquarePen, Folder, Power,
} from 'lucide-react';
import { Button, Input, Textarea, Sheet, SheetContent, Badge, cn } from '@cortex/ui';
import { api, useCortex, useCortexData } from '@cortex/crdt';
import { useUI } from '../state/ui';
import {
  ancestorsOf, buildChildrenMap, quadrantOf, LinkType, Task, priorityOf, isStructural,
} from '@cortex/core';
import { TaskCheckbox, TagChip, EVENT_KIND_STYLE, PriorityPicker, StatusBadge, DateTimeField, KindToggle } from './components';
import { useTimer } from '../focus/timer';

function detectLinkType(raw: string): LinkType {
  const s = raw.trim().toLowerCase();
  if (s.startsWith('obsidian://')) return 'obsidian';
  if (s.includes('yuque.com')) return 'yuque';
  if (s.includes('claude.ai') || s.includes('agent://') || s.includes('/agent/')) return 'agent';
  return 'url';
}

export function TaskSheet() {
  const selectedId = useUI((s) => s.selectedTaskId);
  const selectTask = useUI((s) => s.selectTask);
  const data = useCortexData();
  const store = useCortex();
  const navigate = useNavigate();
  const timerStart = useTimer((s) => s.start);
  const [tagInput, setTagInput] = useState('');
  const [subInput, setSubInput] = useState('');
  const [linkInput, setLinkInput] = useState('');
  const [tmuxServer, setTmuxServer] = useState('');
  const [tmuxSession, setTmuxSession] = useState('');
  const [tmuxSessions, setTmuxSessions] = useState<string[] | null>(null);
  const [tmuxBusy, setTmuxBusy] = useState<'' | 'load' | 'create' | 'kill'>('');
  const [tmuxTyping, setTmuxTyping] = useState(false);
  /** 正在两步确认「结束会话」的 tmux 链接 id;null = 没有确认条 */
  const [killSess, setKillSess] = useState<string | null>(null);
  const [killErr, setKillErr] = useState('');
  const openTmuxView = useUI((s) => s.openTmuxView);
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

  const childrenMap = useMemo(() => buildChildrenMap(data.tasks), [data.tasks]);
  const byId = useMemo(() => new Map(data.tasks.map((t) => [t.id, t])), [data.tasks]);
  const ancestors = task ? ancestorsOf(task.id, byId) : [];
  const directSubs = task ? (childrenMap.get(task.id) ?? []) : [];
  const links = task ? data.links.filter((l) => l.taskId === task.id) : [];

  const update = (patch: Partial<Task>) => task && store.updateTask(task.id, patch);

  /** 拉取服务器的 tmux 会话列表(下拉候选) */
  const loadTmuxSessionsWith = async (serverId: string) => {
    const srv = data.settings.servers.find((x) => x.id === serverId);
    if (!srv) return;
    setTmuxBusy('load');
    setKillErr('');
    try {
      const body = await api.tmux<{ sessions: string[] }>('sessions', srv.id);
      setTmuxSessions(body.sessions ?? []);
    } catch (error) {
      setTmuxSessions([]);
      setKillErr((error as Error).message);
    } finally {
      setTmuxBusy('');
    }
  };
  /** 在服务器上创建同名 session 并关联 */
  const createTmuxSession = async () => {
    const srv = data.settings.servers.find((x) => x.id === tmuxServer);
    const session = tmuxSession.trim();
    if (!srv || !session) return;
    setTmuxBusy('create');
    setKillErr('');
    try {
      await api.tmux('new-session', srv.id, session);
      store.addLink(task!.id, 'tmux', `tmux://${srv.name}/${session}`, undefined, { serverId: tmuxServer, session });
      setTmuxSession('');
      setTmuxTyping(false);
    } catch (error) {
      setKillErr((error as Error).message);
    } finally {
      setTmuxBusy('');
    }
  };

  /** 结束服务器上的 tmux 会话(两步确认后调用);任务上的关联保留,只是服务器侧没了 */
  const killTmuxSession = async (serverId: string | undefined, session: string | undefined) => {
    const srv = data.settings.servers.find((x) => x.id === serverId);
    if (!srv || !session) return;
    setTmuxBusy('kill');
    setKillErr('');
    try {
      await api.tmux('kill-session', srv.id, session);
      setKillSess(null);
      if (tmuxServer === srv.id) void loadTmuxSessionsWith(srv.id);
    } catch (error) {
      setKillErr((error as Error).message);
    } finally {
      setTmuxBusy('');
    }
  };

  if (!task) return <Sheet open={false} onOpenChange={() => selectTask(null)}><SheetContent /></Sheet>;

  const quadrant = quadrantOf(task);
  const quadrantLabel = { do: '立即做', plan: '计划', delegate: '委托', eliminate: '淘汰' }[quadrant];
  const node = isStructural(task); // 结构节点:无完成态/状态/优先级/时间,详情里只保留类型、标签、备注、子任务

  return (
    <Sheet open={!!selectedId} onOpenChange={(o) => !o && selectTask(null)} modal={!isMobile}>
      <SheetContent
        side={isMobile ? 'bottom' : 'float'}
        title="任务详情"
        onInteractOutside={() => selectTask(null)}
        onEscapeKeyDown={(e) => {
          // 「开始」选完会链式自动弹开「截止」输入框,此刻 Esc 只应关掉输入框。
          // Radix 在 document 捕获阶段监听 Esc(先于输入框自身),必须在这里
          // preventDefault 拦下,否则会顺手把整个抽屉也关掉
          if ((e.target as HTMLElement | null)?.closest?.('input[type="datetime-local"]')) e.preventDefault();
        }}
      >
        <div className="space-y-5 pb-8">
          {killErr && <p role="alert" className="text-xs text-[var(--danger)]">{killErr}</p>}
      {/* 标题 */}
          <div className="flex items-start gap-3">
            {node ? (
              <span className="mt-1.5 grid h-[22px] w-[22px] shrink-0 place-items-center text-muted/60" title="结构节点(无完成态)">
                <Folder className="h-4 w-4" />
              </span>
            ) : (
              <TaskCheckbox done={task.status === 'done'} onChange={() => store.toggleTaskDone(task.id)} className="mt-1.5" />
            )}
            <input
              value={task.title}
              onChange={(e) => update({ title: e.target.value })}
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
                  <button className="hover:text-foreground" onClick={() => selectTask(a.id)}>{a.title}</button>
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
              <KindToggle value={node ? 'node' : 'todo'} onChange={(k) => store.setTaskKind(task.id, k)} />
            </div>
            {node && (
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
                    task.status === 'doing' ? 'gradient-bg text-white' : 'glass text-muted hover:text-foreground',
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
              <PriorityPicker value={priorityOf(task)} onChange={(p) => store.setTaskPriority(task.id, p)} />
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

          {/* 链接 */}
          <div>
            <span className="text-xs text-muted">链接 · Note / Agent / tmux</span>
            <div className="mt-1.5 space-y-1.5">
              {links.map((l) => {
                const tmuxServerCfg = l.type === 'tmux' ? data.settings.servers.find((s) => s.id === l.serverId) : undefined;
                // tmux 链接:先点 ⏻ 弹红色确认条,再「确认结束」才真正 kill-session(服务器侧结束,关联保留)
                if (killSess === l.id) {
                  return (
                    <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--danger)]/50 bg-[var(--danger)]/10 px-2.5 py-2 text-xs">
                      <span className="text-[var(--danger)]">
                        结束会话 {l.session}?该会话所有窗口都会关闭,不可恢复
                        {killErr && <span className="ml-1 opacity-80">({killErr})</span>}
                      </span>
                      <div className="ml-auto flex gap-1.5">
                        <Button variant="secondary" size="sm" className="h-7" onClick={() => { setKillSess(null); setKillErr(''); }}>
                          取消
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          className="h-7"
                          disabled={tmuxBusy === 'kill'}
                          onClick={() => void killTmuxSession(l.serverId, l.session)}
                        >
                          {tmuxBusy === 'kill' ? '结束中…' : '确认结束'}
                        </Button>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={l.id} className="glass flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs">
                    {l.type === 'tmux' ? (
                      <>
                        <Terminal className="h-3.5 w-3.5 shrink-0 text-[var(--accent-from)]" />
                        <button
                          className="min-w-0 flex-1 truncate text-left hover:underline"
                          title={`在网页终端打开 ${l.session}@${tmuxServerCfg?.name ?? '未知服务器'}`}
                          onClick={() => openTmuxView(l.serverId ?? '', l.session ?? '')}
                        >
                          {l.session}@{tmuxServerCfg?.name ?? '?'}
                        </button>
                      </>
                    ) : (
                      <>
                        <Link2 className="h-3.5 w-3.5 shrink-0 text-[var(--accent-from)]" />
                        <a
                          href={l.target}
                          target="_blank"
                          rel="noreferrer"
                          className="min-w-0 flex-1 truncate hover:underline"
                          title={l.target}
                        >
                          {l.title || l.target}
                        </a>
                      </>
                    )}
                    <Badge>{l.type}</Badge>
                    {l.type === 'tmux' && (
                      <button
                        className="text-muted hover:text-[var(--danger)]"
                        title="结束该 tmux 会话(服务器上关闭;此处的关联保留)"
                        onClick={() => { setKillSess(l.id); setKillErr(''); }}
                      >
                        <Power className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button className="text-muted hover:text-[var(--danger)]" onClick={() => store.removeLink(l.id)}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
              <div className="flex gap-1.5">
                <Input
                  value={linkInput}
                  onChange={(e) => setLinkInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && linkInput.trim()) {
                      store.addLink(task.id, detectLinkType(linkInput), linkInput.trim());
                      setLinkInput('');
                    }
                  }}
                  placeholder="粘贴 obsidian:// 或 https:// 链接,回车添加"
                  className="h-8 text-xs"
                />
              </div>
              {/* 关联远程 tmux 会话:选服务器档案(自动拉取会话列表下拉可选)+ 新建 */}
              {data.settings.servers.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex gap-1.5">
                    <select
                      value={tmuxServer}
                      onChange={(e) => {
                        setTmuxServer(e.target.value);
                        setTmuxSessions(null);
                        if (e.target.value) void loadTmuxSessionsWith(e.target.value);
                      }}
                      className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border-strong)] bg-transparent px-1.5 text-xs outline-none"
                    >
                      <option value="">选服务器…</option>
                      {data.settings.servers.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    {tmuxServer && (
                      <button
                        onClick={() => tmuxServer && void loadTmuxSessionsWith(tmuxServer)}
                        disabled={tmuxBusy === 'load'}
                        className="h-8 shrink-0 rounded-md border border-[var(--border-strong)] px-2 text-muted transition-colors hover:text-foreground disabled:opacity-40"
                        title="重新拉取会话列表"
                      >
                        <RefreshCw className={cn('h-3.5 w-3.5', tmuxBusy === 'load' && 'animate-spin')} />
                      </button>
                    )}
                  </div>
                  {tmuxTyping ? (
                    <div className="flex gap-1.5">
                      <Input
                        autoFocus
                        value={tmuxSession}
                        onChange={(e) => setTmuxSession(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && tmuxServer && tmuxSession.trim()) void createTmuxSession();
                          if (e.key === 'Escape') { setTmuxTyping(false); setTmuxSession(''); }
                        }}
                        placeholder="新 session 名,回车 = 在服务器上创建并关联"
                        className="h-8 flex-1 text-xs"
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-8 shrink-0"
                        disabled={!tmuxServer || !tmuxSession.trim() || tmuxBusy === 'create'}
                        onClick={() => void createTmuxSession()}
                        title="在服务器上创建同名 session 并关联"
                      >
                        <SquarePen className="h-3.5 w-3.5" /> {tmuxBusy === 'create' ? '创建中' : '新建'}
                      </Button>
                      <Button variant="secondary" size="sm" className="h-8 shrink-0" onClick={() => { setTmuxTyping(false); setTmuxSession(''); }}>
                        取消
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-1.5">
                      <select
                        value={tmuxSession}
                        onChange={(e) => {
                          if (e.target.value === '__new__') { setTmuxTyping(true); setTmuxSession(''); return; }
                          setTmuxSession(e.target.value);
                        }}
                        className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border-strong)] bg-transparent px-1.5 text-xs outline-none"
                      >
                        <option value="">{tmuxSessions == null ? '加载会话列表…' : tmuxSessions.length ? '选已有会话…' : '该服务器暂无会话'}</option>
                        {(tmuxSessions ?? []).map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                        <option value="__new__">✍ 新 session 名…</option>
                      </select>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-8 shrink-0"
                        disabled={!tmuxServer || !tmuxSession.trim()}
                        onClick={() => {
                          const server = data.settings.servers.find((s) => s.id === tmuxServer)!;
                          store.addLink(
                            task.id, 'tmux', `tmux://${server.name}/${tmuxSession.trim()}`,
                            undefined, { serverId: tmuxServer, session: tmuxSession.trim() },
                          );
                          setTmuxSession('');
                        }}
                      >
                        <Terminal className="h-3.5 w-3.5" /> 关联
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-8 shrink-0"
                        disabled={!tmuxServer}
                        onClick={() => { setTmuxTyping(true); setTmuxSession(''); }}
                        title="在服务器上新建一个 session 并关联到本任务"
                      >
                        <SquarePen className="h-3.5 w-3.5" /> 新建…
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

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
              value={task.notes ?? ''}
              onChange={(e) => update({ notes: e.target.value })}
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
                    for (const row of directSubs) if (row.status !== 'done') store.setTaskStatus(row.id, 'done');
                  }}
                >
                  全部完成
                </button>
              )}
            </div>
            <div className="mt-1.5 space-y-0.5">
              {directSubs.map((sub) => (
                <div key={sub.id} className="flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-[var(--surface)]">
                  <TaskCheckbox done={sub.status === 'done'} onChange={() => store.toggleTaskDone(sub.id)} className="!h-4 !w-4" />
                  <button
                    className={cn('min-w-0 flex-1 truncate text-left text-sm', sub.status === 'done' && 'text-muted line-through')}
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
                    if (e.key === 'Enter' && subInput.trim()) {
                      const siblings = childrenMap.get(task.id) ?? [];
                      store.createTask({ title: subInput, status: 'todo', parentId: task.id, order: (siblings.at(-1)?.order ?? 0) + 1 });
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
