# DEVLOG — 开发日志

> 你审阅的入口:本文记录**每个里程碑做了什么、验证到什么程度、与 DESIGN.md 的偏差、已知问题、事故复盘**。
> 配套阅读:[RUNBOOK.md](RUNBOOK.md)(部署/构建/验证手册)、[../DESIGN.md](../DESIGN.md)(设计)。

## 0. 当前状态(2026-10-26)

v0.3.0 初版修复。目标为公网 HTTPS 部署、不同账号严格隔离。已完成全仓 Review 中的安全、同步、持久化与领域一致性修复;未连接真实 SSH 主机、未部署或推送。下方旧里程碑是历史记录,当前验证以本节和验证矩阵为准。

- HTTP/WS 绑定账号与会话;tmux 必须使用账户拥有的连接档案。移除全局 SSH 配置、密钥和 agent;服务端加密存储新密码。登录限流、异步密码派生、原子注册与邀请码消费、Secure cookie/Origin 校验。
- 同步只在首次加入时握手,处理非法 UTF-8 与负载;固定文档白名单、连接/消息限制、慢客户端保护、心跳与注销撤销。导出直接读取活跃文档,关闭时刷盘。
- 加载账号数据库后再切换 store;旧 ticket 请求及 socket 回调不可跨身份生效。离线恢复上次账户;匿名批次只迁移一次,先持久化目标再消费源。快速收集成功提示等待本地事务完成。
- 并发任务环以确定性投影显示为森林;习惯使用独立打卡操作与去重撤销;跨文档撤销顺序、redo 分支失效、优先级与象限统一。集合引用按 doc 缓存。
- JSON v2 保存因果历史,旧 JSON 仅补缺失数据;恢复标签/设置,导入完整校验且失败不部分写入。修正计时器全局生命周期、刷新恢复、账户隔离、暂停时长与幂等记账。
- 日历按本地日历日处理 DST;跨午夜事件点击不改时间,拖动保留完整区间;ICS 按 UTF-8 字节折行。修正搜索截断、N/原生快速收集、详情面板远端更新及空状态崩溃、P2 与列表键盘操作。
- PWA 安装预缓存所有路由 JS/CSS,API 永不缓存;页面/视图/终端分包。冻结依赖安装、JS 语法检查、临时数据上的自动回归及 CI。修复 Tauri 入口、资源路径和图标;Capacitor 默认本地,远程 URL 通过环境配置。

## ⚡ 事故复盘:公网访问黑屏(2026-08-29)

**症状**:任何环境(不只公网)打开只有一片黑。

**根因 1(黑屏主因)**:导图用了 `elkjs/lib/elk-api.js` 入口——它要求 worker 配置,
`new ELK()` 在模块顶层直接抛 `Cannot construct an ELK without both 'workerUrl' and 'workerFactory'`,
React 挂载即崩 → 黑屏(index.html 的深色 body 底色还在,所以"黑"而非白)。
**修复**:改 `elkjs/lib/elk.bundled.js`(worker 内联,主线程布局)。
**教训**:此前只用 `curl` 验证了首字节,**从未在真实浏览器里打开过页面**——已建立容器化浏览器
验证流程(RUNBOOK §6),所有页面走查和跨端闭环自此纳入标准验证。

**根因 2(顺藤摸出的潜伏 bug)**:CRDT store 的变更通知只挂在 `requestAnimationFrame` 上。
无头浏览器/后台标签页里 **rAF 不触发** → 数据变更永远不通知 UI。真机表现:标签页切后台时
写入的数据要等回到前台才显示。**修复**:`rAF + setTimeout(150ms)` 双通道(flush 幂等,先到先执行)。
发现方式:e2e 采样器(rAF/Mutation 计数)显示 rAF 全程 0 次而页面无死循环。

**过程中排障记录**(非产品 bug,防再次踩坑):
- `chromedp/headless-shell` 镜像自带 socat(9222→9223),**不要**再传 `--remote-debugging-port` 参数,会端口互抢看运气启动。
- Playwright(`connectOverCDP`)对该镜像的 **CDP 通道长会话劣化**:同会话前几步必过、之后 evaluate 类调用随机挂起(Input 注入与 AxTree 断言不受影响)。对策:验证脚本用**短会话模式**(每个断言点新建 context)。
- 无 CJK 字体的容器截图中文显示为方块 —— 测试环境 artifact,真机无此问题。

## 1. 本轮实际验证

| 验证 | 结果 |
|---|---|
| `pnpm install --offline --frozen-lockfile --ignore-scripts` | 通过,依赖与锁文件一致 |
| `pnpm typecheck` | 通过,包含 core/server/web 测试、E2E 与 mobile 配置 |
| `pnpm test` | **124 passed**:core 77、CRDT 28、server 15、web timer 4 |
| 服务端集成(包含在上述 15 项中) | 真实 HTTP/WS、临时数据库、模拟 SSH;账户隔离/密码来源/同步静默/实时导出/非法输入/注销撤销 |
| `pnpm build` | Web + server 构建和独立 JS 语法检查通过 |
| Chromium Playwright | **7 passed**,含首次离线重载及未访问过的 lazy 视图、Cookie 切号、匿名单次迁移、双浏览器远端编辑、日程与搜索 |
| WebKit / macOS / iOS | 本环境未执行;CI 配置包含两个浏览器引擎,原生需 Mac/真机验证 |
| Docker 镜像 | 更新构建与 Compose 配置;本轮未重新构建镜像 |

本地浏览器使用已有 Chromium headless shell,没有给宿主机安装系统库。测试服务器始终使用临时数据库,不会清理部署数据。CI 配置已添加,尚未在远端执行。

## 2. 里程碑明细

### M0 骨架 ✅
pnpm monorepo(apps/web·server·desktop·mobile + packages/core·crdt·ui·platform)。
Tailwind v4 主题:dark-first、四套 accent、glass/glow/渐变工具类、`prefers-reduced-motion`。
布局壳:桌面 rail + 手机底部栏 + FAB + 视图路由(`?view=`)。Docker 多阶段 + compose,30090。

### M1 任务核心 ✅
Yjs 数据层(见 §3 决策)、Task CRUD/状态机/软删子树、无限层级树、
List 视图(分组/树/折叠/拖拽重排+跨层级/键盘 Enter·Tab·⌘D·1-4·T·M·Backspace)、
Inbox 流 + 升级/丢弃、QuickCapture(`#tag !P0 ~45m @明天 @9:30` 解析 + 实时徽标预览 + 连续录入)、
详情抽屉(桌面右滑 488px / 手机底部 sheet)。

### M2 同步与账号 ✅
server:`node:sqlite` + scrypt + session cookie + 一次性 WS ticket + 邀请码(首用户=admin)。
Yjs WS 中继:单连接多路复用(1B 长度帧)、y-protocols 握手、房间广播、5s 快照落盘。
客户端:断线指数退避,重连差量补齐;未登录=本地模式(IndexedDB 全功能),登录自动迁入本地数据。
PWA:manifest + SW + 4 尺寸图标(纯 Node PNG 编码器生成)。

### M3 时间线 ✅
日视图:5 分钟刻度、now-line、时间块拖移/拉伸(5min 吸附)、空白拖划创建、双击=1h、
「今日待排」坞拖任务入轴、选中操作条。周视图 + 月视图完成度热力。手机竖屏适配。

### M4 专注 + 习惯 ✅
番茄:渐变进度环 + 旋转虚线、25/50/90、任务绑定、沉浸模式、分心计数、sessionStorage 断电恢复、
标题栏倒计时、WebAudio 提示音 + 白噪音(雨/棕噪/咖啡,实时合成)。近 7 天统计。
习惯:创建向导(颜色/目标/四种 cadence)、多次打卡、streak(含弹性周)、18 周热力图展开。

### M5 Tauri 壳 ✅(代码级,Mac 构建) — 见 RUNBOOK §4
⌥Space 全局 Quick Capture、通知插件、菜单栏配置。

### M6 四象限 + 导图 ✅
四象限:2×2 拖拽改写 important/urgent、双击空白建任务、口径=未完成且 7 天内/无日期的根任务。
导图:React Flow + elk(layered)布局、双击加子任务、拖到节点上重挂层级(防环)、minimap、根切换。

### M7 Capacitor 壳 ✅(代码级,Mac 构建) — 见 RUNBOOK §5

### M8 链接与增强 ✅
TaskLink(粘贴识别 obsidian/语雀/agent/url)、JSON 导出/导入、`.ics` 导出、Dashboard、
⌘K 命令面板、服务器 `/api/export` 备份端点。

## 3. 实现决策(与 DESIGN.md 的偏差,均已按此实现)

| # | 设计稿 | 实际实现 | 理由 |
|---|---|---|---|
| D-1 | order 用 fractional indexing string | **数值中点 + 局部重排**(`order.ts`) | 可暴力测试;重排只影响单层兄弟 |
| D-2 | 根 doc + Y.Subdocs | **7 个扁平 doc,单 WS 多路复用** | 持久化/中继简化一个量级 |
| D-3 | better-sqlite3 | **node:sqlite** | 零原生依赖,alpine 免编译 |
| D-4 | shadcn CLI 拷贝 | **radix + cva + tailwind-merge 手写同款** | API 与 shadcn 一致,后续可替换 |
| D-5 | nginx 伺服静态 | **Node 单进程伺服 静态+API+WS** | 少一个组件 |
| D-6 | 白噪音本地音频文件 | **WebAudio 实时合成** | 免资产 |
| D-7 | (事故新增)elk worker | **elkjs bundled 入口** | elk-api 需 worker 配置,顶层抛异常(见事故复盘) |

## 4. 安全边界

- 公网要求 HTTPS 和准确的 `PUBLIC_ORIGIN`;Compose 默认 `COOKIE_SECURE=true`。只有 HTTP 调试显式设为 false。
- 每个账号拥有独立的 SQLite/CRDT 命名空间、连接档案与 SSH 密钥路径。远端 UNIX 权限取决于所配置的账号,需独立远端账号时由部署者配置。
- 新 SSH 密码不进入任务备份,`credentials.key` 与数据库必须整体保管。旧快照可能包含旧明文密码,迁移后应轮换这些密码。
- CRDT 未实现端到端加密,服务端部署者可读取任务;本地数据库受浏览器配置文件权限控制。共享设备登出不抹掉对应账号的离线库。

## 5. 已知限制

1. 原生壳仅完成代码和配置修正,尚未在 Mac/iOS 编译与真机验证。原生分享、后台执行与通知仍需平台接线。
2. WebKit 本环境未执行;CI 定义包含 Chromium/WebKit,尚无远端运行结果。
3. 导图空白拖动偏移不持久化,数据变化后重新布局;重挂层级可持久化。
4. 已做路由与终端分包,主入口仍约 624 KB(minified);首次 PWA 安装会下载所有路由资源以支持离线访问。
5. 周视图只读;跨天事件按当日裁切显示,底层时间完整。
6. 习惯关联任务模板字段保留未接 UI,暂无回收站界面和密码自助重置,界面主要为中文。
7. 服务端每五秒落盘,进程/主机突然故障仍有未落盘窗口;在线客户端可重传,独立备份仍必要。

## 6. 环境原则(用户约定)

- **不动宿主机**:缺依赖一律容器化解决(如浏览器验证用 `chromedp/headless-shell` 容器,不动宿主装库)。
- 图标生成、E2E、调试脚本全部仓库内自包含。
- 快照安全网:server 5s 落盘,崩溃丢最近几秒无碍(客户端重连差量补回)。
