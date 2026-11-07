# Agent REST API

Swagger：`http://115.190.3.4:30090/api/docs`。机器可读的 OpenAPI 3.0 文档：
`http://115.190.3.4:30090/api/openapi.json`。Swagger 的 JS/CSS 随服务部署，不依赖外部 CDN。

在应用「设置 → Agent API」创建独立 Token，选择只读或读写及有效期。Token 只显示一次，
服务端仅保存 SHA-256 摘要；可随时撤销。每个账号最多 50 个 Token。
Token 只能访问所属账号的下述业务数据，不授予账号管理、备份、SSH 或 tmux 权限。
Token 管理使用现有登录 Cookie：`GET/POST /api/tokens`、`DELETE /api/tokens/:id`；
Agent Token 不能给自己创建新 Token。Token 不包含在任务 JSON 备份中。

```bash
export CORTEX_URL='http://115.190.3.4:30090'
# 从安全存储载入 CORTEX_TOKEN，不要提交到仓库或放进 URL。
curl "$CORTEX_URL/api/v1/projects" -H "Authorization: Bearer $CORTEX_TOKEN"
curl "$CORTEX_URL/api/v1/tasks?status=doing&limit=100" -H "Authorization: Bearer $CORTEX_TOKEN"
curl "$CORTEX_URL/api/v1/tasks" \
  -H "Authorization: Bearer $CORTEX_TOKEN" -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: example-create-task-001' \
  -d '{"title":"整理本周计划","status":"todo","parentId":"PROJECT_ID"}'
```

公网入口目前为 HTTP；需要在不受信网络传送 Token 时，应通过部署者配置的 HTTPS/VPN 访问。

## 接口范围

| 资源 | 接口 |
| --- | --- |
| 任务 | `GET/POST /api/v1/tasks`；`GET/PATCH/DELETE /api/v1/tasks/:id`；`POST /api/v1/tasks/:id/restore` |
| 项目 | `GET/POST /api/v1/projects`；`GET/PATCH/DELETE /api/v1/projects/:id`；`POST /api/v1/projects/:id/restore` |
| 习惯 | `GET/POST /api/v1/habits`；`GET/PATCH/DELETE /api/v1/habits/:id`；`POST /api/v1/habits/:id/restore` |
| 打卡 | `GET/POST /api/v1/habits/:id/check-ins` |
| 日报/周报 | `GET /api/v1/reviews`；`GET/PUT/PATCH/DELETE /api/v1/reviews/:id`；`POST /api/v1/reviews/:id/complete` |

写入返回成功前已持久化到 SQLite，并推送到在线浏览器的同一 Yjs 文档；离线客户端下次同步合并。
读取也使用在线同步房间的最新状态。PATCH 只更新指定字段，不接受 `ownerId`、`id`、
创建时间等服务端字段；未知字段直接返回 400。父任务必须存在于同一账号，禁止形成层级循环。

列表返回 `{data: [...], total, offset, limit}`，默认 100 条，最多 500 条；分页使用 offset。
项目/任务支持 `q`、`status`，任务还支持 `projectId`（项目下全部层级），复盘支持 `kind=daily|weekly`。
任务、项目和习惯默认排除软删除数据，可用 `includeDeleted=true` 查询。单对象返回 `{data: {...}}`。

任务和项目是同一个任务树中的不同身份，项目使用 `/projects`；项目始终是结构性根节点。
创建任务未指定状态时，有父节点默认 todo，否则默认 inbox。更改状态会沿用网页的完成时间规则。
删除任务/项目会连同子树软删除，恢复沿用回收站规则。习惯删除保留打卡记录，可恢复。
**复盘没有回收站，DELETE 会删除该份复盘正文和汇总快照**；任务与独立备份不受影响。

习惯 `reminderTimes` 为不重复的 `HH:mm` 数组，可设置多个时间；空数组清除，兼容旧的
`reminderAt`，两者不能同时提交。打卡请求 `{date: "2026-11-04", delta: 1}`；date 必须
明确提供调用方本地日期，负 delta 撤销次数。每次不超过每日目标三倍或 10000，不直接覆盖累计值。
提醒仍由已打开的应用执行，REST 设置时间不会产生网页关闭后的后台推送。

复盘 ID：`daily_2026-11-04` 或 `weekly_2026-11-02`，日期为周期首日。
PUT 创建或更新草稿，PATCH 只修改现有草稿；正文属性为 highlights、friction、resolution、nextSteps。
修改正文会将已完成复盘恢复成草稿。完成复盘需传 `{timeZone: "Asia/Shanghai"}`，
服务端据此计算汇总的日期边界，支持夏令时；避免使用服务端 UTC 时区误计当天任务。

## 重试、并发与错误

新增、打卡等写入建议提供 `Idempotency-Key`。同账号相同键、路径与请求体在 24 小时内重放原响应，
响应含 `Idempotency-Replayed: true`；不同请求复用同键返回 409。每账号最多保留 1000 个幂等记录。
JSON 属性顺序应保持一致。幂等记录与业务数据在同一数据库事务中提交。

单对象响应含 ETag。修改、删除或恢复时可将其放入 `If-Match`，版本不一致返回 412；
重新读取后再决定如何更新。没有 If-Match 时，指定字段按最后写入及 Yjs 合并规则处理。
Token 撤销/过期后，幂等重放也会被拒绝。

每账号所有 Token 合计每分钟最多 240 次请求；请求体最多 64 KiB。
错误返回 `{error: "说明"}`，状态码见 Swagger；401 为认证失败、403 为只读权限或 Origin 不受信任、
404 为当前账号无此对象、409 为幂等或账号冲突、412 为版本冲突、429 为限流。
跨账号请求返回 404，不透露对象是否属于别人。不得将 API Token 用作同步 WebSocket 的会话票据。
