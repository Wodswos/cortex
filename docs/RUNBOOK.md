# 部署与构建手册

## 服务与公网

Node.js ≥22.13;推荐 Docker Compose。单进程提供静态 Web、HTTP API 和两条 WebSocket 通道。

```bash
PUBLIC_ORIGIN=https://cortex.example.com docker compose up -d --build
curl http://127.0.0.1:30090/healthz
```

`PUBLIC_ORIGIN` 必须是浏览器实际使用的来源(协议、域名和可选端口)。HTTPS 反向代理需要透传 `/api/sync`、`/api/tmux/attach` 的 WebSocket Upgrade。保留同源访问,无需开放 CORS。Tailscale Serve/Cloudflare Tunnel 也需把此来源设置为其实际 HTTPS 地址;仅给 Node 的 HTTP 端口加 HTTPS URL 不会自动提供 TLS。

`COOKIE_SECURE` 在 Compose 中默认 `true`。本机/受信内网 HTTP 调试可用:

```bash
COOKIE_SECURE=false docker compose up -d --build
```

公网部署保留 Secure cookie,通过 HTTPS 访问。首次注册即管理员,随后注册需管理员在设置页生成邀请码;请先在受控环境创建管理员再开放公网。登录/注册限制每个连接来源 IP 每分钟 20 次,最多 4 个并行密码派生;反向代理后的用户共用该预算,服务端不信任任意 X-Forwarded-For。

数据在 `./data`,升级重建容器不删除数据。`docker logs -f cortex` 查看日志。首次生产页面会预缓存路由 JS/CSS;Service Worker 安装完成后才有离线能力。HTTP 内网 IP 通常不是安全上下文,请使用 HTTPS 或 localhost 测试 PWA。

## 账号与 SSH/tmux

HTTP 操作和终端连接都验证账号,使用当前账号拥有的 `serverId`。管理员身份不会授予其他账号的连接权限。设置页保存 SSH 密码到服务端 vault(AES-256-GCM),客户端仅同步名称、主机与密码是否设置。

密钥连接由部署者将密钥放入以下数据卷目录,目录权限建议 0700、私钥 0600:

```text
data/ssh/<账号 UUID>/id_ed25519
# 或 id_rsa;同目录 known_hosts 保存该账号信任的主机
```

不再挂载宿主机 `~/.ssh`,禁用全局 SSH 配置、默认密钥和 agent。目标格式为 `user@host[:port]`,IPv6 写作 `user@[::1]:22`。两个 Cortex 账号若使用同一远端 UNIX 账号和凭据,远端权限仍相同;需要远端会话隔离时应配置不同的 UNIX 账号/凭据。Cortex 无法隔离远端机器本身授予的权限。

旧客户端档案在账户首次在线时迁入 vault 并移除同步中的明文密码。旧快照、历史客户端及旧备份可能仍包含明文凭据,应更换曾保存的密码并按敏感文件保管旧备份。被删的服务端档案不会由现代客户端自动重建;历史链接可在设置中重新配置。

## 备份和恢复

| 方式 | 覆盖范围与恢复方法 |
|---|---|
| 设置页导出 JSON v2 | 含全部实体、设置与 base64 Yjs 文档,保留因果合并;在设置页导入 |
| 已登录请求 `/api/export` | 服务端实时房间快照,包含尚未周期落盘的变更;设置页可导入此格式 |
| 停服务后备份整个 `data/` | 账号、会话、CRDT、SSH 档案、vault 主密钥及每用户 SSH 密钥 |

`credentials.key` 是 SSH 密码解密所需主密钥,必须和 SQLite 一起备份。任务 JSON 和服务器 `/api/export` **不包含新 SSH 密码/私钥**,单独使用它们不能恢复 SSH 凭据。新环境从 JSON 恢复后需重新配置连接。

```bash
docker compose stop
# 将 data/ 整体备份至受控位置,保留文件权限
tar czf cortex-data.tgz data/
docker compose start
```

文件恢复应先停服务再整体恢复数据卷。旧版纯 JSON 不含因果历史,只补充缺失 ID 和设置,已有实体(包括软删除)不被覆盖。v2 按 Yjs 规则合并,可保留历史之后的编辑。导入先校验全部输入,失败不会只导入前半部分。服务器每 5 秒落盘;断电可能丢失尚未落盘的服务端变更,客户端再次连线时会补齐。不能把同步当成独立备份。

账号数据库保存在浏览器的对应命名空间。登录时匿名数据仅迁移一次,目标持久化成功后才清理源数据。离线启动读取上次账号的本地数据,登出/切换账号停止旧同步和计时器。共享设备上的本地数据仍受浏览器配置文件权限控制,不提供设备端加密。

## 开发与自动验证

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm dev:server
corepack pnpm dev

corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm --filter @cortex/e2e exec playwright install chromium webkit
corepack pnpm e2e
```

`pnpm test` 包含真实本地 HTTP/WS 测试,使用临时 SQLite 和模拟 SSH 可执行文件,不会访问真实 SSH 主机。E2E 固定使用独立的临时服务,默认端口 39901,可通过 `E2E_PORT` 更改,不会复用已启动实例。Chromium 可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 使用已有 headless shell。不要为测试清理部署的数据卷。

仓库中的旧 `repro-*`、`shot-*`、`e2e/flows.mjs` 等为历史手工诊断脚本,部分假定旧协议或指定测试账号,不属于回归入口;运行前检查脚本目标,仅用于独立测试实例。

## macOS 桌面壳

在装有 Xcode Command Line Tools、Rust 与 Tauri 依赖的 Mac 上:

```bash
corepack pnpm --filter @cortex/desktop dev
corepack pnpm build:desktop
```

本地资源路径 `../../web/dist` 相对于 `src-tauri`,图标已随仓库提供。⌥Space 聚焦窗口并触发快速收集。需要连接部署时,在 Tauri 窗口配置中设置对应 HTTPS URL;默认打包版本使用本地数据。当前 Linux 环境未编译 macOS 目标,不能视为已验证可发布包。

## iPhone Capacitor 壳

默认打包本地 Web 和本地数据库,使用 `apps/web/.env.mobile` 中的
`VITE_CORTEX_API_ORIGIN` 连接账号服务器。目前对应现有部署
`http://115.190.3.4:30090`。Web 构建仍保持同源请求,不会使用移动端专用地址。

```bash
corepack pnpm --filter @cortex/mobile sync
# 更换原生 App 后端时,构建与 iOS 配置使用同一个环境变量:
VITE_CORTEX_API_ORIGIN=https://cortex.example.com corepack pnpm --filter @cortex/mobile sync
corepack pnpm --filter @cortex/mobile open:ios
```

原生 HTTP 通过 CapacitorHttp 使用系统 Cookie 存储,不把会话令牌写入
localStorage。同步和终端 WebSocket 使用同一个服务器地址,仍需有效的一次性
会话票据。服务端仅为这些带票据的 WebSocket 接受 `capacitor://localhost`
来源;HTTP 来源校验和 Cookie 配置不变。

`sync` 会为显式配置的 HTTP 主机添加单独的 ATS 例外,不会关闭整个 App 的
传输安全校验。IP 地址例外需要 iOS 17 或更新版本。原生工程已存在时会保留
Team、Bundle Identifier 和其他 Info.plist 配置。原生工程本身被 gitignore
排除,因此修改服务器后应再次运行完整的 `sync`。

安全区统一由网页根容器处理。WKWebView 使用 `contentInset: never`、
`scrollEnabled: false`;Keyboard 插件按 `native` 模式调整视图高度。页面内部
列表和登录表单负责滚动,不要给外层页面再加一层安全区或键盘高度补偿。

需要加载整个远程网页而非本地资源时,可选择已有的 HTTPS 远程模式:

```bash
CORTEX_MOBILE_URL=https://cortex.example.com corepack pnpm --filter @cortex/mobile sync
# 首次需要生成平台工程:
cd apps/mobile
corepack pnpm exec cap add ios
corepack pnpm exec cap open ios
```

在 Xcode 设置 Team 与唯一 Bundle Identifier,连 iPhone 运行。免费 Personal Team 签名通常 7 天失效。模拟器构建和未签名的真机归档不代表已经能安装到手机;真机安装还需要签名。原生分享入口、后台执行和平台通知仍需接线与设备验证,不列为已完成能力。

## 日报与周报

「复盘」提供日报、周报和历史记录。草稿随账号同步并包含在 JSON 备份中;
点击「完成复盘」后保存任务与专注汇总快照,继续编辑会恢复为草稿。
默认提醒为设备本地时间每天 21:30、每周日 20:00,可在复盘页面调整或关闭。
提醒在应用打开时检查,未完成的最近一期会在下次打开时提示,可推迟一小时;
不提供网页关闭后的后台定时推送。工作汇总基于当前任务状态与已记录的专注会话,
不是任务状态的历史回放;跨日专注按会话实际时间比例分配。

## 故障排查

| 症状 | 检查 |
|---|---|
| HTTP 登录后仍未登录 | HTTP 调试是否显式设置 `COOKIE_SECURE=false` |
| API/WS 403 | `PUBLIC_ORIGIN` 是否等于浏览器来源,代理是否保留 Upgrade |
| API 409 | 页面身份和 Cookie 已变化;重新载入,确认当前账号 |
| 429 | 登录或终端预算已用尽,等待窗口恢复;检查是否共用代理 IP |
| SSH 无法登录 | 当前账号密钥目录、主机/端口、远端账号权限、密码与 known_hosts |
| 离线启动失败 | 是否曾在线完成生产 SW 安装,是否清过浏览器存储 |
| 登录后数据不同 | 检查账号;匿名迁移不会重复复制到后续账号,可从备份恢复 |
| 忘记密码 | 保留完整数据卷和浏览器数据库,先备份;当前没有自助重置接口,勿删除数据重建 |
