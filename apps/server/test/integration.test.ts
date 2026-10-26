import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as protocol from 'y-protocols/sync';
import { encodeFrame, decodeFrame } from '../../../packages/crdt/src/framing';

const sockets: WebSocket[] = [];
let child: ChildProcess, dir: string, base: string;
let a: { id: string; cookie: string }, b: { id: string; cookie: string };
let diagnostics = '';
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function request(path: string, cookie = '', data?: unknown, method = data === undefined ? 'GET' : 'POST', extra: Record<string, string> = {}) {
  return fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...extra }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
}
async function ticket(user: typeof a, purpose = 'sync') {
  const response = await request(`/api/auth/ticket?userId=${user.id}&purpose=${purpose}`, user.cookie);
  expect(response.status).toBe(200);
  return (await response.json() as { ticket: string }).ticket;
}
async function open(path: string) {
  const ws = new WebSocket(base.replace('http:', 'ws:') + path);
  sockets.push(ws);
  ws.on('error', () => {});
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return ws;
}
async function device(user: typeof a) {
  const ws = await open(`/api/sync?ticket=${await ticket(user)}`);
  const doc = new Y.Doc();
  let received = 0;
  ws.on('message', (bytes) => {
    received++;
    const frame = decodeFrame(new Uint8Array(bytes as Buffer));
    if (!frame) return;
    const reply = encoding.createEncoder();
    protocol.readSyncMessage(decoding.createDecoder(frame.payload), reply, doc, 'remote');
    const encoded = encoding.toUint8Array(reply);
    if (encoded.length > 1) ws.send(encodeFrame('tasks', encoded));
  });
  doc.on('update', (update, origin) => {
    if (origin === 'remote') return;
    const encoded = encoding.createEncoder(); protocol.writeUpdate(encoded, update);
    ws.send(encodeFrame('tasks', encoding.toUint8Array(encoded)));
  });
  const encoded = encoding.createEncoder(); protocol.writeSyncStep1(encoded, doc);
  ws.send(encodeFrame('tasks', encoding.toUint8Array(encoded)));
  await delay(75);
  return { ws, doc, received: () => received };
}
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cortex-integration-'));
  mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'bin', 'ssh'), `#!${process.execPath}\n` + String.raw`
const {execFileSync} = require('node:child_process');
if (process.argv.at(-1).includes('attach-session')) {
  const valid = process.env.SSH_ASKPASS && execFileSync(process.env.SSH_ASKPASS).toString().trim() === 'fixture-password';
  process.stdout.write(valid ? 'vault-password-ready' : 'wrong-credential');
  process.stdin.pipe(process.stdout);
} else console.log('isolated-session');
`, { mode: 0o700 });
  const require = createRequire(import.meta.url);
  child = spawn(process.execPath, ['--import', require.resolve('tsx/esm'), fileURLToPath(new URL('../src/index.ts', import.meta.url))], {
    env: { ...process.env, PORT: '0', NODE_ENV: 'test', COOKIE_SECURE: 'false', PUBLIC_ORIGIN: '', DATA_DIR: join(dir, 'data'), PATH: `${join(dir, 'bin')}:${process.env.PATH}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr!.on('data', (bytes) => { diagnostics += bytes.toString(); });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server startup failed: ${diagnostics}`)), 10000);
    child.stdout!.on('data', (bytes) => { const match = /Cortex server on :(\d+)/.exec(bytes.toString()); if (match) { base = `http://127.0.0.1:${match[1]}`; clearTimeout(timeout); resolve(); } });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error(`Server exited: ${diagnostics}`)); });
  });
  const first = await request('/api/auth/register', '', { username: 'alice', password: 'fixture-password' });
  a = { ...(await first.json() as { id: string }), cookie: first.headers.get('set-cookie')!.split(';')[0]! };
  const invite = await request('/api/invites', a.cookie, {}).then((response) => response.json()) as { code: string };
  const second = await request('/api/auth/register', '', { username: 'bob', password: 'fixture-password', inviteCode: invite.code });
  b = { ...(await second.json() as { id: string }), cookie: second.headers.get('set-cookie')!.split(';')[0]! };
}, 15000);
afterAll(async () => {
  for (const ws of sockets) ws.terminate();
  if (child?.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('authenticated HTTP / WebSocket integration', () => {
  it('rejects unauthenticated terminal requests, foreign origins and cross-account profile use', async () => {
    expect((await request('/api/tmux/sessions', '', { host: 'someone-else.invalid' })).status).toBe(401);
    expect((await request('/api/tmux/sessions', a.cookie, { host: 'host.invalid' }, 'POST', { Origin: 'https://foreign.invalid' })).status).toBe(403);
    const saved = await request('/api/servers/server-a', a.cookie, { name: 'owned by A', host: 'alice@host-a.invalid', password: 'fixture-password' }, 'PUT');
    expect(saved.status).toBe(200);
    const metadata = await saved.json();
    expect(metadata).toMatchObject({ passwordSet: true, registered: true }); expect(metadata).not.toHaveProperty('password');
    expect((await request('/api/tmux/sessions', b.cookie, { serverId: 'server-a' })).status).toBe(404);
    expect(await request('/api/servers', b.cookie).then((response) => response.json())).toEqual([]);
    expect(await request('/api/tmux/sessions', a.cookie, { serverId: 'server-a' }).then((response) => response.json())).toEqual({ sessions: ['isolated-session'] });
    expect((await request('/api/auth/ticket?userId=' + a.id, b.cookie)).status).toBe(409);
    expect((await request('/api/servers', b.cookie, undefined, 'GET', { 'X-Cortex-User': a.id })).status).toBe(409);
  });
  it('uses the account vault rather than a password supplied in the terminal start frame', async () => {
    const ws = await open(`/api/tmux/attach?ticket=${await ticket(a, 'tmux')}&serverId=server-a&session=test`);
    const output = new Promise<string>((resolve) => ws.once('message', (bytes) => resolve(bytes.toString())));
    ws.send(JSON.stringify({ type: 'start', password: 'untrusted-client-value' }));
    expect(await output).toBe('vault-password-ready');
    ws.close();
  });
  it('converges two devices, stays quiet after handshake and exports unflushed live updates', async () => {
    const first = await device(a), second = await device(a), otherAccount = await device(b);
    first.doc.getMap('items').set('private', new Y.Map([['title', 'A private task']]));
    for (let i = 0; i < 40 && !second.doc.getMap('items').has('private'); i++) await delay(25);
    expect(second.doc.getMap('items').get('private')).toBeInstanceOf(Y.Map);
    expect(otherAccount.doc.getMap('items').has('private')).toBe(false);
    const exported = await request('/api/export', a.cookie).then((response) => response.json()) as { docs: Record<string, string> };
    const restored = new Y.Doc(); Y.applyUpdate(restored, Buffer.from(exported.docs.tasks!, 'base64'));
    expect(restored.getMap('items').has('private')).toBe(true);
    await delay(75); const messages = first.received() + second.received(); await delay(100);
    expect(first.received() + second.received()).toBe(messages);
  });
  it('isolates invalid UTF-8 and unknown document errors to the offending connection', async () => {
    const invalid = await open(`/api/sync?ticket=${await ticket(a)}`);
    const closed = new Promise((resolve) => invalid.once('close', resolve));
    invalid.send(Buffer.from([255]), { binary: false }); await closed;
    expect((await request('/healthz')).status).toBe(200); expect(child.exitCode).toBeNull();
    const unknown = await open(`/api/sync?ticket=${await ticket(a)}`);
    const unknownClosed = new Promise<number>((resolve) => unknown.once('close', resolve));
    unknown.send(encodeFrame('arbitrary-room', new Uint8Array([0, 0])));
    expect(await unknownClosed).toBe(1008);
    expect((await request('/healthz')).status).toBe(200);
  });
  it('revokes active connections and unused tickets when their session logs out', async () => {
    const unused = await ticket(b);
    const ws = await open(`/api/sync?ticket=${await ticket(b)}`);
    const closed = new Promise<number>((resolve) => ws.once('close', resolve));
    expect((await request('/api/auth/logout', b.cookie, {})).status).toBe(200);
    expect(await closed).toBe(1008);
    await expect(open(`/api/sync?ticket=${unused}`)).rejects.toThrow(/401/);
  });
});
