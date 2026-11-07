import { afterAll, beforeAll, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as protocol from 'y-protocols/sync';
import { encodeFrame, decodeFrame } from '../../../packages/crdt/src/framing';

let child: ChildProcess, dir: string, base: string;
let cookie: string, otherCookie: string, token: string, readToken: string, otherToken: string, userId: string;
const sockets: WebSocket[] = [];
let diagnostic = '';
async function start() {
  const require = createRequire(import.meta.url);
  child = spawn(process.execPath, ['--import', require.resolve('tsx/esm'), fileURLToPath(new URL('../src/index.ts', import.meta.url))], { env: { ...process.env, PORT: '0', NODE_ENV: 'test', COOKIE_SECURE: 'false', PUBLIC_ORIGIN: '', DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr!.on('data', bytes => { diagnostic += bytes; });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(diagnostic)), 10000);
    child.stdout!.on('data', bytes => { const match = /Cortex server on :(\d+)/.exec(String(bytes)); if (match) { base = `http://127.0.0.1:${match[1]}`; clearTimeout(timeout); resolve(); } });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error(diagnostic)); });
  });
}
async function stop() { if (child?.exitCode === null) { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); } }
function request(path: string, method = 'GET', data?: unknown, auth = token, headers: Record<string, string> = {}) {
  return fetch(base + path, { method, headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
}
async function value(path: string, method = 'GET', body?: unknown, auth = token) {
  const response = await request(path, method, body, auth); expect(response.ok, await response.clone().text()).toBe(true);
  return (await response.json() as { data: any }).data;
}
async function createToken(cookieValue: string, permission: 'read' | 'write') {
  const response = await request('/api/tokens', 'POST', { name: 'fixture', permission, expiresInDays: 90 }, '', { Cookie: cookieValue });
  expect(response.status).toBe(201); return await response.json() as { token: string; data: { id: string } };
}
async function device(name: 'tasks' | 'root') {
  const ticket = await request(`/api/auth/ticket?userId=${userId}`, 'GET', undefined, '', { Cookie: cookie }).then(response => response.json()) as { ticket: string };
  const ws = new WebSocket(base.replace('http:', 'ws:') + `/api/sync?ticket=${ticket.ticket}`); sockets.push(ws);
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const doc = new Y.Doc();
  ws.on('message', bytes => {
    const frame = decodeFrame(new Uint8Array(bytes as Buffer)); if (!frame || frame.docId !== name) return;
    const reply = encoding.createEncoder(); protocol.readSyncMessage(decoding.createDecoder(frame.payload), reply, doc, 'remote');
    const out = encoding.toUint8Array(reply); if (out.length > 1) ws.send(encodeFrame(name, out));
  });
  doc.on('update', (update, origin) => { if (origin === 'remote') return; const encoder = encoding.createEncoder(); protocol.writeUpdate(encoder, update); ws.send(encodeFrame(name, encoding.toUint8Array(encoder))); });
  const encoder = encoding.createEncoder(); protocol.writeSyncStep1(encoder, doc); ws.send(encodeFrame(name, encoding.toUint8Array(encoder)));
  return { ws, doc };
}
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cortex-rest-')); await start();
  const first = await request('/api/auth/register', 'POST', { username: 'api_alice', password: 'fixture-password' }, '');
  cookie = first.headers.get('set-cookie')!.split(';')[0]!; userId = (await first.json() as { id: string }).id;
  const invite = await request('/api/invites', 'POST', {}, '', { Cookie: cookie }).then(response => response.json()) as { code: string };
  const second = await request('/api/auth/register', 'POST', { username: 'api_bob', password: 'fixture-password', inviteCode: invite.code }, '');
  otherCookie = second.headers.get('set-cookie')!.split(';')[0]!;
  token = (await createToken(cookie, 'write')).token; readToken = (await createToken(cookie, 'read')).token; otherToken = (await createToken(otherCookie, 'write')).token;
}, 15000);
afterAll(async () => { for (const ws of sockets) ws.terminate(); await stop(); if (dir) rmSync(dir, { recursive: true, force: true }); });

it('requires account-issued tokens, enforces permissions and origin, protects token secrets and revocation', async () => {
  expect((await request('/api/v1/tasks', 'GET', undefined, '')).status).toBe(401);
  expect((await request('/api/v1/tasks', 'GET', undefined, '', { Cookie: cookie })).status).toBe(401);
  expect((await request('/api/v1/tasks', 'POST', { title: 'forbidden' }, readToken)).status).toBe(403);
  expect((await request('/api/v1/tasks', 'GET', undefined, readToken)).status).toBe(200);
  expect((await request('/api/tokens', 'GET')).status).toBe(401);
  expect((await request('/api/servers', 'GET')).status).toBe(401);
  expect((await request('/api/v1/tasks', 'GET', undefined, token, { Origin: 'https://foreign.invalid' })).status).toBe(403);
  const created = await createToken(cookie, 'read');
  const metadata = await request('/api/tokens', 'GET', undefined, '', { Cookie: cookie }).then(response => response.text());
  expect(metadata).not.toContain('token_hash'); expect(metadata).not.toContain(created.token);
  expect((await request(`/api/tokens/${created.data.id}`, 'DELETE', undefined, '', { Cookie: otherCookie })).status).toBe(404);
  expect((await request(`/api/tokens/${created.data.id}`, 'DELETE', undefined, '', { Cookie: cookie })).status).toBe(200);
  expect((await request('/api/v1/tasks', 'GET', undefined, created.token)).status).toBe(401);
  expect(readFileSync(join(dir, 'cortex.db')).includes(Buffer.from(created.token))).toBe(false);
});
it('creates project trees, filters descendants, rejects cycles/unknown fields and restores soft-deleted subtrees', async () => {
  const project = await value('/api/v1/projects', 'POST', { title: 'API project' });
  expect(project).toMatchObject({ parentId: null, kind: 'node', project: true });
  const task = await value('/api/v1/tasks', 'POST', { title: 'Parent', parentId: project.id, priority: 'P1' });
  const childTask = await value('/api/v1/tasks', 'POST', { title: 'Child', parentId: task.id });
  expect(await value(`/api/v1/tasks?projectId=${project.id}`)).toHaveLength(2);
  expect((await request(`/api/v1/tasks/${task.id}`, 'PATCH', { parentId: childTask.id })).status).toBe(400);
  expect((await request(`/api/v1/projects/${project.id}`, 'PATCH', { parentId: childTask.id })).status).toBe(400);
  expect((await request('/api/v1/tasks', 'POST', { title: 'bad', ownerId: 'foreign' })).status).toBe(400);
  expect((await request('/api/v1/tasks', 'POST', { title: 'bad', startAt: 200, dueAt: 100 })).status).toBe(400);
  expect(await value('/api/v1/tasks?q=bad')).toHaveLength(0);
  expect((await request(`/api/v1/tasks/${task.id}`, 'PATCH', { notes: 'leaked' }, otherToken)).status).toBe(404);
  expect((await request('/api/v1/tasks', 'POST', { title: 'bad parent', parentId: project.id }, otherToken)).status).toBe(404);
  expect((await request(`/api/v1/tasks?projectId=${project.id}`, 'GET', undefined, otherToken)).status).toBe(404);
  await value(`/api/v1/tasks/${task.id}`, 'PATCH', { status: 'done', notes: 'completed by Agent' });
  expect(await value(`/api/v1/tasks/${task.id}`)).toMatchObject({ status: 'done', completedAt: expect.any(Number) });
  await value(`/api/v1/projects/${project.id}`, 'DELETE');
  expect((await request(`/api/v1/tasks/${childTask.id}`)).status).toBe(404);
  expect(await value(`/api/v1/tasks/${childTask.id}?includeDeleted=true`)).toMatchObject({ deletedAt: expect.any(Number) });
  await value(`/api/v1/projects/${project.id}/restore`, 'POST');
  expect(await value(`/api/v1/tasks/${childTask.id}`)).toMatchObject({ deletedAt: null });
});
it('prevents repeated creation/check-in via durable idempotency and detects stale conditional writes', async () => {
  const headers = { 'Idempotency-Key': 'create-once' };
  const first = await request('/api/v1/habits', 'POST', { name: 'twice', targetPerDay: 2, reminderTimes: ['20:00', '08:00'] }, token, headers);
  const habit = (await first.json() as { data: any }).data;
  const second = await request('/api/v1/habits', 'POST', { name: 'twice', targetPerDay: 2, reminderTimes: ['20:00', '08:00'] }, token, headers);
  expect(second.headers.get('Idempotency-Replayed')).toBe('true'); expect((await second.json() as { data: any }).data.id).toBe(habit.id);
  expect((await request('/api/v1/habits', 'POST', { name: 'different' }, token, headers)).status).toBe(409);
  const check = () => request(`/api/v1/habits/${habit.id}/check-ins`, 'POST', { date: '2026-11-04', delta: 1 }, token, { 'Idempotency-Key': 'check-once' });
  expect((await (await check()).json() as { data: any }).data.count).toBe(1);
  expect((await (await check()).json() as { data: any }).data.count).toBe(1);
  expect(await value(`/api/v1/habits/${habit.id}/check-ins?date=2026-11-04`)).toMatchObject([{ count: 1 }]);
  expect((await request(`/api/v1/habits/${habit.id}/check-ins`, 'POST', { date: '2026-02-30' })).status).toBe(400);
  const before = await request(`/api/v1/habits/${habit.id}`), version = before.headers.get('etag')!;
  await value(`/api/v1/habits/${habit.id}`, 'PATCH', { name: 'updated remotely' });
  expect((await request(`/api/v1/habits/${habit.id}`, 'PATCH', { name: 'stale' }, token, { 'If-Match': version })).status).toBe(412);
  expect(await value(`/api/v1/habits/${habit.id}`)).toMatchObject({ name: 'updated remotely', reminderTimes: ['08:00', '20:00'] });
  await value(`/api/v1/habits/${habit.id}`, 'DELETE'); await value(`/api/v1/habits/${habit.id}/restore`, 'POST');
  expect(await value(`/api/v1/habits/${habit.id}/check-ins?date=2026-11-04`)).toMatchObject([{ count: 1 }]);
});
it('shares live Yjs state bidirectionally without overwriting unrelated online edits', async () => {
  const task = await value('/api/v1/tasks', 'POST', { title: 'Before', status: 'todo' });
  const online = await device('tasks');
  await expect.poll(() => (online.doc.getMap('items').get(task.id) as Y.Map<unknown> | undefined)?.get('title')).toBe('Before');
  const item = online.doc.getMap('items').get(task.id) as Y.Map<unknown>;
  item.set('notes', 'not flushed to DB yet');
  await expect.poll(() => value(`/api/v1/tasks/${task.id}`).then(value => value.notes)).toBe('not flushed to DB yet');
  await value(`/api/v1/tasks/${task.id}`, 'PATCH', { title: 'Agent changed title' });
  await expect.poll(() => item.get('title')).toBe('Agent changed title');
  expect(item.get('notes')).toBe('not flushed to DB yet');
  item.set('notes', 'second browser edit');
  await expect.poll(() => value(`/api/v1/tasks/${task.id}`).then(value => value.notes)).toBe('second browser edit');
  expect((await request(`/api/v1/tasks/${task.id}`, 'GET', undefined, otherToken)).status).toBe(404);
});
it('creates, edits, completes and deletes reviews with live root sync and explicit timezone validation', async () => {
  const online = await device('root');
  const id = 'daily_2026-10-01';
  await value(`/api/v1/reviews/${id}`, 'PUT', { highlights: '计划：推进 API', friction: '依赖不清', resolution: '先定义接口', nextSteps: '补齐测试' });
  await expect.poll(() => online.doc.getMap('reviewFields').get(`${id}/resolution`)).toBe('先定义接口');
  expect((await request(`/api/v1/reviews/${id}`, 'GET', undefined, otherToken)).status).toBe(404);
  expect((await request('/api/v1/reviews/daily_2026-02-30', 'PUT', {})).status).toBe(400);
  expect((await request(`/api/v1/reviews/${id}/complete`, 'POST', {})).status).toBe(400);
  const complete = await value(`/api/v1/reviews/${id}/complete`, 'POST', { timeZone: 'Asia/Shanghai' });
  expect(complete.completedAt).toBeGreaterThan(0); expect(complete.facts).toMatchObject({ completed: [], pending: [], focusMin: 0 });
  await value(`/api/v1/reviews/${id}`, 'PATCH', { nextSteps: '继续实现' });
  expect(await value(`/api/v1/reviews/${id}`)).toMatchObject({ completedAt: null, highlights: '计划：推进 API', resolution: '先定义接口' });
  await value(`/api/v1/reviews/${id}`, 'DELETE');
  expect((await request(`/api/v1/reviews/${id}`)).status).toBe(404);
  await expect.poll(() => online.doc.getMap('reviewFields').has(`${id}/kind`)).toBe(false);
});
it('publishes self-contained Swagger/OpenAPI with resolvable schemas and correct authentication', async () => {
  const response = await request('/api/openapi.json', 'GET', undefined, ''); expect(response.status).toBe(200);
  const spec = await response.json() as any; expect(spec.openapi).toBe('3.0.3'); expect(Object.keys(spec.paths)).toHaveLength(13);
  expect(spec.paths['/api/v1/habits/{id}/check-ins'].post).toBeTruthy();
  expect(spec.security).toEqual([{ bearerAuth: [] }]);
  const walk = (value: any) => { if (!value || typeof value !== 'object') return; if (value.$ref) { let target = spec; for (const part of value.$ref.slice(2).split('/')) target = target?.[part]; expect(target).toBeTruthy(); } for (const item of Object.values(value)) walk(item); }; walk(spec);
  const html = await request('/api/docs', 'GET', undefined, '').then(response => response.text());
  expect(html).toContain('/api/docs/swagger-ui-bundle.js'); expect(html).toContain('persistAuthorization:false'); expect(html).not.toContain('unpkg');
  expect((await request('/api/v1/not-a-resource')).status).toBe(404);
});
it('persists API writes and idempotency before responding, across immediate server restart', async () => {
  const key = { 'Idempotency-Key': 'survive-restart' };
  const response = await request('/api/v1/tasks', 'POST', { title: 'durable before reply' }, token, key);
  expect(response.status, await response.clone().text()).toBe(201);
  const task = (await response.json() as any).data;
  for (const ws of sockets) ws.terminate();
  // Abrupt exit: bypass the normal five-second sync flush and shutdown handler.
  child.kill('SIGKILL'); await new Promise(resolve => child.once('exit', resolve)); await start();
  expect(await value(`/api/v1/tasks/${task.id}`)).toMatchObject({ title: 'durable before reply' });
  const retry = await request('/api/v1/tasks', 'POST', { title: 'durable before reply' }, token, key);
  expect(retry.headers.get('Idempotency-Replayed')).toBe('true'); expect((await retry.json() as any).data.id).toBe(task.id);
});
