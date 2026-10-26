import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Download, Upload, LogOut, KeyRound, Moon, Sun, Palette, Server, Bell, CopyPlus, Trash2, CircleCheck, Plus, Terminal } from 'lucide-react';
import { Button, Input, Badge, Card, CardContent, CardHeader, CardTitle, cn } from '@cortex/ui';
import { ACCENTS, Accent, generateICS, startOfDay, endOfDay, addDays, newId } from '@cortex/core';
import { api, useCortex, useCortexData } from '@cortex/crdt';
import { useAuth } from '@/app/auth';
import { useTheme } from '@/app/theme';
import { requestNotifPermission, notifSupported } from '@cortex/platform';

export default function SettingsPage() {
  const auth = useAuth();
  const theme = useTheme();
  const store = useCortex();
  const data = useCortexData();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [invites, setInvites] = useState<Awaited<ReturnType<typeof api.invites>>>([]);
  const [imported, setImported] = useState<string | null>(null);
  const [notifState, setNotifState] = useState('');
  const [serverName, setServerName] = useState('');
  const [serverHost, setServerHost] = useState('');
  const [serverPassword, setServerPassword] = useState('');
  const [serverError, setServerError] = useState('');
  const [serverBusy, setServerBusy] = useState(false);
  const [editingServer, setEditingServer] = useState<string | null>(null);

  const servers = data.settings.servers ?? [];
  const addServer = async () => {
    const name = serverName.trim(), host = serverHost.trim();
    if (!name || !host || serverBusy) return;
    setServerBusy(true); setServerError('');
    try {
      const server = await api.saveServer(editingServer ?? newId(), { name, host, password: serverPassword || undefined });
      store.updateSettings({ servers: [...store.getData().settings.servers.filter((item) => item.id !== server.id), server] });
      setServerName(''); setServerHost(''); setServerPassword('');
      setEditingServer(null);
    } catch (error) { setServerError((error as Error).message); }
    finally { setServerBusy(false); }
  };
  const removeServer = async (id: string) => {
    setServerError('');
    try { await api.removeServer(id); store.updateSettings({ servers: store.getData().settings.servers.filter((server) => server.id !== id) }); }
    catch (error) { setServerError((error as Error).message); }
  };

  const loadInvites = async () => {
    if (!auth.user?.isAdmin) return;
    try {
      setInvites(await api.invites());
    } catch {
      /* 非 admin 或离线 */
    }
  };
  useEffect(() => {
    void loadInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.id]);

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(store.exportSnapshot(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cortex-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportICS = () => {
    const now = new Date();
    const events = store
      .getData()
      .events.filter((e) => !e.deletedAt && e.end > startOfDay(now).getTime() && e.start < endOfDay(addDays(now, 30)).getTime())
      .map((e) => ({
        uid: e.id,
        title: `[${e.completed ? 'x' : ' '}] ${e.title}`,
        start: new Date(e.start),
        end: new Date(e.end),
        description: e.taskId ? 'Cortex 时间块' : undefined,
      }));
    const dueTasks = store
      .getData()
      .tasks.filter((t) => !t.deletedAt && t.dueAt != null && t.status !== 'done' && t.dueAt > now.getTime())
      .map((t) => ({
        uid: t.id,
        title: `📌 ${t.title}`,
        start: new Date(t.dueAt!),
        allDay: false,
      }));
    const blob = new Blob([generateICS([...events, ...dueTasks])], { type: 'text/calendar' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'cortex.ics';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJSON = async (file: File) => {
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error('备份文件不能超过 32 MB');
      const json: unknown = JSON.parse(await file.text());
      const n = store.importJSON(json);
      setImported(`已合并备份,新增 ${n} 条记录(旧 JSON 只补充缺失实体)`);
    } catch (e) {
      setImported(`导入失败:${(e as Error).message}`);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-5 pb-24 md:px-6">
        <h1 className="text-lg font-semibold">设置</h1>

        {/* 账号 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-[var(--accent-from)]" /> 账号
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {auth.phase === 'authed' && auth.user ? (
              <>
                <div className="flex items-center gap-2 text-sm">
                  <span className="gradient-text font-semibold">{auth.user.username}</span>
                  {auth.user.isAdmin && <Badge variant="accent">管理员</Badge>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void auth.logout()}>
                    <LogOut className="h-3.5 w-3.5" /> 登出
                  </Button>
                </div>
                {auth.user.isAdmin && (
                  <div className="rounded-xl border border-[var(--border)] p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs text-muted">邀请码(注册新账号用)</span>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={async () => {
                          const inv = await api.createInvite();
                          setInviteCode(inv.code);
                          void loadInvites();
                        }}
                      >
                        <CopyPlus className="h-3.5 w-3.5" /> 生成
                      </Button>
                    </div>
                    {inviteCode && (
                      <div className="mb-2 rounded-lg glass px-3 py-2 font-mono text-sm gradient-text">{inviteCode}</div>
                    )}
                    {invites.length > 0 && (
                      <div className="space-y-1">
                        {invites.map((inv) => (
                          <div key={inv.code} className="flex items-center gap-2 text-[11px] text-muted">
                            <code className="opacity-70">{inv.code.slice(0, 8)}…</code>
                            {inv.usedBy ? <Badge variant="success">已使用</Badge> : inv.revoked ? <Badge>已撤销</Badge> : <Badge variant="warning">待使用</Badge>}
                            {!inv.usedBy && !inv.revoked && (
                              <button
                                className="ml-auto hover:text-[var(--danger)]"
                                onClick={async () => {
                                  await api.revokeInvite(inv.code);
                                  void loadInvites();
                                }}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-muted">当前是本地模式,数据只存在这台设备的浏览器里</div>
                <Button size="sm" variant="primary" onClick={() => navigate('/login')}>
                  登录 / 注册
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 外观 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-[var(--accent-from)]" /> 外观
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm">模式</span>
              <div className="flex gap-1">
                {(['dark', 'light', 'system'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => theme.setMode(m)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs',
                      theme.mode === m ? 'gradient-bg text-white' : 'glass text-muted hover:text-foreground',
                    )}
                  >
                    {m === 'dark' ? <Moon className="h-3 w-3" /> : m === 'light' ? <Sun className="h-3 w-3" /> : <span className="text-[10px]">A</span>}
                    {m === 'dark' ? '深色' : m === 'light' ? '浅色' : '跟随系统'}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">强调色</span>
              <div className="flex gap-2">
                {ACCENTS.map((a: Accent) => (
                  <button
                    key={a}
                    onClick={() => theme.setAccent(a)}
                    className={cn('h-8 w-8 rounded-full transition-all', theme.accent === a && 'ring-2 ring-white/60')}
                    style={{
                      background:
                        a === 'cyan-violet'
                          ? 'linear-gradient(135deg,#22d3ee,#8b5cf6)'
                          : a === 'emerald'
                            ? 'linear-gradient(135deg,#34d399,#0ea5e9)'
                            : a === 'amber'
                              ? 'linear-gradient(135deg,#fbbf24,#f43f5e)'
                              : a === 'rose'
                                ? 'linear-gradient(135deg,#fb7185,#a78bfa)'
                                : 'linear-gradient(135deg,#18181b,#71717a)',
                    }}
                    title={a === 'mono' ? '黑白极简' : a}
                  />
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 服务器(tmux 直连目标) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-[var(--accent-from)]" /> 服务器
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-xs text-muted">
              任务关联的远程主机,支持 user@主机名、user@IP 和可选的 :端口。连接档案归当前账号所有。
              可填写 SSH 密码,或由部署者为当前账号配置独立密钥。
            </div>
            {servers.length > 0 && (
              <div className="space-y-1.5">
                {servers.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2">
                    <Server className="h-3.5 w-3.5 shrink-0 text-muted" />
                    <span className="min-w-0 shrink-0 truncate text-sm">{s.name}</span>
                    <code className="tabular min-w-0 flex-1 truncate text-[11px] text-muted">{s.host}</code>
                    {s.passwordSet && <Badge variant="warning" className="shrink-0 !text-[9px]">密码</Badge>}
                    <button className="shrink-0 text-xs text-muted underline" onClick={() => { setEditingServer(s.id); setServerName(s.name); setServerHost(s.host); setServerPassword(''); }}>
                      {s.registered === false ? '重新配置' : '配置'}
                    </button>
                    <button
                      onClick={() => void removeServer(s.id)}
                      className="shrink-0 text-muted/60 hover:text-[var(--danger)]"
                      title="删除该服务器档案(已关联的任务会显示「未知服务器」)"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                value={serverName}
                onChange={(e) => setServerName(e.target.value)}
                placeholder="名称,如 A100 训练机"
                className="h-8 flex-1 text-xs"
              />
              <Input
                value={serverHost}
                onChange={(e) => setServerHost(e.target.value)}
                placeholder="user@host[:port]"
                className="h-8 flex-1 text-xs"
              />
            </div>
            <div className="flex gap-2">
              <Input
                type="password"
                value={serverPassword}
                onChange={(e) => setServerPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void addServer()}
                placeholder="登录密码(可选;免密钥已配就留空)"
                className="h-8 flex-1 text-xs"
              />
              <Button size="sm" variant="secondary" className="h-8 shrink-0" disabled={auth.phase !== 'authed' || serverBusy || !serverName.trim() || !serverHost.trim()} onClick={() => void addServer()}>
                <Plus className="h-3.5 w-3.5" /> {editingServer ? '保存' : '添加'}
              </Button>
            </div>
            <div className="text-[10px] text-muted/60">
              SSH 密码在服务端加密保存,不进入任务同步或 JSON 导出。{auth.phase !== 'authed' && ' 请先登录以配置远程连接。'}
            </div>
            {serverError && <p role="alert" className="text-xs text-[var(--danger)]">{serverError}</p>}
          </CardContent>
        </Card>

        {/* 通知 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-[var(--accent-from)]" /> 通知
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-muted">
                番茄结束/日程提醒。{notifSupported() ? '浏览器通知' : '此环境不支持通知(iPhone PWA 需 HTTPS 安装)'}
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  const r = await requestNotifPermission();
                  setNotifState(r);
                }}
              >
                授权
              </Button>
            </div>
            {notifState && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                {notifState === 'granted' ? (
                  <>
                    <CircleCheck className="h-3.5 w-3.5 text-[var(--success)]" /> 已授权
                  </>
                ) : (
                  <>状态:{notifState}</>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 数据 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-4 w-4 text-[var(--accent-from)]" /> 数据
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={exportJSON}>
                <Download className="h-3.5 w-3.5" /> 导出 JSON
              </Button>
              <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> 导入 JSON
              </Button>
              <Button size="sm" variant="secondary" onClick={exportICS}>
                <Download className="h-3.5 w-3.5" /> 导出 .ics 日历
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && void importJSON(e.target.files[0])}
              />
            </div>
            {imported && <div className="text-xs text-[var(--success)]">{imported}</div>}
            <div className="text-[11px] text-muted/70">
              数据在本地(IndexedDB)+ 同步服务;导出是完整备份。同步服务不可用时本地照常工作。
            </div>
            <div className="flex items-center justify-between rounded-xl border border-[var(--border)] px-3 py-2 text-xs">
              <span className="text-muted">同步状态</span>
              <Badge variant={auth.syncStatus === 'online' ? 'success' : auth.syncStatus === 'connecting' ? 'warning' : 'default'}>
                {auth.phase === 'local' ? '未登录(本地)' : auth.syncStatus === 'online' ? '在线' : auth.syncStatus === 'connecting' ? '连接中' : '离线'}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <div className="pt-2 text-center text-[10px] text-muted/50">Cortex · local-first · CRDT 同步</div>
      </div>
    </div>
  );
}
