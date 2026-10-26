import type { ServerType } from '@hono/node-server';
import type { Duplex } from 'node:stream';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';
import { sshArgs, shellQuote, type SshConnection } from './connections';
import { originAllowed, upgradeUrl, type WsIdentity } from './security';

export const SESSION_RE = /^[\w.:@$=-]{1,128}$/;
const activeCommands = new Map<string, number>();

function sshEnvironment(connection: SshConnection): [NodeJS.ProcessEnv, () => void] {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, LANG: 'C.UTF-8' };
  if (!connection.password) return [env, () => {}];
  const path = join(tmpdir(), `cortex-askpass-${randomBytes(16).toString('hex')}`);
  writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' ${shellQuote(connection.password)}\n`, { mode: 0o700, flag: 'wx' });
  Object.assign(env, { SSH_ASKPASS: path, SSH_ASKPASS_REQUIRE: 'force', DISPLAY: ':none' });
  return [env, () => { try { unlinkSync(path); } catch { /* already removed */ } }];
}

/** No shell locally, no host-provided config, agent or shared identity. */
export async function sshRun(connection: SshConnection, command: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const count = activeCommands.get(connection.userId) ?? 0;
  if (count >= 4 || [...activeCommands.values()].reduce((a, b) => a + b, 0) >= 32) {
    return { code: -1, stdout: '', stderr: 'SSH 请求过多,请稍后重试' };
  }
  activeCommands.set(connection.userId, count + 1);
  let dispose = () => {};
  try {
    const environment = sshEnvironment(connection);
    const env = environment[0];
    dispose = environment[1];
    return await new Promise((resolve) => {
      const args = sshArgs(connection);
      if (!connection.password) args.unshift('-o', 'BatchMode=yes');
      const child = spawn('ssh', [...args, command], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '', finished = false;
      const timer = setTimeout(() => { child.kill('SIGKILL'); finish(-1, 'SSH 请求超时'); }, 8000);
      const finish = (code: number, error = '') => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve({ code, stdout, stderr: (error || stderr).slice(-500) });
      };
      child.stdout.on('data', (bytes: Buffer) => {
        stdout += bytes.toString('utf8');
        if (Buffer.byteLength(stdout) > 262144) { child.kill('SIGKILL'); finish(-1, 'SSH 输出过大'); }
      });
      child.stderr.on('data', (bytes: Buffer) => { stderr = (stderr + bytes.toString('utf8')).slice(-500); });
      child.on('error', (error) => finish(-1, error.message));
      child.on('close', (code) => finish(code ?? -1));
    });
  } finally {
    dispose();
    const left = (activeCommands.get(connection.userId) ?? 1) - 1;
    if (left) activeCommands.set(connection.userId, left); else activeCommands.delete(connection.userId);
  }
}

export function setupTmux(
  server: ServerType,
  verifyTicket: (ticket: string) => WsIdentity | null,
  resolveServer: (userId: string, serverId: string) => SshConnection | null,
) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const bridges = new Map<WebSocket, WsIdentity>();
  server.on('upgrade', (req, socket: Duplex, head) => {
    const url = upgradeUrl(req.url);
    if (url?.pathname !== '/api/tmux/attach') return;
    const deny = (status: string) => { socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`); socket.destroy(); };
    if (!originAllowed(req.headers)) return deny('403 Forbidden');
    const identity = verifyTicket(url.searchParams.get('ticket') ?? '');
    if (!identity) return deny('401 Unauthorized');
    if (bridges.size >= 32 || [...bridges.values()].filter((value) => value.userId === identity.userId).length >= 4) return deny('429 Too Many Requests');
    const connection = resolveServer(identity.userId, url.searchParams.get('serverId') ?? '');
    if (!connection) return deny('404 Not Found');
    const session = url.searchParams.get('session') ?? '';
    if (!SESSION_RE.test(session)) return deny('400 Bad Request');
    const cols = Math.floor(Math.min(500, Math.max(20, Number(url.searchParams.get('cols')) || 120)));
    const rows = Math.floor(Math.min(300, Math.max(5, Number(url.searchParams.get('rows')) || 36)));
    wss.handleUpgrade(req, socket, head, (ws) => {
      bridges.set(ws, identity);
      let child: ChildProcessWithoutNullStreams | null = null;
      let exited = false;
      let dispose = () => {};
      let stderr = '';
      const startup = setTimeout(() => ws.close(1008, 'start message required'), 5000);
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        clearTimeout(startup);
        bridges.delete(ws);
        if (child && child.exitCode === null) {
          const process = child;
          process.kill('SIGTERM');
          const kill = setTimeout(() => { if (process.exitCode === null) process.kill('SIGKILL'); }, 3000);
          kill.unref();
          process.once('close', () => { clearTimeout(kill); dispose(); });
        } else dispose();
      };
      const fail = (reason: string, code = -1) => {
        if (exited) return;
        exited = true;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'exit', code, reason }));
          ws.close();
        }
        cleanup();
      };
      ws.on('error', cleanup);
      ws.on('close', cleanup);
      ws.on('message', (data, binary) => {
        if (!child) {
          try {
            const message = !binary ? JSON.parse(data.toString()) as { type?: unknown } : null;
            if (message?.type !== 'start') return ws.close(1008, 'invalid start message');
            clearTimeout(startup);
            const environment = sshEnvironment(connection);
            dispose = environment[1];
            const args = ['-tt', ...sshArgs(connection)];
            if (!connection.password) args.unshift('-o', 'BatchMode=yes');
            const command = `TERM=xterm-256color; export TERM; stty rows ${rows} cols ${cols}; exec tmux attach-session -t ${shellQuote(session)}`;
            child = spawn('ssh', [...args, command], { env: environment[0], stdio: ['pipe', 'pipe', 'pipe'] });
            child.stdout.on('data', (bytes: Buffer) => {
              if (ws.bufferedAmount > 2 * 1024 * 1024) return fail('终端客户端读取过慢');
              if (ws.readyState === WebSocket.OPEN) ws.send(bytes);
            });
            child.stderr.on('data', (bytes: Buffer) => { stderr = (stderr + bytes.toString()).slice(-500); });
            child.on('error', (error) => fail(error.message));
            child.on('close', (code) => fail(stderr.trim() || '会话已结束', code ?? -1));
          } catch { ws.close(1008, 'invalid start message'); }
          return;
        }
        if (!exited && child.stdin.writable) child.stdin.write(Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data);
      });
    });
  });
  return {
    disconnectSession(token: string) { for (const [ws, identity] of bridges) if (identity.sessionToken === token) ws.close(1008, 'session ended'); },
    close() { for (const ws of bridges.keys()) ws.close(1001, 'server shutdown'); wss.close(); },
  };
}
