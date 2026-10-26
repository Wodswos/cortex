import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import { Edit3, Plus, Terminal, X as XIcon, RefreshCw, SquarePen, Folder, Power } from 'lucide-react';
import { cn, Badge, Textarea } from '@cortex/ui';
import { Task, quadrantOf, priorityOf, taskViewStatus, isStructural } from '@cortex/core';
import { api, useCortex, useCortexData } from '@cortex/crdt';
import { useUI } from '@/state/ui';
import { TaskCheckbox, DueBadge, StatusBadge, PriorityPicker, DateTimeField, KindToggle } from './components';

/**
 * 轻量任务详情小面板(跟随鼠标/cursor 浮出):单击选中时展示简况与可编辑详情,
 * 主界面保持原位聚焦。「编辑详情」才打开完整 TaskSheet。
 * 列表 / 导图复用,保证风格统一。
 */
export function TaskInspector({
  task: selectedTask,
  onAddChild,
  onClose,
  position,
  docked,
}: {
  task: Task | null;
  onAddChild: () => void;
  onClose: () => void;
  /** 可选锚点(相对 viewport 的 px):给了就贴到鼠标附近,否则浮在右上角 */
  position?: { x: number; y: number };
  /** dock 模式:占满右侧整列,不复位定位(用于列表右栏) */
  docked?: boolean;
}) {
  const navigate = useNavigate();
  const store = useCortex();
  const data = useCortexData();
  const selectTask = useUI((s) => s.selectTask);
  const openTmuxView = useUI((s) => s.openTmuxView);
  const [tmuxServer, setTmuxServer] = useState('');
  const [tmuxSession, setTmuxSession] = useState('');
  /** 该服务器上已有的 tmux 会话(下拉候选);拉取失败置空并提示 */
  const [tmuxSessions, setTmuxSessions] = useState<string[] | null>(null);
  const [tmuxBusy, setTmuxBusy] = useState<'' | 'load' | 'create' | 'kill'>('');
  /** true = 手动输入新 session 名(而非从下拉选已有) */
  const [tmuxTyping, setTmuxTyping] = useState(false);
  /** 正在两步确认「结束会话」的 tmux 链接 id;null = 没有确认条 */
  const [killSess, setKillSess] = useState<string | null>(null);
  const [killErr, setKillErr] = useState('');
  const task = selectedTask ? data.tasks.find((value) => value.id === selectedTask.id) ?? null : null;
  const [titleDraft, setTitleDraft] = useState<{ id: string; value: string } | null>(null);
  const [notesDraft, setNotesDraft] = useState<{ id: string; value: string } | null>(null);
  const title = titleDraft && titleDraft.id === task?.id ? titleDraft.value : task?.title ?? '';
  const notes = notesDraft && notesDraft.id === task?.id ? notesDraft.value : task?.notes ?? '';
  /** 开始时间选完 → 自动弹出截止时间选择器(与 TaskSheet 一致) */
  const [chainDue, setChainDue] = useState(0);

  if (!task) return null;

  const quadrantLabel = { do: '立即做', plan: '计划', delegate: '委托', eliminate: '淘汰' }[quadrantOf(task)];
  const subCount = data.tasks.filter((t) => t.parentId === task.id && !t.deletedAt).length;
  const node = isStructural(task); // 结构节点:无完成态/状态/优先级/时间
  const tmuxLinks = data.links.filter((l) => l.taskId === task.id && l.type === 'tmux');
  const servers = data.settings.servers ?? [];

  /** 关联 tmux 会话:服务器档案 + session 名 → TaskLink(type=tmux),点击即在网页直连 */
  const addTmuxLink = () => {
    const sid = tmuxServer.trim();
    const session = tmuxSession.trim();
    if (!sid || !session) return;
    const server = servers.find((s) => s.id === sid);
    if (!server) return;
    store.addLink(
      task.id, 'tmux', `tmux://${server.name}/${session}`,
      undefined, { serverId: sid, session },
    );
    setTmuxSession('');
  };

  /** 拉取服务器上已有 tmux 会话(用于下拉候选);显式传 serverId,
   *  select 的 onChange 里 state 还没更新,不能读 tmuxServer */
  const loadTmuxSessionsWith = async (serverId: string) => {
    const srv = servers.find((s) => s.id === serverId);
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
  const loadTmuxSessions = () => (tmuxServer ? loadTmuxSessionsWith(tmuxServer) : Promise.resolve());

  /** 在服务器上创建同名 session 并关联 */
  const createTmuxSession = async () => {
    const srv = servers.find((s) => s.id === tmuxServer);
    const session = tmuxSession.trim();
    if (!srv || !session) return;
    setTmuxBusy('create');
    setKillErr('');
    try {
      await api.tmux('new-session', srv.id, session);
      addTmuxLink();
      setTmuxTyping(false);
    } catch (error) {
      setKillErr((error as Error).message);
    } finally {
      setTmuxBusy('');
    }
  };

  /** 结束服务器上的 tmux 会话(两步确认后调用);任务上的关联保留,只是服务器侧没了 */
  const killTmuxSession = async (serverId: string | undefined, session: string | undefined) => {
    const srv = servers.find((x) => x.id === serverId);
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

  // 面板 272 宽;贴住鼠标(cursor)但不越界;无锚点且非 dock 时浮右上角
  const W = 272, H = 300;
  const VW = typeof window !== 'undefined' ? window.innerWidth : 1;
  const VH = typeof window !== 'undefined' ? window.innerHeight : 1;
  const absPos = !docked
    ? {
        left: position
          ? Math.max(8, Math.min(position.x + 14, VW - W - 8))
          : Math.max(8, VW - W - 8),
        top: position ? Math.max(8, Math.min(position.y + 10, VH - H - 8)) : 8,
      }
    : undefined;

  return (
    <div
      data-inspector
      className={cn(
        docked
          ? 'flex h-full min-h-0 w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-[var(--border)] bg-[var(--surface-raised)] p-4'
          : 'pointer-events-auto fixed z-30 flex w-[272px] flex-col gap-3 rounded-2xl glass-raised p-4',
      )}
      style={absPos}
    >
      <div className="flex items-start gap-2">
        {node ? (
          <span className="mt-1 grid h-[22px] w-[22px] shrink-0 place-items-center text-muted/60" title="结构节点(无完成态)">
            <Folder className="h-4 w-4" />
          </span>
        ) : (
          <TaskCheckbox done={task.status === 'done'} onChange={() => store.toggleTaskDone(task.id)} className="mt-1" />
        )}
        <input
          aria-label="任务标题"
          value={title}
          onChange={(e) => setTitleDraft({ id: task.id, value: e.target.value })}
          onBlur={() => {
            if (titleDraft?.id === task.id && title !== task.title) store.updateTask(task.id, { title });
            setTitleDraft(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className={cn(
            'min-w-0 flex-1 bg-transparent text-sm font-medium outline-none',
            task.status === 'done' && 'text-muted line-through',
          )}
        />
        <button onClick={onClose} className="text-muted hover:text-foreground">✕</button>
      </div>

      {/* 节点类型:TODO ↔ 结构节点(右击菜单同款) */}
      <div>
        <span className="text-[11px] text-muted">节点类型</span>
        <div className="mt-1">
          <KindToggle value={node ? 'node' : 'todo'} onChange={(k) => store.setTaskKind(task.id, k)} />
        </div>
      </div>

      {!node && (
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <Badge>{quadrantLabel}</Badge>
        <StatusBadge task={task} />
        {subCount > 0 && <Badge>{subCount} 子任务</Badge>}
        <DueBadge task={task} />
      </div>
      )}
      {!node && (task.status === 'doing' || (task.startAt == null && task.dueAt == null)) && (
        <button
          onClick={() => store.setTaskStatus(task.id, task.status === 'doing' ? 'todo' : 'doing')}
          className="self-start rounded-full glass px-2 py-0.5 text-[11px] text-muted transition-colors hover:text-foreground"
          title="没设时间窗时手动标记(设了开始/截止就自动判断)"
        >
          {task.status === 'doing' ? '进行中(手动)' : '标为进行中'}
        </button>
      )}

      {killErr && <p role="alert" className="text-xs text-[var(--danger)]">{killErr}</p>}
      {/* 关联 tmux 会话:服务器档案 + session 名;点击 chip 在网页里直连打开 */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] text-muted">tmux 会话</span>
        {tmuxLinks.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tmuxLinks.map((l) => {
              const server = servers.find((s) => s.id === l.serverId);
              return (
                <span key={l.id} className="inline-flex items-center">
                  <button
                    onClick={() => openTmuxView(l.serverId ?? '', l.session ?? '')}
                    className="inline-flex items-center gap-1 rounded-full glass px-2 py-0.5 text-[11px] text-muted transition-colors hover:text-foreground"
                    title={`在网页终端打开 ${l.session}@${server?.name ?? '未知服务器'}`}
                  >
                    <Terminal className="h-3 w-3 text-[var(--accent-from)]" />
                    {l.session}@{server?.name ?? '?'}
                  </button>
                  <button
                    onClick={() => { setKillSess(l.id); setKillErr(''); }}
                    className="ml-0.5 rounded-full p-0.5 text-muted/60 hover:text-[var(--danger)]"
                    title="结束该 tmux 会话(服务器上关闭;关联保留)"
                  >
                    <Power className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => store.removeLink(l.id)}
                    className="ml-0.5 rounded-full p-0.5 text-muted/60 hover:text-[var(--danger)]"
                    title="取消关联"
                  >
                    <XIcon className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
        {(() => {
          const l = tmuxLinks.find((x) => x.id === killSess);
          if (!l) return null;
          return (
            <div className="rounded-lg border border-[var(--danger)]/50 bg-[var(--danger)]/10 px-2 py-1.5 text-[11px]">
              <div className="text-[var(--danger)]">
                结束会话 {l.session}?所有窗口都会关闭,不可恢复
                {killErr && <span className="ml-1 opacity-80">({killErr})</span>}
              </div>
              <div className="mt-1 flex gap-1.5">
                <button
                  onClick={() => { setKillSess(null); setKillErr(''); }}
                  className="rounded-md border border-[var(--border-strong)] px-2 py-0.5 text-muted hover:text-foreground"
                >
                  取消
                </button>
                <button
                  onClick={() => void killTmuxSession(l.serverId, l.session)}
                  disabled={tmuxBusy === 'kill'}
                  className="rounded-md bg-[var(--danger)] px-2 py-0.5 text-white disabled:opacity-40"
                >
                  {tmuxBusy === 'kill' ? '结束中…' : '确认结束'}
                </button>
              </div>
            </div>
          );
        })()}
        {servers.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex gap-1.5">
              <select
                value={tmuxServer}
                onChange={(e) => {
                  setTmuxServer(e.target.value);
                  setTmuxSessions(null);
                  if (e.target.value) void loadTmuxSessionsWith(e.target.value);
                }}
                className="min-w-0 flex-1 rounded-md border border-[var(--border-strong)] bg-transparent px-1.5 py-1 text-[11px] outline-none"
              >
                <option value="">选服务器…</option>
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              {tmuxServer && (
                <button
                  onClick={() => void loadTmuxSessions()}
                  disabled={tmuxBusy === 'load'}
                  className="shrink-0 rounded-md border border-[var(--border-strong)] px-1.5 text-muted transition-colors hover:text-foreground disabled:opacity-40"
                  title="重新拉取该服务器的 tmux 会话列表"
                >
                  <RefreshCw className={('h-3 w-3 ' + (tmuxBusy === 'load' ? 'animate-spin' : '')).trim()} />
                </button>
              )}
            </div>
            {tmuxTyping ? (
              <div className="flex gap-1.5">
                <input
                  autoFocus
                  value={tmuxSession}
                  onChange={(e) => setTmuxSession(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && tmuxServer && tmuxSession.trim()) void createTmuxSession();
                    if (e.key === 'Escape') { setTmuxTyping(false); setTmuxSession(''); }
                  }}
                  placeholder="新 session 名,回车 = 创建并关联"
                  className="min-w-0 flex-1 rounded-md border border-[var(--border-strong)] bg-transparent px-1.5 py-1 text-[11px] outline-none placeholder:text-muted/50"
                />
                <button
                  onClick={() => void createTmuxSession()}
                  disabled={!tmuxServer || !tmuxSession.trim() || tmuxBusy === 'create'}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--border-strong)] px-1.5 py-1 text-[11px] text-muted transition-colors hover:text-foreground disabled:opacity-40"
                  title="在服务器上创建同名 session 并关联"
                >
                  <SquarePen className="h-3 w-3" />
                  {tmuxBusy === 'create' ? '创建中' : '新建'}
                </button>
                <button
                  onClick={() => { setTmuxTyping(false); setTmuxSession(''); }}
                  className="shrink-0 rounded-md border border-[var(--border-strong)] px-1.5 py-1 text-[11px] text-muted hover:text-foreground"
                  title="回到下拉选择"
                >
                  <XIcon className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <select
                value={tmuxSession}
                onChange={(e) => {
                  if (e.target.value === '__new__') {
                    setTmuxTyping(true);
                    setTmuxSession('');
                    return;
                  }
                  setTmuxSession(e.target.value);
                }}
                className="min-w-0 flex-1 rounded-md border border-[var(--border-strong)] bg-transparent px-1.5 py-1 text-[11px] outline-none"
              >
                <option value="">{tmuxSessions == null ? '加载会话列表…' : tmuxSessions.length ? '选已有会话…' : '该服务器暂无会话'}</option>
                {(tmuxSessions ?? []).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
                <option value="__new__">✍ 新 session 名…</option>
              </select>
            )}
            <div className="flex gap-1.5">
              <button
                onClick={addTmuxLink}
                disabled={!tmuxServer || !tmuxSession.trim()}
                className="shrink-0 flex-1 rounded-md gradient-bg px-2 py-1 text-[11px] text-white disabled:opacity-40"
              >
                关联
              </button>
              <button
                onClick={() => { setTmuxTyping(true); setTmuxSession(''); }}
                disabled={!tmuxServer}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--border-strong)] px-1.5 py-1 text-[11px] text-muted transition-colors hover:text-foreground disabled:opacity-40"
                title="在服务器上新建一个 session 并关联到本任务"
              >
                <SquarePen className="h-3 w-3" />
                新建…
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => navigate('/settings')}
            className="self-start text-[11px] text-muted/70 underline decoration-dotted hover:text-foreground"
            title="到设置页添加服务器档案"
          >
            先在设置里添加服务器档案 →
          </button>
        )}
      </div>

      {/* 优先级 P0~P3 = 四象限(重要×紧急);结构节点无优先级/排期 */}
      {!node && (
      <div>
        <span className="text-[11px] text-muted">优先级</span>
        <div className="mt-1">
          <PriorityPicker value={priorityOf(task)} onChange={(p) => store.setTaskPriority(task.id, p)} />
        </div>
      </div>
      )}

      {/* 开始 / 截止:未设置时只显示「—」,点一下才弹原生选择器 */}
      {!node && (
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">开始</span>
          <DateTimeField
            className="w-full"
            title="开始时间"
            value={task.startAt}
            onChange={(v) => {
              store.updateTask(task.id, { startAt: v });
              if (v != null && task.dueAt == null) setChainDue((k) => k + 1); // 选完开始 → 接着选截止
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">截止</span>
          <DateTimeField
            className="w-full"
            title="截止时间"
            value={task.dueAt}
            onChange={(v) => store.updateTask(task.id, { dueAt: v })}
            autoOpenKey={chainDue}
          />
        </div>
      </div>
      )}

      {/* 备注(Markdown) */}
      <div className="flex min-h-0 flex-1 flex-col">
        <span className="text-[11px] text-muted">备注</span>
        <Textarea
          aria-label="任务备注"
          rows={3}
          className="mt-1 flex-1 resize-none !text-xs"
          value={notes}
          onChange={(e) => setNotesDraft({ id: task.id, value: e.target.value })}
          onBlur={() => {
            if (notesDraft?.id === task.id && notes !== (task.notes ?? '')) store.updateTask(task.id, { notes });
            setNotesDraft(null);
          }}
          placeholder="补充细节…"
        />
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => { onClose(); selectTask(task.id); }}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-full gradient-bg px-3 py-1.5 text-xs text-white"
        >
          <Edit3 className="h-3.5 w-3.5" /> 编辑详情
        </button>
        <button
          onClick={onAddChild}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-full glass px-3 py-1.5 text-xs text-muted hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> 加子任务
        </button>
      </div>
    </div>
  );
}