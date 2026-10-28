import type { ServerConfig } from '@cortex/core';

let expectedUserId: string | null = null;
export function setApiUserId(id: string | null): void { expectedUserId = id; }
export function apiUserId(): string | null { return expectedUserId; }

export interface AuthUser {
  id: string;
  username: string;
  isAdmin: boolean;
}

export interface Invite {
  code: string;
  createdAt: number;
  usedBy: string | null;
  revoked: boolean;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try { res = await fetch(path, {
    ...init,
    credentials: 'include',
    signal: init?.signal ?? controller.signal,
    headers: { 'Content-Type': 'application/json', ...(expectedUserId ? { 'X-Cortex-User': expectedUserId } : {}), ...(init?.headers ?? {}) },
  }); } finally { clearTimeout(timeout); }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  /** 服务器状态:是否已初始化(有无用户)、注册是否需要邀请码 */
  status(): Promise<{ initialized: boolean; version: string }> {
    return req('/api/auth/status');
  },

  me(): Promise<AuthUser | null> {
    return req<AuthUser | null>('/api/auth/me').catch((e) => {
      if (e instanceof ApiError && e.status === 401) return null;
      throw e;
    });
  },

  login(username: string, password: string): Promise<AuthUser> {
    return req('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  },

  register(username: string, password: string, inviteCode?: string): Promise<AuthUser> {
    return req('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, inviteCode }),
    });
  },

  logout(): Promise<void> {
    return req('/api/auth/logout', { method: 'POST' });
  },

  ticket(userId: string, purpose: 'sync' | 'tmux' = 'sync'): Promise<string> {
    return req<{ ticket: string; userId: string }>(`/api/auth/ticket?userId=${encodeURIComponent(userId)}&purpose=${purpose}`).then((r) => {
      if (r.userId !== userId) throw new ApiError(409, '账号已切换');
      return r.ticket;
    });
  },

  invites(): Promise<Invite[]> {
    return req('/api/invites');
  },

  createInvite(): Promise<Invite> {
    return req('/api/invites', { method: 'POST' });
  },

  revokeInvite(code: string): Promise<void> {
    return req(`/api/invites/${encodeURIComponent(code)}`, { method: 'DELETE' });
  },

  /** 服务端全量快照(备份用,含所有设备已同步的数据) */
  serverExport(): Promise<{ format: 'cortex.server-export'; version: 1; docs: Record<string, string> }> {
    return req('/api/export');
  },

  servers(): Promise<ServerConfig[]> { return req('/api/servers'); },
  saveServer(id: string, server: { name: string; host: string; password?: string }): Promise<ServerConfig> {
    return req(`/api/servers/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(server) });
  },
  removeServer(id: string): Promise<void> { return req(`/api/servers/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
  tmux<T>(action: string, serverId: string, session?: string, extra: Record<string, unknown> = {}): Promise<T> {
    return req(`/api/tmux/${action}`, { method: 'POST', body: JSON.stringify({ serverId, session, ...extra }) }, 12000);
  },
};
