import { createAdaptorServer } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { DB } from './db';
import { setupSync } from './sync';
import { setupTmux, sshRun, SESSION_RE } from './tmux';
import { Connections, parseSshHost, shellQuote, sshCredentialError } from './connections';
import { hashPassword, verifyPassword, RateLimit, originAllowed, upgradeUrl, type WsIdentity } from './security';

const PORT = Number(process.env.PORT ?? 30090);
const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR ?? join(HERE, '..', 'data');
const PUBLIC_DIR = [process.env.PUBLIC_DIR, join(HERE, '..', 'public'), join(process.cwd(), 'public'), join(process.cwd(), '..', 'web', 'dist')]
  .find((path) => path && existsSync(join(path, 'index.html'))) ?? join(HERE, '..', 'public');
const db = new DB(DATA_DIR);
const connections = new Connections(db, DATA_DIR);
const app = new Hono();
const COOKIE = 'cortex_session';
const secureCookie = process.env.COOKIE_SECURE !== undefined ? process.env.COOKIE_SECURE === 'true'
  : !!process.env.PUBLIC_ORIGIN?.startsWith('https:') || process.env.NODE_ENV === 'production';
const cookieOptions = { httpOnly: true, sameSite: 'Lax' as const, path: '/', secure: secureCookie };
function currentUser(c: Context): string | null { const token = getCookie(c, COOKIE); return token ? db.getSession(token)?.user_id ?? null : null; }
function incoming(c: Context) { return (c.env as { incoming?: import('node:http').IncomingMessage }).incoming; }
async function json(c: Context): Promise<Record<string, unknown> | null> {
  const body: unknown = await c.req.json().catch(() => null);
  return body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
}
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
app.use('/api/*', bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: '请求过大' }, 413) }));
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  const req = incoming(c);
  if (req && !originAllowed(req.headers)) return c.json({ error: '请求来源不受信任' }, 403);
  const expected = c.req.header('X-Cortex-User');
  if (expected && !['/api/auth/login', '/api/auth/register', '/api/auth/status', '/api/auth/me'].includes(c.req.path) && currentUser(c) !== expected) {
    return c.json({ error: '账号已切换,请重新载入', code: 'identity_changed' }, 409);
  }
  await next();
});
const loginLimit = new RateLimit(20, 60000);
let hashing = 0;
app.use('/api/auth/*', async (c, next) => {
  if (c.req.method !== 'POST' || !['/api/auth/login', '/api/auth/register'].includes(c.req.path)) return next();
  const ip = incoming(c)?.socket.remoteAddress ?? 'unknown';
  if (!loginLimit.allow(ip) || hashing >= 4) { c.header('Retry-After', '60'); return c.json({ error: '尝试过多,请稍后重试' }, 429); }
  hashing++;
  try { await next(); } finally { hashing--; }
});
app.get('/api/auth/status', (c) => c.json({ initialized: db.countUsers() > 0, version: '0.3.0' }));
app.get('/api/auth/me', (c) => {
  const id = currentUser(c);
  const user = id ? db.getUser(id) : null;
  return user ? c.json({ id: user.id, username: user.username, isAdmin: !!user.is_admin }) : c.json({ error: 'unauthorized' }, 401);
});
app.post('/api/auth/login', async (c) => {
  const body = await json(c);
  const username = text(body?.username);
  const password = typeof body?.password === 'string' ? body.password : '';
  if (username.length > 32 || password.length > 1024) return c.json({ error: '无效的登录信息' }, 400);
  const user = db.getUserByUsername(username);
  const valid = await verifyPassword(password, user?.salt ?? 'cortex-dummy-salt', user?.password_hash ?? '00'.repeat(64));
  if (!user || !valid) return c.json({ error: '用户名或密码错误' }, 401);
  const token = db.createSession(user.id);
  setCookie(c, COOKIE, token, { ...cookieOptions, maxAge: 180 * 86400 });
  return c.json({ id: user.id, username: user.username, isAdmin: !!user.is_admin });
});
app.post('/api/auth/register', async (c) => {
  const body = await json(c);
  const username = text(body?.username);
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!/^[a-zA-Z0-9_一-龥]{2,32}$/.test(username) || password.length < 6 || password.length > 1024) return c.json({ error: '用户名需 2–32 位,密码需 6–1024 位' }, 400);
  const { hash, salt } = await hashPassword(password);
  try {
    const user = db.registerUser(username, hash, salt, text(body?.inviteCode) || undefined);
    const token = db.createSession(user.id);
    setCookie(c, COOKIE, token, { ...cookieOptions, maxAge: 180 * 86400 });
    return c.json({ id: user.id, username: user.username, isAdmin: !!user.is_admin });
  } catch (error) {
    const message = (error as Error).message;
    if (message === '用户名已存在') return c.json({ error: message }, 409);
    if (message === '邀请码无效') return c.json({ error: message }, 403);
    throw error;
  }
});
app.post('/api/auth/logout', (c) => {
  const token = getCookie(c, COOKIE);
  if (token) { db.deleteSession(token); sync.disconnectSession(token); tmux.disconnectSession(token); }
  deleteCookie(c, COOKIE, cookieOptions);
  return c.json({ ok: true });
});
type Purpose = 'sync' | 'tmux';
const tickets = new Map<string, WsIdentity & { expires: number; purpose: Purpose }>();
app.get('/api/auth/ticket', (c) => {
  const userId = currentUser(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);
  if (c.req.query('userId') !== userId) return c.json({ error: '账号已切换', code: 'identity_changed' }, 409);
  const purpose = c.req.query('purpose') ?? 'sync';
  if (purpose !== 'sync' && purpose !== 'tmux') return c.json({ error: '无效的票据用途' }, 400);
  for (const [key, ticket] of tickets) if (ticket.expires < Date.now()) tickets.delete(key);
  if (tickets.size >= 1024) return c.json({ error: '票据请求过多' }, 429);
  const ticket = randomBytes(24).toString('hex');
  tickets.set(ticket, { userId, sessionToken: getCookie(c, COOKIE)!, purpose, expires: Date.now() + 60000 });
  return c.json({ ticket, userId });
});
function verifyTicket(value: string, purpose: Purpose): WsIdentity | null {
  const ticket = tickets.get(value);
  tickets.delete(value);
  if (!ticket || ticket.purpose !== purpose || ticket.expires < Date.now() || db.getSession(ticket.sessionToken)?.user_id !== ticket.userId) return null;
  return ticket;
}
function admin(c: Context) { const id = currentUser(c); return id ? db.getUser(id)?.is_admin : false; }
app.get('/api/invites', (c) => {
  if (!admin(c)) return c.json({ error: 'forbidden' }, 403);
  return c.json(db.listInvites().map((row) => ({ code: row.code, createdAt: row.created_at, usedBy: row.used_by, revoked: !!row.revoked })));
});
app.post('/api/invites', (c) => {
  if (!admin(c)) return c.json({ error: 'forbidden' }, 403);
  const invite = db.createInvite(currentUser(c)!);
  return c.json({ code: invite.code, createdAt: invite.created_at, usedBy: invite.used_by, revoked: !!invite.revoked });
});
app.delete('/api/invites/:code', (c) => { if (!admin(c)) return c.json({ error: 'forbidden' }, 403); db.revokeInvite(c.req.param('code')); return c.json({ ok: true }); });
app.get('/api/export', (c) => {
  const userId = currentUser(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);
  return c.json({ format: 'cortex.server-export', version: 1, exportedAt: Date.now(), docs: sync.snapshots(userId) });
});
app.get('/api/servers', (c) => {
  const userId = currentUser(c);
  return userId ? c.json(db.listServers(userId).map((row) => connections.public(row))) : c.json({ error: 'unauthorized' }, 401);
});
app.put('/api/servers/:id', async (c) => {
  const userId = currentUser(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);
  const body = await json(c);
  const id = c.req.param('id'), name = text(body?.name), host = text(body?.host);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !name || name.length > 128 || !parseSshHost(host) || (body?.password !== undefined && (typeof body.password !== 'string' || body.password.length > 1024))) return c.json({ error: '无效的服务器档案' }, 400);
  const existing = db.getServer(userId, id);
  if (!existing && db.listServers(userId).length >= 100) return c.json({ error: '服务器档案过多' }, 400);
  const row = { id, user_id: userId, name, host, password_cipher: typeof body?.password === 'string' ? connections.encrypt(body.password) : existing?.password_cipher ?? null };
  db.saveServer(row);
  return c.json(connections.public(row));
});
app.delete('/api/servers/:id', (c) => { const id = currentUser(c); if (!id) return c.json({ error: 'unauthorized' }, 401); db.deleteServer(id, c.req.param('id')); return c.json({ ok: true }); });

// All terminal actions resolve an account-owned serverId. Host/password from the client confer no permissions.
const terminalLimit = new RateLimit(60, 60000);
app.post('/api/tmux/:action', async (c) => {
  const userId = currentUser(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);
  if (!terminalLimit.allow(userId)) return c.json({ error: '终端请求过多' }, 429);
  const body = await json(c);
  const connection = connections.resolve(userId, text(body?.serverId));
  if (!connection) return c.json({ error: '服务器档案不存在' }, 404);
  const credentialError = sshCredentialError(connection);
  if (credentialError) return c.json({ error: credentialError }, 422);
  const action = c.req.param('action');
  const session = text(body?.session);
  if (action !== 'sessions' && !SESSION_RE.test(session)) return c.json({ error: '无效的 session 名' }, 400);
  const target = shellQuote(session);
  let command: string;
  if (action === 'sessions') command = "tmux list-sessions -F '#{session_name}'";
  else if (action === 'new-session') command = `tmux new-session -d -s ${target}`;
  else if (action === 'kill-session') command = `tmux kill-session -t ${target}`;
  else if (action === 'windows') command = `tmux list-windows -t ${target} -F '#{window_id}|#{window_index}|#{window_name}|#{window_active}'`;
  else if (action === 'new-window') {
    const name = text(body?.name);
    if (name && !SESSION_RE.test(name)) return c.json({ error: '无效的窗口名' }, 400);
    command = `tmux new-window -t ${target}${name ? ` -n ${shellQuote(name)}` : ''}`;
  } else if (action === 'kill-window') {
    const windowId = text(body?.windowId);
    if (!/^@\d+$/.test(windowId)) return c.json({ error: '无效的 windowId' }, 400);
    // Resolve window indexes inside the selected session, never a global @id supplied alone.
    const listed = await sshRun(connection, `tmux list-windows -t ${target} -F '#{window_id}|#{window_index}'`);
    const index = listed.stdout.split('\n').map((line) => line.split('|')).find(([id]) => id === windowId)?.[1];
    if (listed.code || !index || !/^\d+$/.test(index)) return c.json({ error: '窗口不属于该会话' }, 404);
    command = `tmux kill-window -t ${shellQuote(`${session}:${index}`)}`;
  } else return c.json({ error: 'not found' }, 404);
  const result = await sshRun(connection, command);
  if (action === 'sessions') {
    if (result.code && !/no server running|no sessions|failed to connect to server/.test(result.stderr)) return c.json({ error: result.stderr || 'SSH 执行失败' }, 502);
    return c.json({ sessions: result.code ? [] : result.stdout.split('\n').map((value) => value.trim()).filter(Boolean) });
  }
  if (result.code) return c.json({ error: result.stderr || `退出码 ${result.code}` }, 502);
  if (action === 'windows') return c.json({ windows: result.stdout.split('\n').filter(Boolean).map((line) => { const [id, index, name, active] = line.split('|'); return { id, index: Number(index), name: name ?? '', active: active === '1' }; }) });
  return c.json({ ok: true });
});
app.get('/healthz', (c) => c.json({ ok: true, uptime: process.uptime() }));
if (existsSync(PUBLIC_DIR)) {
  app.use('/*', serveStatic({ root: relative(process.cwd(), PUBLIC_DIR) || '.' }));
  app.get('*', (c) => {
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'not found' }, 404);
    if (c.req.path !== '/' && /\.[a-z0-9]+$/i.test(c.req.path)) return c.text('not found', 404);
    const index = join(PUBLIC_DIR, 'index.html');
    return existsSync(index) ? c.html(readFileSync(index, 'utf8')) : c.text('Cortex server', 200);
  });
}
const server = createAdaptorServer(app);
const sync = setupSync(server, db, (ticket) => verifyTicket(ticket, 'sync'));
const tmux = setupTmux(server, (ticket) => verifyTicket(ticket, 'tmux'), (userId, serverId) => connections.resolve(userId, serverId));
server.on('upgrade', (req, socket) => { const path = upgradeUrl(req.url)?.pathname; if (path !== '/api/sync' && path !== '/api/tmux/attach') socket.destroy(); });
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  if (closing) return;
  closing = true;
  sync.close(); tmux.close();
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
});
server.listen(PORT, () => {
  const address = server.address();
  console.log(`Cortex server on :${typeof address === 'object' && address ? address.port : PORT}`);
});
