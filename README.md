# Cortex

本地优先的任务、日程、专注与习惯管理工具。Web/PWA 使用 IndexedDB 保存数据,登录后通过 Yjs 同步。部署目标包含公网 HTTPS,账户数据与 SSH 连接凭据分别隔离。

设计见 [DESIGN.md](DESIGN.md),部署与备份见 [RUNBOOK](docs/RUNBOOK.md),修复与验证记录见 [DEVLOG](docs/DEVLOG.md)。

## 开发

需要 Node.js ≥22.13 和 pnpm 10.12.1。

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm dev:server   # :30090
corepack pnpm dev          # :5173,代理 /api
```

## 部署

公网部署在 HTTPS 反向代理后,设置实际的浏览器访问来源。代理需支持 WebSocket。

```bash
PUBLIC_ORIGIN=https://cortex.example.com docker compose up -d --build
```

首次注册产生管理员,后续注册需要邀请码。应在公开服务前完成首账号初始化。仅本机或内网 HTTP 调试时显式使用 `COOKIE_SECURE=false`;公网保持默认 `true`。首次离线使用前需在线加载生产构建并完成 Service Worker 安装。

## 验证

```bash
corepack pnpm typecheck
corepack pnpm test         # 包含临时数据库上的真实 HTTP/WS 测试
corepack pnpm build        # Web + server,不要求原生工具链
corepack pnpm --filter @cortex/e2e exec playwright install chromium
corepack pnpm e2e --project=chromium
```

E2E 自动启动独立服务并清理临时数据,不会读取部署的 `data/`。浏览器依赖可由 CI 或容器提供。Mac/iOS 原生构建需另行验证。

## 目录与边界

| 目录 | 职责 |
|---|---|
| `packages/core` | 领域模型、任务森林、时间与习惯计算、备份校验 |
| `packages/crdt` | 七个 Y.Doc、合并与撤销、账号数据库、同步客户端 |
| `packages/ui` / `platform` | 界面组件与浏览器能力适配 |
| `apps/web` | React Web/PWA、账号与计时器生命周期 |
| `apps/server` | Hono HTTP、账号与邀请码、SQLite、WS 中继、SSH/tmux 桥 |
| `apps/desktop` / `mobile` | Tauri/Capacitor 壳;默认使用本地构建 |
| `e2e` | Playwright Chromium/WebKit 测试 |

SSH 只读取 `DATA_DIR/ssh/<账号 UUID>/` 的账户独立密钥,禁用宿主 SSH 配置、默认密钥和 agent。密码由服务端加密保存,新凭据不进入任务同步。JSON v2 备份保留 Yjs 因果历史;旧 JSON 仅补充缺失实体,不会回滚现有修改。
