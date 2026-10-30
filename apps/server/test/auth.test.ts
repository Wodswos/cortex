import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

let child: ChildProcess, dir: string, base: string, adminCookie: string;
async function request(path: string, data?: unknown, cookie = '') {
  return fetch(base + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
}
async function invite() {
  const response = await request('/api/invites', {}, adminCookie);
  expect(response.status).toBe(200);
  return (await response.json() as { code: string }).code;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cortex-auth-'));
  const require = createRequire(import.meta.url);
  child = spawn(process.execPath, ['--import', require.resolve('tsx/esm'), fileURLToPath(new URL('../src/index.ts', import.meta.url))], {
    env: { ...process.env, PORT: '0', NODE_ENV: 'test', COOKIE_SECURE: 'false', PUBLIC_ORIGIN: '', DATA_DIR: dir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let diagnostics = '';
  child.stderr!.on('data', (bytes) => { diagnostics += bytes.toString(); });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server startup failed: ${diagnostics}`)), 10000);
    child.stdout!.on('data', (bytes) => {
      const match = /Cortex server on :(\d+)/.exec(bytes.toString());
      if (match) { base = `http://127.0.0.1:${match[1]}`; clearTimeout(timeout); resolve(); }
    });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error(`Server exited: ${diagnostics}`)); });
  });
  const response = await request('/api/auth/register', { username: 'admin', password: 'fixture-password' });
  expect(response.status).toBe(200);
  adminCookie = response.headers.get('set-cookie')!.split(';')[0]!;
}, 15000);

afterAll(async () => {
  if (child?.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('registration and login', () => {
  it('registers and logs in with the reported hyphenated username and password', async () => {
    const credentials = { username: 'zehua-test', password: 'zehua-test' };
    const registered = await request('/api/auth/register', { ...credentials, inviteCode: await invite() });
    expect(registered.status).toBe(200);
    const user = await registered.json() as { id: string };
    expect(user).toMatchObject({ username: credentials.username, isAdmin: false });
    const loggedIn = await request('/api/auth/login', credentials);
    expect(loggedIn.status).toBe(200);
    expect(await loggedIn.json()).toMatchObject({ id: user.id, username: credentials.username });
    const me = await request('/api/auth/me', undefined, loggedIn.headers.get('set-cookie')!.split(';')[0]!);
    expect(await me.json()).toMatchObject({ id: user.id, username: credentials.username });
  });

  it('still requires an invitation for additional accounts with hyphens', async () => {
    const response = await request('/api/auth/register', { username: 'without-invite', password: 'fixture-password' });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: '邀请码无效' });
  });

  it.each(['a', 'a'.repeat(33), 'zehua.test', 'zehua test'])('explains invalid username %s', async (username) => {
    const response = await request('/api/auth/register', { username, password: 'fixture-password' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: '用户名需 2–32 位，仅支持中文、字母、数字、下划线（_）和连字符（-）' });
  });

  it.each(['a'.repeat(5), 'a'.repeat(1025)])('explains invalid password length %#', async (password) => {
    const response = await request('/api/auth/register', { username: 'valid-name', password });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: '密码需 6–1024 位' });
  });

  it.each([
    { username: '测_', password: 'a'.repeat(6) },
    { username: '测_'.repeat(15) + '-2', password: 'a'.repeat(1024) },
  ])('accepts username and password length boundaries %#', async (credentials) => {
    const response = await request('/api/auth/register', { ...credentials, inviteCode: await invite() });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ username: credentials.username });
  });
});
