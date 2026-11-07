import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Hono, Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { addDays, buildChildrenMap, canReparent, dateFromDayKey, dayKeyOf, descendantsOf, isProject, logCountOn, MIND_APPEARANCE_FIELDS, periodOfReview, validDayKey, validateCortexData, validateHabitConfig, type Habit, type ReviewPeriod, type Task } from '../../../packages/core/src/index';
import type { CortexStore } from '../../../packages/crdt/src/store';
import type { DB, ApiTokenRow } from './db';
import type { setupSync } from './sync';
import { RateLimit } from './security';
import { openapi } from './restSchema';
import { reviewDayStart } from './reviewZone';

type Sync = ReturnType<typeof setupSync>;
type Result = { body: unknown; status: ContentfulStatusCode; etag?: string };
class RestError extends Error { constructor(public status: ContentfulStatusCode, message: string) { super(message); } }
function fail(message: string, status: ContentfulStatusCode = 400): never { throw new RestError(status, message); }
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const etag = (entity: unknown) => `"${digest(JSON.stringify(entity))}"`;
const tokenInfo = (row: ApiTokenRow) => ({ id: row.id, name: row.name, permission: row.permission, createdAt: row.created_at, expiresAt: row.expires_at });
const TASK_FIELDS = ['title', 'notes', 'status', 'kind', 'parentId', 'order', 'priority', 'important', 'urgent', 'tags', 'startAt', 'dueAt', 'estimateMin', ...MIND_APPEARANCE_FIELDS];
const PROJECT_FIELDS = ['title', 'notes', 'status', 'order', ...MIND_APPEARANCE_FIELDS];
const HABIT_FIELDS = ['name', 'icon', 'color', 'cadence', 'targetPerDay', 'reminderTimes', 'reminderAt', 'reminderEnabled'];
const REVIEW_FIELDS = ['highlights', 'friction', 'resolution', 'nextSteps'];

function fields(body: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(body).some(key => !allowed.includes(key))) fail(`不支持的字段；允许：${allowed.join(', ')}`);
  return body;
}
function title(value: unknown, name = '标题', max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${name}需为 1–${max} 个字符`);
}
function period(id: string): ReviewPeriod {
  const match = /^(daily|weekly)_(\d{4}-\d{2}-\d{2})$/.exec(id);
  if (!match || !validDayKey(match[2])) return fail('复盘 ID 需为 daily_YYYY-MM-DD 或 weekly_YYYY-MM-DD');
  return { kind: match[1] as 'daily' | 'weekly', start: match[2]!, end: dayKeyOf(addDays(dateFromDayKey(match[2]!), match[1] === 'daily' ? 1 : 7)) };
}
function checkMatch(c: Context, entity: unknown) {
  const match = c.req.header('If-Match');
  if (match && match !== '*' && match !== etag(entity)) fail('内容已在其他设备更新，请重新读取后重试', 412);
}
function taskById(store: CortexStore, id: string, project: boolean, includeDeleted = false) {
  const task = store.getData().tasks.find(value => value.id === id && (includeDeleted || !value.deletedAt) && isProject(value) === project);
  return task ?? fail('未找到该项目或任务', 404);
}
function habitById(store: CortexStore, id: string, includeDeleted = false) {
  return store.getData().habits.find(value => value.id === id && (includeDeleted || !value.deletedAt)) ?? fail('未找到该习惯', 404);
}
function validateTask(store: CortexStore, value: Task) {
  title(value.title);
  if (value.notes !== undefined && (typeof value.notes !== 'string' || value.notes.length > 100000)) fail('备注需为字符串，最多 100000 字符');
  validateCortexData({ tasks: [Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))] });
  if (value.startAt != null && value.dueAt != null && value.dueAt < value.startAt) fail('截止时间不能早于开始时间');
  if (value.tags.length > 100 || value.tags.some(id => !/^[A-Za-z0-9_-]{1,128}$/.test(id))) fail('标签需为有效 ID，最多 100 个');
  if (value.parentId != null) {
    const parent = store.getData().tasks.find(task => task.id === value.parentId && !task.deletedAt && task.status !== 'archived');
    if (!parent) fail('父节点不存在', 404);
    if (!canReparent(value.id, value.parentId, buildChildrenMap(store.getData().tasks))) fail('任务层级不能形成循环');
  }
}
function list(c: Context, items: { id: string }[]) {
  const number = (name: string, fallback: number, max: number) => {
    const raw = c.req.query(name);
    if (raw === undefined) return fallback;
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > max) fail(`${name} 超出有效范围`);
    return Number(raw);
  };
  const offset = number('offset', 0, Number.MAX_SAFE_INTEGER), limit = number('limit', 100, 500);
  if (limit < 1) fail('limit 需为 1–500');
  return { data: items.slice(offset, offset + limit), total: items.length, offset, limit };
}
function boolQuery(c: Context, name: string) {
  const value = c.req.query(name);
  if (value !== undefined && !['true', 'false'].includes(value)) fail(`${name} 需为 true 或 false`);
  return value === 'true';
}
async function bodyOf(c: Context): Promise<Record<string, unknown>> {
  const raw = await c.req.text();
  if (!raw) return {};
  if (!c.req.header('Content-Type')?.toLowerCase().startsWith('application/json')) fail('Content-Type 需为 application/json', 415);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return fail('JSON 格式无效'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('请求体需为 JSON 对象');
  return body as Record<string, unknown>;
}

export function setupRestApi(app: Hono, db: DB, getSync: () => Sync, currentUser: (c: Context) => string | null, here: string) {
  const send = (c: Context, result: Result) => { if (result.etag) c.header('ETag', result.etag); return c.json(result.body as object, result.status); };
  const guarded = (handler: (c: Context) => Promise<Response> | Response) => async (c: Context) => {
    try { return await handler(c); }
    catch (error) {
      if (error instanceof RestError) return c.json({ error: error.message }, error.status);
      console.error('REST API request failed', error instanceof Error ? error.message : 'unknown');
      return c.json({ error: '请求处理失败，请稍后重试' }, 500);
    }
  };
  app.get('/api/tokens', guarded(c => {
    const userId = currentUser(c); if (!userId) fail('请先登录', 401);
    return c.json({ data: db.listApiTokens(userId).map(tokenInfo) });
  }));
  app.post('/api/tokens', guarded(async c => {
    const userId = currentUser(c); if (!userId) fail('请先登录', 401);
    const body = fields(await bodyOf(c), ['name', 'permission', 'expiresInDays']);
    title(body.name, 'Token 名称', 80);
    if (!['read', 'write'].includes(String(body.permission))) fail('permission 需为 read 或 write');
    const days = body.expiresInDays ?? 90;
    if (!Number.isInteger(days) || Number(days) < 1 || Number(days) > 365) fail('有效期需为 1–365 天');
    if (db.listApiTokens(userId).length >= 50) fail('最多保留 50 个 Token，请先撤销不再使用的 Token', 409);
    const { row, token } = db.createApiToken(userId, String(body.name).trim(), body.permission as 'read' | 'write', Number(days));
    return c.json({ data: tokenInfo(row), token }, 201);
  }));
  app.delete('/api/tokens/:id', guarded(c => {
    const userId = currentUser(c); if (!userId) fail('请先登录', 401);
    if (!db.revokeApiToken(userId, c.req.param('id')!)) fail('未找到该 Token', 404);
    return c.json({ data: { revoked: true } });
  }));

  const readLimit = new RateLimit(240, 60000);
  const identity = (c: Context, write: boolean): ApiTokenRow => {
    const authorization = c.req.header('Authorization') ?? '';
    if (!/^Bearer ctx_[a-f0-9]{64}$/i.test(authorization)) { c.header('WWW-Authenticate', 'Bearer realm="cortex"'); fail('请提供有效的 Bearer Token', 401); }
    const token = db.findApiToken(authorization.slice(7));
    if (!token || !db.getUser(token.user_id)) { c.header('WWW-Authenticate', 'Bearer realm="cortex"'); fail('Token 无效、已撤销或已过期', 401); }
    if (c.req.header('X-Cortex-User') && c.req.header('X-Cortex-User') !== token.user_id) fail('账号不匹配', 409);
    if (write && token.permission !== 'write') fail('该 Token 只有读取权限', 403);
    if (!readLimit.allow(token.user_id)) { c.header('Retry-After', '60'); fail('请求过于频繁，每个账号每分钟最多 240 次', 429); }
    return token;
  };
  const route = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, operation: (c: Context, store: CortexStore, body: Record<string, unknown>) => unknown, status: ContentfulStatusCode = 200) => {
    app[method](`/api/v1${path}`, guarded(async c => {
      const write = method !== 'get';
      const token = identity(c, write);
      const body = write ? await bodyOf(c) : {};
      const key = write ? c.req.header('Idempotency-Key') : undefined;
      if (key !== undefined && !/^[A-Za-z0-9_.:-]{1,128}$/.test(key)) fail('Idempotency-Key 需为 1–128 位字母、数字或 _ . : -');
      const fingerprint = digest(`${method}:${c.req.path}:${JSON.stringify(body)}`);
      const previous = key ? db.apiRequest(token.user_id, key) : null;
      if (previous) {
        if (previous.fingerprint !== fingerprint) fail('该幂等键已用于不同请求', 409);
        c.header('Idempotency-Replayed', 'true');
        return send(c, JSON.parse(previous.response) as Result);
      }
      let result: Result;
      try {
        result = getSync().withStore(token.user_id, write, store => {
          const value = operation(c, store, body);
          return { body: value, status, ...(value && typeof value === 'object' && 'data' in value && !Array.isArray(value.data) ? { etag: etag(value.data) } : {}) };
        }, value => { if (key) db.rememberApiRequest(token.user_id, key, fingerprint, status, JSON.stringify(value)); });
      } catch (error) {
        if (error instanceof RestError) throw error;
        // Domain validators run on a disposable staged document, so failed
        // writes never leave partially persisted or broadcast changes.
        if (error instanceof Error && /^(数据格式错误|习惯|打卡|每日|提醒|复盘|无效的复盘|写下一点|名称|有效期)/.test(error.message)) fail(error.message);
        throw error;
      }
      return send(c, result);
    }));
  };

  for (const project of [false, true]) {
    const base = project ? '/projects' : '/tasks';
    route('get', base, (c, store) => {
      const deleted = boolQuery(c, 'includeDeleted');
      let tasks = store.getData().tasks.filter(task => isProject(task) === project && (deleted || !task.deletedAt));
      const status = c.req.query('status'), q = c.req.query('q')?.toLowerCase();
      if (status && !['inbox', 'todo', 'doing', 'done', 'archived'].includes(status)) fail('无效的任务状态');
      if (status) tasks = tasks.filter(task => task.status === status);
      if (q) tasks = tasks.filter(task => `${task.title}\n${task.notes ?? ''}`.toLowerCase().includes(q));
      if (!project && c.req.query('projectId')) {
        const root = taskById(store, c.req.query('projectId')!, true, deleted);
        const ids = descendantsOf(root.id, buildChildrenMap(store.getData().tasks));
        tasks = tasks.filter(task => ids.has(task.id));
      }
      return list(c, tasks.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)));
    });
    route('post', base, (_c, store, body) => {
      fields(body, project ? PROJECT_FIELDS : TASK_FIELDS); title(body.title);
      if (project && body.status !== undefined && !['todo', 'archived'].includes(String(body.status))) fail('项目状态需为 todo 或 archived');
      const task = project ? store.createProject(String(body.title)) : store.createTask({ ...body, project: false, status: (body.status ?? (body.parentId ? 'todo' : 'inbox')) as Task['status'] } as Partial<Task>);
      const next = { ...task, ...body } as Task;
      validateTask(store, next);
      if (project) store.updateTask(task.id, body as Partial<Task>);
      return { data: store.getData().tasks.find(value => value.id === task.id)! };
    }, 201);
    route('get', `${base}/:id`, (c, store) => ({ data: taskById(store, c.req.param('id')!, project, boolQuery(c, 'includeDeleted')) }));
    route('patch', `${base}/:id`, (c, store, body) => {
      fields(body, project ? PROJECT_FIELDS : TASK_FIELDS);
      const task = taskById(store, c.req.param('id')!, project); checkMatch(c, task);
      if (project && body.status !== undefined && !['todo', 'archived'].includes(String(body.status))) fail('项目状态需为 todo 或 archived');
      validateTask(store, { ...task, ...body } as Task);
      const { status, ...patch } = body;
      store.updateTask(task.id, patch as Partial<Task>);
      if (status !== undefined) store.setTaskStatus(task.id, status as Task['status']);
      return { data: store.getData().tasks.find(value => value.id === task.id)! };
    });
    route('delete', `${base}/:id`, (c, store, body) => {
      fields(body, []);
      const task = taskById(store, c.req.param('id')!, project); checkMatch(c, task);
      store.softDeleteTask(task.id);
      return { data: { id: task.id, deleted: true } };
    });
    route('post', `${base}/:id/restore`, (c, store, body) => {
      fields(body, []); const task = taskById(store, c.req.param('id')!, project, true); checkMatch(c, task);
      store.restoreTask(task.id); return { data: store.getData().tasks.find(value => value.id === task.id)! };
    });
  }
  route('get', '/habits', (c, store) => {
    const deleted = boolQuery(c, 'includeDeleted');
    return list(c, store.getData().habits.filter(habit => deleted || !habit.deletedAt).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)));
  });
  route('get', '/habits/:id', (c, store) => ({ data: habitById(store, c.req.param('id')!, boolQuery(c, 'includeDeleted')) }));
  const validateHabit = (value: Partial<Habit>) => {
    validateHabitConfig(value);
    if (value.name !== undefined) title(value.name, '习惯名称', 200);
    if (value.color !== undefined && !/^#[a-f\d]{6}$/i.test(value.color)) fail('颜色需为 #RRGGBB');
    if (value.icon !== undefined && (typeof value.icon !== 'string' || value.icon.length > 80)) fail('图标需为有效名称');
    if (value.reminderTimes !== undefined && value.reminderAt !== undefined) fail('请使用 reminderTimes 或 reminderAt 其中一个');
  };
  route('post', '/habits', (_c, store, body) => {
    fields(body, HABIT_FIELDS); title(body.name, '习惯名称', 200); validateHabit(body);
    return { data: store.createHabit(body as Partial<Habit> & { name: string }) };
  }, 201);
  route('patch', '/habits/:id', (c, store, body) => {
    fields(body, HABIT_FIELDS); validateHabit(body);
    const habit = habitById(store, c.req.param('id')!); checkMatch(c, habit); store.updateHabit(habit.id, body);
    return { data: habitById(store, habit.id) };
  });
  route('delete', '/habits/:id', (c, store, body) => {
    fields(body, []); const habit = habitById(store, c.req.param('id')!); checkMatch(c, habit); store.deleteHabit(habit.id);
    return { data: { id: habit.id, deleted: true } };
  });
  route('post', '/habits/:id/restore', (c, store, body) => {
    fields(body, []); const habit = habitById(store, c.req.param('id')!, true); checkMatch(c, habit);
    store.updateHabit(habit.id, { deletedAt: null, archivedAt: null }); return { data: habitById(store, habit.id) };
  });
  route('get', '/habits/:id/check-ins', (c, store) => {
    const habit = habitById(store, c.req.param('id')!, true), date = c.req.query('date');
    if (date !== undefined && !validDayKey(date)) fail('date 需为有效的 YYYY-MM-DD');
    const logs = store.getData().habitLogs.filter(log => log.habitId === habit.id && (!date || log.date === date));
    const dates = [...new Set(date ? [date] : logs.map(log => log.date))].sort().reverse();
    return list(c, dates.map(date => ({ id: date, date, count: logCountOn(logs, habit.id, date), target: habit.targetPerDay ?? 1 })));
  });
  route('post', '/habits/:id/check-ins', (c, store, body) => {
    fields(body, ['date', 'delta']);
    const habit = habitById(store, c.req.param('id')!);
    if (!validDayKey(body.date)) fail('date 需为有效的 YYYY-MM-DD（由调用方明确指定本地日期）');
    const delta = body.delta ?? 1;
    if (!Number.isInteger(delta) || !Number(delta) || Math.abs(Number(delta)) > Math.min(10000, (habit.targetPerDay ?? 1) * 3)) fail('delta 需为非零整数，单次不超过每日目标的三倍或 10000');
    store.logHabit(habit.id, String(body.date), Number(delta), habit.targetPerDay ?? 1);
    return { data: { habitId: habit.id, date: body.date, count: logCountOn(store.getData().habitLogs, habit.id, String(body.date)), target: habit.targetPerDay ?? 1 } };
  });
  route('get', '/reviews', (c, store) => {
    const kind = c.req.query('kind'); if (kind !== undefined && !['daily', 'weekly'].includes(kind)) fail('kind 需为 daily 或 weekly');
    return list(c, store.getData().reviews.filter(review => !kind || review.kind === kind).sort((a, b) => b.periodStart.localeCompare(a.periodStart) || a.id.localeCompare(b.id)));
  });
  route('get', '/reviews/:id', (c, store) => {
    period(c.req.param('id')!);
    return { data: store.getData().reviews.find(review => review.id === c.req.param('id')) ?? fail('未找到该复盘', 404) };
  });
  for (const method of ['put', 'patch'] as const) route(method, '/reviews/:id', (c, store, body) => {
    fields(body, REVIEW_FIELDS);
    const value = period(c.req.param('id')!);
    const existing = store.getData().reviews.find(review => review.id === c.req.param('id'));
    if (!existing && (method === 'patch' || c.req.header('If-Match'))) fail('未找到该复盘', 404);
    if (existing) checkMatch(c, existing);
    for (const [key, value] of Object.entries(body)) if (typeof value !== 'string' || value.length > 100000) fail(`${key} 需为不超过 100000 字符的字符串`);
    return { data: store.updateReview(value, body) };
  });
  route('post', '/reviews/:id/complete', (c, store, body) => {
    fields(body, ['timeZone']); period(c.req.param('id')!);
    const review = store.getData().reviews.find(review => review.id === c.req.param('id')) ?? fail('未找到该复盘', 404);
    if (typeof body.timeZone !== 'string' || !body.timeZone || body.timeZone.length > 100) fail('请明确提供 IANA timeZone，例如 Asia/Shanghai');
    let bounds: { start: number; end: number };
    try { bounds = { start: reviewDayStart(review.periodStart, body.timeZone), end: reviewDayStart(review.periodEnd, body.timeZone) }; }
    catch { return fail('timeZone 无效或该时区不存在指定日期'); }
    checkMatch(c, review); return { data: review.completedAt != null ? review : store.completeReview(periodOfReview(review), bounds) };
  });
  route('delete', '/reviews/:id', (c, store, body) => {
    fields(body, []); period(c.req.param('id')!);
    const review = store.getData().reviews.find(review => review.id === c.req.param('id')) ?? fail('未找到该复盘', 404);
    checkMatch(c, review);
    const values = store.docs.root.getMap('reviewFields');
    store.docs.root.transact(() => { for (const key of [...values.keys()]) if (key.startsWith(`${review.id}/`)) values.delete(key); });
    return { data: { id: review.id, deleted: true } };
  });
  app.all('/api/v1/*', c => c.json({ error: '接口不存在或方法不支持' }, 404));

  app.get('/api/openapi.json', c => c.json(openapi));
  const swaggerDir = existsSync(join(here, 'swagger')) ? join(here, 'swagger') : join(here, '..', 'dist', 'swagger');
  for (const file of ['swagger-ui.css', 'swagger-ui-bundle.js']) app.get(`/api/docs/${file}`, c => {
    const path = join(swaggerDir, file);
    if (!existsSync(path)) return c.text('请先构建 server 文档资源', 503);
    c.header('Content-Type', file.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8');
    return c.body(readFileSync(path));
  });
  for (const path of ['/api/docs', '/api/docs/']) app.get(path, c => c.html(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cortex API · Swagger</title><link rel="stylesheet" href="/api/docs/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="/api/docs/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:'/api/openapi.json',dom_id:'#swagger-ui',deepLinking:true,persistAuthorization:false,validatorUrl:null,tryItOutEnabled:false});</script></body></html>`));
}
