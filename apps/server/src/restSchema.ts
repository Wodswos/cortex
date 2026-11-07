const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const text = { type: 'string' }, timestamp = { type: 'number', nullable: true, description: 'UTC epoch 毫秒；null 表示未设置' };
const appearance = {
  mindBackground: { type: 'string', nullable: true, description: 'neutral/blue/sage/sand/rose/lavender 或 #RRGGBB' },
  mindTextColor: { type: 'string', nullable: true }, mindFontFamily: { type: 'string', nullable: true },
  mindFontSize: { type: 'integer', minimum: 10, maximum: 32, nullable: true }, mindBold: { type: 'boolean', nullable: true }, mindItalic: { type: 'boolean', nullable: true },
};
const task = {
  title: { type: 'string', minLength: 1, maxLength: 2000 }, notes: { type: 'string', maxLength: 100000 },
  status: { type: 'string', enum: ['inbox', 'todo', 'doing', 'done', 'archived'] }, kind: { type: 'string', enum: ['todo', 'node'], nullable: true },
  parentId: { type: 'string', nullable: true }, order: { type: 'number' }, priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'], nullable: true },
  important: { type: 'boolean' }, urgent: { type: 'boolean' }, tags: { type: 'array', maxItems: 100, items: text },
  startAt: timestamp, dueAt: timestamp, estimateMin: { type: 'number', minimum: 0 }, ...appearance,
};
const project = { title: task.title, notes: task.notes, order: task.order, status: { type: 'string', enum: ['todo', 'archived'] }, ...appearance };
const cadence = { oneOf: [
  { type: 'object', required: ['type'], properties: { type: { type: 'string', enum: ['daily'] } } },
  { type: 'object', required: ['type', 'timesPerWeek'], properties: { type: { type: 'string', enum: ['weekly'] }, timesPerWeek: { type: 'integer', minimum: 1, maximum: 100 }, days: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 7 } } } },
  { type: 'object', required: ['type', 'everyNDays'], properties: { type: { type: 'string', enum: ['interval'] }, everyNDays: { type: 'integer', minimum: 1 } } },
  { type: 'object', required: ['type', 'cron'], properties: { type: { type: 'string', enum: ['custom'] }, cron: text } },
] };
const habit = {
  name: { type: 'string', minLength: 1, maxLength: 200 }, icon: { type: 'string', maxLength: 80 }, color: { type: 'string', pattern: '^#[a-fA-F0-9]{6}$' },
  cadence, targetPerDay: { type: 'integer', minimum: 1, maximum: 10000 }, reminderEnabled: { type: 'boolean' },
  reminderTimes: { type: 'array', uniqueItems: true, maxItems: 24, items: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' }, description: '本地 HH:mm；空数组清除。多时间按比例分配累计目标。' },
  reminderAt: { type: 'string', description: '旧单时间接口，请优先使用 reminderTimes，两个字段不能同时提交' },
};
const review = Object.fromEntries(['highlights', 'friction', 'resolution', 'nextSteps'].map(key => [key, { type: 'string', maxLength: 100000 }]));
const entity = (properties: object) => ({ type: 'object', properties: { id: text, ownerId: text, createdAt: { type: 'number' }, ...properties } });
const input = (properties: object, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) });
const query = (name: string, schema: object, description?: string) => ({ name, in: 'query', schema, description });
const id = { name: 'id', in: 'path', required: true, schema: text };
const includeDeleted = query('includeDeleted', { type: 'boolean', default: false });
const paging = [query('limit', { type: 'integer', minimum: 1, maximum: 500, default: 100 }), query('offset', { type: 'integer', minimum: 0, default: 0 })];
const mutationHeaders = [
  { name: 'Idempotency-Key', in: 'header', description: '可选；同账号 24 小时内相同请求重放原响应；不同请求复用同一键返回 409。新增/打卡重试建议始终提供。', schema: { type: 'string', maxLength: 128 } },
  { name: 'If-Match', in: 'header', description: '可选；使用读取接口返回的 ETag，其他设备修改后返回 412。', schema: text },
];
const errors = Object.fromEntries([400, 401, 403, 404, 409, 412, 413, 415, 429, 500].map(code => [code, { description: ({ 400: '参数或 JSON 无效', 401: 'Token 无效或过期', 403: '只读 Token 不允许写入或来源不受信任', 404: '当前账号中不存在该对象', 409: '幂等键冲突、账号不匹配或 Token 数量上限', 412: 'If-Match 与最新 ETag 不一致', 413: '请求体超过 64 KiB', 415: '需使用 application/json', 429: '请求限流', 500: '服务端错误，写入未提交' } as Record<number, string>)[code], content: { 'application/json': { schema: ref('Error') } } }]));
const paths: Record<string, Record<string, unknown>> = {};
function operation(path: string, method: string, summary: string, tag: string, schema: object, options: { list?: boolean; body?: object; parameters?: object[]; created?: boolean; description?: string; security?: object[] } = {}) {
  const output = options.list ? { type: 'object', properties: { data: { type: 'array', items: schema }, total: { type: 'integer' }, limit: { type: 'integer' }, offset: { type: 'integer' } } } : { type: 'object', properties: { data: schema } };
  (paths[path] ??= {})[method] = {
    summary, tags: [tag], description: options.description,
    operationId: `${method}_${path.replace(/[^a-zA-Z0-9]+/g, '_')}`,
    ...(options.security ? { security: options.security } : {}),
    parameters: [...(path.includes('{id}') ? [id] : []), ...(method === 'get' ? [] : mutationHeaders.filter(header => header.name !== 'If-Match' || path.includes('{id}') && !path.endsWith('/check-ins'))), ...(options.parameters ?? [])],
    ...(options.body ? { requestBody: { required: true, content: { 'application/json': { schema: options.body } } } } : {}),
    responses: { [options.created ? 201 : 200]: { description: '成功', headers: { ETag: { description: '单对象内容版本，可用于 If-Match', schema: text }, 'Idempotency-Replayed': { description: '幂等重放时为 true', schema: text } }, content: { 'application/json': { schema: output } } }, ...errors },
  };
}
for (const [collection, tag, schema, properties] of [['tasks', '任务', 'Task', task], ['projects', '项目', 'Project', project], ['habits', '习惯', 'Habit', habit]] as const) {
  const base = `/api/v1/${collection}`;
  operation(base, 'get', `查询${tag}列表`, tag, ref(schema), { list: true, parameters: [...paging, includeDeleted, ...(collection !== 'habits' ? [query('q', text, '标题与备注搜索'), query('status', task.status), ...(collection === 'tasks' ? [query('projectId', text, '项目 ID，包含所有层级的后代任务')] : [])] : [])] });
  operation(base, 'post', `创建${tag}`, tag, ref(schema), { created: true, body: input(properties, [collection === 'habits' ? 'name' : 'title']), description: collection === 'tasks' ? '未指定状态时：有父节点默认 todo，无父节点默认 inbox。项目请使用 /projects。' : undefined });
  operation(`${base}/{id}`, 'get', `读取${tag}`, tag, ref(schema), { parameters: [includeDeleted] });
  operation(`${base}/{id}`, 'patch', `修改${tag}的指定字段`, tag, ref(schema), { body: input(properties) });
  operation(`${base}/{id}`, 'delete', `软删除${tag}`, tag, ref('Deletion'), { description: collection === 'habits' ? '保留打卡历史，可恢复。' : '连同后代一起移入回收站，可恢复。' });
  operation(`${base}/{id}/restore`, 'post', `恢复${tag}`, tag, ref(schema), { description: '按应用现有恢复规则恢复原对象与必要层级。' });
}
operation('/api/v1/habits/{id}/check-ins', 'get', '查询习惯每日有效打卡数', '习惯', ref('CheckIn'), { list: true, parameters: [...paging, query('date', { type: 'string', format: 'date' }, '省略时按日期倒序返回已有记录')] });
operation('/api/v1/habits/{id}/check-ins', 'post', '增加或撤销打卡', '习惯', ref('CheckIn'), { body: input({ date: { type: 'string', format: 'date' }, delta: { type: 'integer', default: 1, minimum: -10000, maximum: 10000 } }, ['date']), description: 'date 是调用方本地日期，必须明确提供；delta 为非零整数，每次不超过目标三倍或 10000，负数撤销有效次数。返回累计数。请用 Idempotency-Key 避免重复打卡。' });
operation('/api/v1/reviews', 'get', '查询日报与周报', '复盘', ref('Review'), { list: true, parameters: [...paging, query('kind', { type: 'string', enum: ['daily', 'weekly'] })] });
operation('/api/v1/reviews/{id}', 'get', '读取复盘', '复盘', ref('Review'));
for (const method of ['put', 'patch']) operation('/api/v1/reviews/{id}', method, method === 'put' ? '创建或更新复盘草稿' : '修改现有复盘', '复盘', ref('Review'), { body: input(review), description: 'ID 为 daily_YYYY-MM-DD 或 weekly_YYYY-MM-DD（周期首日，结束日不含）。只更新提供的字段。修改正文会恢复为草稿；resolution 为「如何解决」。' });
operation('/api/v1/reviews/{id}/complete', 'post', '完成复盘并保存汇总快照', '复盘', ref('Review'), { body: input({ timeZone: { type: 'string', example: 'Asia/Shanghai', description: '明确指定 IANA 时区，保证任务与专注统计的日期边界与网页一致，包含夏令时处理' } }, ['timeZone']) });
operation('/api/v1/reviews/{id}', 'delete', '删除复盘正文', '复盘', ref('Deletion'), { description: '复盘没有回收站，此操作删除这份复盘的正文与汇总。任务、习惯和历史备份不受影响。' });

export const openapi = {
  openapi: '3.0.3', info: { title: 'Cortex Agent API', version: '1.0.0', description: '在设置 → Agent API 中创建 Bearer Token。只读 Token 仅可 GET；读写 Token 可修改当前账号的任务、项目、习惯与复盘。Token 不授予 SSH/tmux、账号管理或其他账号权限。写入持久化后实时同步到网页。时间戳使用 UTC 毫秒；打卡日期和复盘周期使用明确的 YYYY-MM-DD。每账号 240 请求/分钟，请求体最多 64 KiB。' },
  servers: [{ url: '/' }], security: [{ bearerAuth: [] }], tags: ['任务', '项目', '习惯', '复盘'].map(name => ({ name })), paths,
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'ctx_…' } },
    schemas: {
      Error: { type: 'object', required: ['error'], properties: { error: text } },
      Task: entity({ ...task, project: { type: 'boolean' }, updatedAt: { type: 'number' }, completedAt: timestamp, deletedAt: timestamp }),
      Project: entity({ ...project, kind: { type: 'string', enum: ['node'] }, project: { type: 'boolean', enum: [true] }, parentId: { type: 'string', nullable: true }, updatedAt: { type: 'number' }, deletedAt: timestamp }),
      Habit: entity({ ...habit, archivedAt: timestamp, deletedAt: timestamp }),
      Review: entity({ ...review, kind: { type: 'string', enum: ['daily', 'weekly'] }, periodStart: { type: 'string', format: 'date' }, periodEnd: { type: 'string', format: 'date' }, completedAt: timestamp, updatedAt: { type: 'number' }, facts: { type: 'object', nullable: true, description: '完成复盘时保存的任务与专注汇总快照' } }),
      CheckIn: { type: 'object', properties: { id: text, habitId: text, date: { type: 'string', format: 'date' }, count: { type: 'integer' }, target: { type: 'integer' } } },
      Deletion: { type: 'object', properties: { id: text, deleted: { type: 'boolean' } } },
    },
  },
};
