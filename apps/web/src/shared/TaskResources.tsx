import React, { useEffect, useRef, useState } from 'react';
import { Bot, FileText, Link2, Plus, Power, RefreshCw, Terminal, X } from 'lucide-react';
import { Button, Input } from '@cortex/ui';
import { api, useCortex, useCortexData } from '@cortex/crdt';
import type { LinkType, TaskLink } from '@cortex/core';
import { useUI } from '@/state/ui';
import { isComposing } from './ime';

/** The task's three resource areas share one implementation in every detail view. */
export function TaskResources({ taskId }: { taskId: string }) {
  const data = useCortexData();
  const store = useCortex();
  const openTerminal = useUI((state) => state.openTmuxView);
  const selectTask = useUI((state) => state.selectTask);
  const [serverId, setServerId] = useState('');
  const [session, setSession] = useState('');
  const [sessions, setSessions] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const [busy, setBusy] = useState(false);
  const [killId, setKillId] = useState<string | null>(null);
  const generation = useRef(0);
  const active = useRef(true);
  const servers = data.settings.servers;
  const links = data.links.filter((link) => link.taskId === taskId && !link.deletedAt);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      generation.current++;
    };
  }, []);
  const load = async (id: string) => {
    const request = ++generation.current;
    setSessions([]);
    setSession('');
    setError('');
    if (!id) {
      setStatus('idle');
      return;
    }
    setStatus('loading');
    try {
      const body = await api.tmux<{ sessions: string[] }>('sessions', id);
      if (!active.current || request !== generation.current) return;
      setSessions(body.sessions);
      setStatus('ready');
    } catch (failure) {
      if (!active.current || request !== generation.current) return;
      setError((failure as Error).message);
      setStatus('error');
    }
  };
  const attach = (id: string, name: string) => {
    const server = servers.find((item) => item.id === id);
    if (!server || !name) return;
    if (!links.some((link) => link.type === 'tmux' && link.serverId === id && link.session === name)) {
      store.addLink(taskId, 'tmux', `tmux://${server.name}/${name}`, undefined, {
        serverId: id,
        session: name,
      });
    }
    setSession('');
  };
  const createSession = async () => {
    const name = sessionName.trim(),
      id = serverId;
    if (!name || !id || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.tmux('new-session', id, name);
      attach(id, name);
      if (active.current) {
        setSessionName('');
        setCreating(false);
        await load(id);
      }
    } catch (failure) {
      if (active.current) setError((failure as Error).message);
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const endSession = async (link: TaskLink) => {
    if (!link.serverId || !link.session || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.tmux('kill-session', link.serverId, link.session);
      if (active.current) {
        setKillId(null);
        if (serverId === link.serverId) await load(serverId);
      }
    } catch (failure) {
      if (active.current) setError((failure as Error).message);
    } finally {
      if (active.current) setBusy(false);
    }
  };
  return (
    <div className="space-y-5" data-task-resources>
      <section aria-label="tmux 关联" className="border-t border-[var(--border)] pt-4">
        <h3 className="mb-2 flex items-center gap-2 text-xs font-medium">
          <Terminal size={14} />
          tmux
        </h3>
        {links
          .filter((link) => link.type === 'tmux')
          .map((link) => (
            <div key={link.id} className="mb-2 rounded-md bg-[var(--surface)] p-2 text-xs">
              <div className="flex items-center gap-2">
                <button
                  className="min-w-0 flex-1 truncate text-left hover:text-[var(--accent-solid)]"
                  onClick={() => openTerminal(link.serverId ?? '', link.session ?? '')}
                >
                  {link.session}{' '}
                  <span className="text-muted">
                    @{servers.find((server) => server.id === link.serverId)?.name ?? '连接已移除'}
                  </span>
                </button>
                <button
                  aria-label={`结束会话 ${link.session}`}
                  title="结束远程会话"
                  onClick={() => setKillId(link.id)}
                  className="text-muted hover:text-[var(--danger)]"
                >
                  <Power size={13} />
                </button>
                <button
                  aria-label={`解除关联 ${link.session}`}
                  onClick={() => store.removeLink(link.id)}
                  className="text-muted"
                >
                  <X size={13} />
                </button>
              </div>
              {killId === link.id && (
                <div className="mt-2 space-y-2 text-[var(--danger)]">
                  <p>结束会话将关闭其中的全部窗口和进程。</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="danger" disabled={busy} onClick={() => void endSession(link)}>
                      确认结束
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setKillId(null)}>
                      取消
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        {servers.length ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <select
                aria-label="tmux 服务器"
                value={serverId}
                disabled={busy}
                onChange={(event) => {
                  const id = event.target.value;
                  setServerId(id);
                  setCreating(false);
                  void load(id);
                }}
                className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border-strong)] bg-transparent px-2 text-xs"
              >
                <option value="">选择服务器</option>
                {servers.map((server) => (
                  <option key={server.id} value={server.id}>
                    {server.name}
                  </option>
                ))}
              </select>
              <button
                aria-label="刷新 tmux 会话"
                disabled={!serverId || status === 'loading' || busy}
                onClick={() => void load(serverId)}
                className="px-1 text-muted disabled:opacity-40"
              >
                <RefreshCw size={14} className={status === 'loading' ? 'animate-spin' : ''} />
              </button>
            </div>
            {serverId && (
              <>
                <div className="flex gap-2">
                  <select
                    aria-label="tmux 会话"
                    value={session}
                    disabled={status !== 'ready' || busy}
                    onChange={(event) => setSession(event.target.value)}
                    className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border-strong)] bg-transparent px-2 text-xs"
                  >
                    <option value="">
                      {status === 'loading'
                        ? '正在查询会话…'
                        : status === 'error'
                          ? '连接失败'
                          : sessions.length
                            ? '选择已有会话'
                            : '连接成功，暂无会话'}
                    </option>
                    {sessions.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!session || status !== 'ready'}
                    onClick={() => attach(serverId, session)}
                  >
                    关联
                  </Button>
                </div>
                {creating ? (
                  <div className="space-y-2">
                    <Input
                      aria-label="新 tmux 会话名"
                      placeholder="新会话名称"
                      value={sessionName}
                      onChange={(event) => setSessionName(event.target.value)}
                      onKeyDown={(event) => {
                        if (!isComposing(event) && event.key === 'Enter') void createSession();
                      }}
                      className="h-8 text-xs"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy || !/^[\w.:@$=-]{1,128}$/.test(sessionName.trim())}
                        onClick={() => void createSession()}
                      >
                        创建并关联
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
                        取消
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="flex items-center gap-1 text-[11px] text-muted hover:text-foreground"
                    disabled={status !== 'ready'}
                    onClick={() => setCreating(true)}
                  >
                    <Plus size={12} />
                    新建远程会话
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <a href="/settings" onClick={() => selectTask(null)} className="text-xs text-[var(--accent-solid)]">
            先配置 SSH 连接
          </a>
        )}
        {error && (
          <div role="alert" className="mt-2 space-y-1 text-xs text-[var(--danger)]">
            <p>{error}</p>
            <a href="/settings" onClick={() => selectTask(null)} className="underline">
              检查连接配置
            </a>
          </div>
        )}
      </section>
      <ResourceLinks
        key={`${taskId}:agent`}
        taskId={taskId}
        category="agent"
        links={links.filter((link) => link.type === 'agent')}
      />
      <ResourceLinks
        key={`${taskId}:note`}
        taskId={taskId}
        category="note"
        links={links.filter((link) => link.type !== 'agent' && link.type !== 'tmux')}
      />
    </div>
  );
}

function ResourceLinks({
  taskId,
  category,
  links,
}: {
  taskId: string;
  category: 'agent' | 'note';
  links: TaskLink[];
}) {
  const store = useCortex();
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const label = category === 'agent' ? 'Agent' : 'Note';
  const Icon = category === 'agent' ? Bot : FileText;
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const target = value.trim();
    if (!target) return;
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      setError('请输入完整链接');
      return;
    }
    if (!['http:', 'https:', 'obsidian:', 'agent:'].includes(url.protocol)) {
      setError('此链接类型无法打开');
      return;
    }
    const type: LinkType =
      category === 'agent'
        ? 'agent'
        : url.protocol === 'obsidian:'
          ? 'obsidian'
          : /(^|\.)yuque\.com$/.test(url.hostname)
            ? 'yuque'
            : 'url';
    store.addLink(taskId, type, target);
    setValue('');
    setError('');
  };
  return (
    <section aria-label={`${label} 关联`} className="border-t border-[var(--border)] pt-4">
      <h3 className="mb-2 flex items-center gap-2 text-xs font-medium">
        <Icon size={14} />
        {label}
      </h3>
      <div className="space-y-2">
        {links.map((link) => (
          <div key={link.id} className="flex items-center gap-2 text-xs">
            <Link2 size={12} className="shrink-0 text-muted" />
            <a
              href={/^(https?:|obsidian:|agent:)/i.test(link.target) ? link.target : undefined}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 truncate text-[var(--accent-solid)]"
              title={link.target}
            >
              {link.title || link.target}
            </a>
            <button
              aria-label={`移除 ${label} 链接`}
              className="text-muted"
              onClick={() => store.removeLink(link.id)}
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      <form onSubmit={submit} className="mt-2 flex gap-2">
        <Input
          aria-label={`${label} 链接`}
          placeholder={category === 'agent' ? '粘贴 Agent 会话链接' : '粘贴笔记或文档链接'}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && isComposing(event)) event.preventDefault();
          }}
          className="h-8 min-w-0 text-xs"
        />
        <button
          aria-label={`添加 ${label} 链接`}
          disabled={!value.trim()}
          className="text-muted hover:text-foreground disabled:opacity-40"
        >
          <Plus size={14} />
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-1 text-xs text-[var(--danger)]">
          {error}
        </p>
      )}
    </section>
  );
}
