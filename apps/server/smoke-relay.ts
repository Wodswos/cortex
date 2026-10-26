/**
 * 双设备中继冒烟:同一账号两个客户端(手机+电脑场景)同时在线,
 * A 写 → 服务器广播 → B 收到;B 改 → A 收到(字段级)。
 * 前置:server 已起,且库中无用户(本测试注册首用户)。跑法:
 *   corepack pnpm --filter @cortex/server exec tsx smoke-relay.ts
 */
import { CortexStore, SyncClient } from '@cortex/crdt';

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:39900';
const WS_URL = BASE.replace(/^http/, 'ws') + '/api/sync';
const USER = `relay_${Date.now() % 1e6}`;
const PASS = 'relay12345';

async function connectDevice(): Promise<{ store: CortexStore; client: SyncClient } | null> {
  const store = new CortexStore(USER);
  const client = new SyncClient(async () => {
    const r = await fetch(`${BASE}/api/auth/ticket?userId=${encodeURIComponent(userId)}`, { headers: { cookie } });
    if (!r.ok) return null;
    const body = (await r.json()) as { ticket?: string };
    return body.ticket ?? null;
  }, WS_URL);
  for (const id of ['root', 'tasks', 'events', 'links', 'sessions', 'habits', 'habitLogs'] as const) {
    client.register(id, store.docs[id]);
  }
  client.start();
  await new Promise((r) => setTimeout(r, 700));
  return client.status === 'online' ? { store, client } : null;
}

let cookie = '';
let userId = '';

async function main() {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  const registered = await res.json() as { id?: string };
  userId = registered.id ?? '';
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0]!;
  if (res.status !== 200) {
    console.error(`✗ 注册失败(${res.status},${setCookie ? '' : '无 cookie'};本测试要求空库,先清 DATA_DIR 再起 server)`);
    process.exit(1);
  }
  console.log(`✓ 注册 ${USER}`);

  const A = await connectDevice();
  const B = await connectDevice();
  if (!A || !B) {
    console.error(`✗ 设备连接失败 A=${A ? 'ok' : 'offline'} B=${B ? 'ok' : 'offline'}`);
    process.exit(1);
  }
  console.log('✓ A/B 双设备在线(同一账号)');

  A.store.createTask({ title: '中继任务 relay-test', status: 'todo' });
  const t0 = Date.now();
  let ok = false;
  while (Date.now() - t0 < 5000) {
    if (B.store.getData().tasks.some((t) => t.title === '中继任务 relay-test')) {
      ok = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log(ok ? `✓ A 写 → B 收到(${Date.now() - t0}ms)` : '✗ B 未收到 A 的写入');

  let reverseOk = false;
  if (ok) {
    const id = B.store.getData().tasks.find((t) => t.title === '中继任务 relay-test')!.id;
    B.store.updateTask(id, { title: '中继任务 relay-已改', important: true });
    let ok2 = false;
    const t1 = Date.now();
    while (Date.now() - t1 < 5000) {
      const a = A.store.getData().tasks.find((t) => t.id === id);
      if (a?.title === '中继任务 relay-已改' && a.important) {
        ok2 = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    reverseOk = ok2;
    console.log(ok2 ? '✓ B 改 → A 收到(字段级)' : '✗ A 未收到 B 的修改');
  }

  A.client.stop();
  B.client.stop();
  process.exit(ok && reverseOk ? 0 : 1);
}

main().catch((e) => {
  console.error('中继冒烟失败:', e);
  process.exit(1);
});
