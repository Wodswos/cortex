import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Check, LogIn, UserPlus, HardDrive } from 'lucide-react';
import { Button, Input, Badge, Spinner } from '@cortex/ui';
import { useAuth } from '@/app/auth';

export default function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void auth.refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 服务器没初始化(没有用户)→ 注册第一个(管理员)账号
  useEffect(() => {
    if (auth.initialized === false) setMode('register');
  }, [auth.initialized]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await auth.login(username.trim(), password);
      else await auth.register(username.trim(), password, invite.trim() || undefined);
      navigate('/');
    } catch (e) {
      setError((e as Error).message || '失败');
    } finally {
      setBusy(false);
    }
  };

  const firstUser = auth.initialized === false;

  return (
    <div className="relative z-10 flex h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl gradient-bg shadow-[0_8px_32px_-8px_color-mix(in_srgb,var(--accent-from)_70%,transparent)]">
            <Check className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-xl font-semibold">Cortex</h1>
          <p className="text-xs text-muted">local-first · 多端同步 · 你的效能中枢</p>
        </div>

        <div className="glass-raised rounded-2xl p-5">
          {firstUser && (
            <div className="mb-3 rounded-xl border border-[var(--accent-from)]/30 bg-[color-mix(in_srgb,var(--accent-from)_8%,transparent)] px-3 py-2 text-xs text-muted">
              首次部署:创建的第一个账号是管理员,之后注册需要邀请码
            </div>
          )}
          <div className="mb-4 flex gap-1">
            <button
              onClick={() => setMode('login')}
              disabled={firstUser}
              className={`flex-1 rounded-xl px-3 py-2 text-sm transition-all ${mode === 'login' ? 'gradient-bg text-white' : 'glass text-muted disabled:opacity-40'}`}
            >
              登录
            </button>
            <button
              onClick={() => setMode('register')}
              className={`flex-1 rounded-xl px-3 py-2 text-sm transition-all ${mode === 'register' ? 'gradient-bg text-white' : 'glass text-muted'}`}
            >
              注册
            </button>
          </div>

          <div className="space-y-3">
            <Input placeholder="用户名" value={username} autoComplete="username" onChange={(e) => setUsername(e.target.value)} />
            <Input
              placeholder="密码"
              type="password"
              value={password}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
            />
            {mode === 'register' && !firstUser && (
              <Input placeholder="邀请码" value={invite} onChange={(e) => setInvite(e.target.value)} />
            )}
            {error && <div className="text-xs text-[var(--danger)]">{error}</div>}
            <Button variant="primary" className="w-full" onClick={() => void submit()} disabled={busy || !username || !password}>
              {busy ? <Spinner /> : mode === 'login' ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
              {mode === 'login' ? '登录' : '创建账号'}
            </Button>
          </div>

          <div className="mt-4 flex items-center justify-between text-[11px] text-muted">
            {auth.serverReachable ? <Badge variant="success">服务器在线</Badge> : <Badge variant="danger">服务器不可达</Badge>}
            <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => navigate('/')}>
              <HardDrive className="h-3 w-3" /> 先用本地模式
            </button>
          </div>
        </div>

        <div className="mt-4 text-center text-[10px] text-muted/50">
          数据本地优先;登录后多端 CRDT 同步 · 服务器不可达也能完整使用
        </div>
      </div>
    </div>
  );
}
