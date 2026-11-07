import React, { useEffect, useState } from 'react';
import { ExternalLink, KeyRound, Trash2, Copy } from 'lucide-react';
import { api, apiUrl, type AgentToken } from '@cortex/crdt';
import { Button, Input, Card, CardHeader, CardTitle, CardContent } from '@cortex/ui';

export function AgentApiSettings() {
  const [tokens, setTokens] = useState<AgentToken[]>([]);
  const [name, setName] = useState('');
  const [permission, setPermission] = useState<'read' | 'write'>('read');
  const [days, setDays] = useState('90');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const load = async () => { const result = await api.agentTokens(); setTokens(result.data); setLoaded(true); };
  useEffect(() => { let active = true; void api.agentTokens().then(result => { if (active) { setTokens(result.data); setLoaded(true); } }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '读取失败'); }); return () => { active = false; }; }, []);
  const run = async (operation: () => Promise<void>) => { setBusy(true); setError(''); try { await operation(); } catch (cause) { setError(cause instanceof Error ? cause.message : '请求失败'); } finally { setBusy(false); } };
  const select = 'h-9 min-w-0 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 text-sm';
  return <Card>
    <CardHeader><CardTitle><KeyRound size={15} />Agent API<a href={apiUrl('/api/docs')} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs font-normal text-muted hover:text-foreground">Swagger 文档<ExternalLink size={12} /></a></CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <p className="text-xs leading-relaxed text-muted">供 Agent 读写当前账号的任务、项目、习惯与复盘。每个 Agent 可使用独立 Token，随时撤销；不授予 SSH 或其他账号权限。</p>
      <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (!busy && name.trim()) void run(async () => {
        setSecret(''); const result = await api.createAgentToken({ name: name.trim(), permission, expiresInDays: Number(days) });
        setSecret(result.token); setName(''); await load();
      }); }}>
        <Input aria-label="Agent Token 名称" placeholder="例如：本机 Agent" maxLength={80} required disabled={busy} value={name} onChange={event => setName(event.target.value)} />
        <div className="flex flex-wrap items-center gap-2"><select aria-label="Agent Token 权限" className={select} disabled={busy} value={permission} onChange={event => setPermission(event.target.value as 'read' | 'write')}><option value="read">只读</option><option value="write">读写</option></select><select aria-label="Agent Token 有效期" className={select} disabled={busy} value={days} onChange={event => setDays(event.target.value)}><option value="30">30 天</option><option value="90">90 天</option><option value="365">1 年</option></select><Button type="submit" size="sm" disabled={busy || !loaded || !name.trim()}>创建 Token</Button></div>
      </form>
      {secret && <div className="space-y-2 rounded-lg border border-[var(--border-strong)] p-3"><p className="text-xs text-muted">Token 仅在此显示一次，请复制后保存。</p><div className="flex items-center gap-2"><Input aria-label="新建的 Agent Token" readOnly value={secret} className="min-w-0 flex-1 font-mono text-xs" onFocus={event => event.target.select()} /><button type="button" aria-label="复制 Agent Token" title="复制 Token；也可选中文字手动复制" className="shrink-0 text-muted hover:text-foreground" onClick={() => {
        if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(secret).catch(() => setError('请选中 Token 后手动复制'));
        else setError('请选中 Token 后手动复制');
      }}><Copy size={14} /></button></div><button type="button" className="text-xs text-muted hover:text-foreground" onClick={() => setSecret('')}>已保存，收起</button></div>}
      {tokens.length > 0 && <ul className="divide-y divide-[var(--border)]">{tokens.map(token => <li key={token.id} className="flex min-w-0 items-center gap-2 py-2 text-xs"><span className="min-w-0 flex-1 truncate" title={token.name}>{token.name}</span><span className="shrink-0 text-muted">{token.permission === 'read' ? '只读' : '读写'}</span><span className="shrink-0 text-muted">{token.expiresAt <= Date.now() ? '已过期' : `${new Date(token.expiresAt).toLocaleDateString()} 到期`}</span><button type="button" disabled={busy} aria-label={`撤销 Token ${token.name}`} title="立即撤销此 Token" className="shrink-0 text-muted hover:text-[var(--danger)]" onClick={() => void run(async () => { await api.revokeAgentToken(token.id); setSecret(''); await load(); })}><Trash2 size={13} /></button></li>)}</ul>}
      {error && <p role="alert" className="text-xs text-[var(--danger)]">{error}</p>}
    </CardContent>
  </Card>;
}
