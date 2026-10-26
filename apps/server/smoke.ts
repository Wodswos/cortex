/**
 * 全栈冒烟(手动/CI 用):
 *   注册 → ticket → WS 同步写入 → 服务端导出快照可还原
 * 前置:server 已起(默认 http://localhost:39900)。跑法:
 *   corepack pnpm --filter @cortex/server exec tsx smoke.ts
 */
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { CortexStore, SyncClient } from '@cortex/crdt';

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:39900';
const WS_URL = BASE.replace(/^http/, 'ws') + '/api/sync';
let cookie = '';

async function j(path: string, init?: RequestInit) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...(init?.headers ?? {}) },
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0]!;
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  // 0. 静态 + 健康
  const html = await fetch(BASE + '/').then((r) => r.text());
  assert.ok(html.includes('<div id="root">'), 'SPA 首页异常');
  assert.equal((await j('/healthz')).body.ok, true);
  console.log(html.includes('<div id="root">') ? '✓ SPA 首页' : '✗ SPA 首页异常');
  console.log((await j('/healthz')).body.ok ? '✓ healthz' : '✗ healthz');

  // 1. 首用户注册
  const name = `smoke_${Date.now() % 1e6}`;
  const reg = await j('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: name, password: 'smoke123' }) });
  console.log(reg.status === 200 ? `✓ 注册首用户 ${name}(admin=${reg.body.isAdmin})` : `✗ 注册: ${JSON.stringify(reg)}`);

  assert.equal(reg.status, 200, '注册失败');

  // 2. ticket
  const { body: ticketBody } = await j(`/api/auth/ticket?userId=${encodeURIComponent(reg.body.id)}`);
  const ticket = (ticketBody as { ticket?: string }).ticket;
  assert.ok(ticket, 'ticket 签发失败');
  console.log(ticket ? '✓ ticket 签发' : '✗ ticket 失败');

  // 3. WS 同步写入
  const store = new CortexStore('smoke-local');
  const client = new SyncClient(
    async () => {
      const r = await j(`/api/auth/ticket?userId=${encodeURIComponent(reg.body.id)}`);
      return (r.body as { ticket?: string }).ticket ?? null;
    },
    WS_URL,
  );
  for (const id of ['root', 'tasks', 'events', 'links', 'sessions', 'habits', 'habitLogs'] as const) {
    client.register(id, store.docs[id]);
  }
  client.start();
  await new Promise((r) => setTimeout(r, 800));
  const status = client.status;
  assert.equal(status, 'online', 'WS 未连接');
  console.log(status === 'online' ? '✓ WS 在线' : `✗ WS 状态 ${status}`);

  store.createTask({ title: '冒烟任务 smoke', status: 'todo' });
  await new Promise((r) => setTimeout(r, 1200)); // 等快照落盘(flush 周期 5s,这里等广播+读内存房间)
  client.destroy();

  // 4. 服务端导出能还原出任务
  const exp = await j('/api/export');
  const docs = (exp.body as { docs: Record<string, string> }).docs;
  const doc = new Y.Doc();
  const bin = Buffer.from(docs.tasks ?? '', 'base64');
  if (bin.length > 0) Y.applyUpdate(doc, bin);
  const items = doc.getMap('items');
  const titles = [...items.values()].map((m) => (m as Y.Map<unknown>).get('title'));
  assert.ok(titles.includes('冒烟任务 smoke'), '快照缺失同步写入的任务');
  console.log(titles.includes('冒烟任务 smoke') ? '✓ 服务端快照含同步写入的任务' : `✗ 快照缺失: ${titles}`);
}

main().catch((e) => {
  console.error('冒烟失败:', e);
  process.exit(1);
});
