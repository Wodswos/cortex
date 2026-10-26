# Cortex — 设计初稿

> 一个 local-first 的个人效能中枢:任务管理 + 专注时钟 + 习惯养成。
> 暂定名 **Cortex**(皮层——大脑负责规划与自控的部分,契合产品气质),可随时改。

- 状态: **Draft v0.2**(2026-08-29,v0.1 经三轮需求拷问后大改)
- 技术基线: React + TypeScript + shadcn/ui,数据层 CRDT(Yjs),轻量同步服务同容器部署于 **30090** 端口
- 平台优先级: **macOS / iPhone / Web 一等公民**;Linux 是开发机/CI/宿主机,不是产品目标

---

## 0. 决策记录(v0.1 → v0.2)

三轮 grill 得出的已锁定决策,后文按此展开:

| # | 议题 | 决策 |
|---|---|---|
| D1 | 数据架构 | 纯静态 → **local-first + CRDT(Yjs) + 容器内哑同步服务**(无业务逻辑的转发/存储点) |
| D2 | 多端一致性 | 不做 LWW 过渡,**直接 CRDT**(合并安全,离线友好) |
| D3 | 访问范围 | 目标公网 HTTPS;现状无域名无证书 → **分阶段**:LAN `http://IP` → Tailscale HTTPS → 域名+Cloudflare Tunnel(见 §9.7) |
| D4 | iPhone 形态 | **双轨并行**:PWA 立即 + Capacitor 原生壳(免费自签,7 天重签) |
| D5 | macOS 形态 | Web 先行,**Tauri 壳尽早(约 M5)** |
| D6 | 通知 | 原生端本地通知先行;Web Push 后置(等 HTTPS + relay 稳定) |
| D7 | Apple 生态 | 自包含不打通;远期可加只读 `.ics` 日历订阅(便宜) |
| D8 | Obsidian/语雀 | **链接级即可**(URI/URL 跳转),不做 vault 浏览、不做双向写回 |
| D9 | 存量数据 | 从零开始,无导入工具 |
| D10 | 使用人群 | **小多人(2–3 人)**:多账号 + 数据归属从第一天进数据模型;共享列表留作后期扩展 |

---

## 1. 产品定位与设计原则

**一句话**: 所有待办、日程、专注记录、习惯打卡住在同一张 CRDT 数据图里,任何设备上的任何视图都是它的实时投影。

四条设计原则:

1. **单一数据源,多视图投影** — 任务只有一个实体,List / MindMap / 四象限 / Timeline 只是同一份数据的四种渲染;任何视图里的操作都写回同一模型。
2. **Local-first + CRDT** — 每个端持完整本地副本(可离线全功能使用),CRDT 保证多端并发修改自动合并不丢数据;同步服务是哑的转发与存储,不承载业务逻辑,坏了/删了都不影响各端本地数据。
3. **键盘优先 + 快速捕获(桌面)/ 拇指优先(手机)** — 桌面:全局 Quick Capture 与 ⌘K 是一等公民;手机:底部标签栏 + FAB,44px 触控目标,无 hover 依赖。
4. **单人体验,多人地基** — UI 按单人使用设计;多账号与数据归属(D10)藏在模型层,共享功能以后按需点亮。

### 视觉语言(fancy / 科技感)

| 维度 | 方案 |
|---|---|
| 基调 | **Dark-first**(深空底色 `zinc-950` 系),浅色主题为二等公民 |
| 强调色 | 渐变 `cyan-400 → violet-500`,用于主按钮、进度环、选中态、焦点高亮 |
| 质感 | 玻璃拟态卡片(`backdrop-blur` + 半透明边框),细发光描边(glow border) |
| 动效 | framer-motion:视图切换淡入位移、任务完成划线粒子、计时进度环呼吸感;全部尊重 `prefers-reduced-motion` |
| 数字/时间 | JetBrains Mono 等宽,避免倒计时数字跳动 |
| 图标 | lucide-react |
| 空状态 | 每个视图配科技感空状态插画/动效,而非"暂无数据" |

---

## 2. 整体布局与响应式

### 桌面(≥ 768px,含 Tauri 窗口)

```
┌──────┬──────────────────────────────────────────────────────┐
│      │  ⌘K 搜索 / Quick Capture (N 键)          ◐ 主题 ⚙ 设置 │
│  ◇   ├──────────────────────────────────────────────────────┤
│ Task │                                                      │
│      │                                                      │
│  ◔   │              主视图区                                 │
│ Focus│   (List / MindMap / Matrix / Timeline 切换)          │
│      │                                                      │
│  ▦   │                                                      │
│ Habit│                                       ┌────────────┐ │
│      │                                       │ 详情侧滑面板 │ │
│  ✉   │                                       │ (选中任务)  │ │
│ Inbox│                                       └────────────┘ │
│      │                                                      │
└──────┴──────────────────────────────────────────────────────┘
```

- 左侧 rail:logo + 三面板入口 + Inbox(未处理计数徽标)+ 底部当前账号头像(点击:切换账号/登出)。
- 主区顶部**视图切换器**(Segmented Control,滑动指示动画),同面板内切换不丢上下文。
- 右侧**详情抽屉**(488px 玻璃面板):唯一的完整编辑入口(列表内联编辑仅限标题)。

### 手机(< 768px,iPhone PWA / Capacitor)

```
┌────────────────────────┐
│  今日 · 周三      ◐ ⌘  │
├────────────────────────┤
│                        │
│   (同数据源的紧凑视图)   │
│                        │
│                        │
│                        │
│              ┌────┐    │
│              │ ＋  │    │  ← FAB: Quick Capture(拇指区)
│              └────┘    │
├────────────────────────┤
│  ◇任务  ◔专注  ▦习惯  ✉收 │  ← 底部标签栏,safe-area 适配
└────────────────────────┘
```

- 底部标签栏替代左 rail;四象限/导图/时间线从任务页顶部切换器进入。
- 各视图的手机形态:List 天然适配;四象限改纵向双列滚动;导图双指缩放;日视图竖屏时间轴天然合适;详情抽屉变底部全屏 sheet。
- 交互统一走 Pointer Events(拖拽库选 @dnd-kit,见 §9.2),一套代码同时吃鼠标与触摸。

路由结构(三端一致):

```
/                Dashboard(今日概览:今日任务 + 下个日程 + 专注 + 习惯)
/tasks           ?view=list(默认) | mindmap | matrix | timeline
/inbox           收集箱
/focus           专注面板(可从任务上下文进入并自动关联)
/habits          习惯面板
/settings        账号、主题、数据导出导入、快捷键
/login           登录/注册(仅多账号,见 §9.5)
```

---

## 3. 核心信息模型

关键建模决策:**Task(任务)与 Event(时间块)分离**。任务是要做的事(可无限嵌套、可进四象限),时间块是日历上的安排(精确起止分钟),通过 `taskId` 关联——"把任务排进日程"= 为任务创建时间块。

领域对象是普通 TS 类型;持久化与同步由 CRDT 层负责(映射规则见 §9.3),领域代码不感知 Yjs。

```ts
// packages/core/src/types.ts(草案)

type ID = string; // nanoid

/** 任务状态机: inbox → todo → doing → done / archived */
type TaskStatus = 'inbox' | 'todo' | 'doing' | 'done' | 'archived';
type Priority = 'P0' | 'P1' | 'P2' | 'P3';

interface Task {
  id: ID;
  title: string;
  notes?: string;              // Markdown
  status: TaskStatus;
  parentId: ID | null;         // 任意层级子任务(单亲森林)
  order: number;               // 同级排序:数值中点 + 局部重排(见 DEVLOG D-1)
  important: boolean;          // 四象限纵轴
  urgent: boolean;             // 四象限横轴
  tags: ID[];
  dueAt?: number | null;       // UTC epoch ms(本地时区渲染)
  estimateMin?: number;
  ownerId: ID;                 // D10: 归属账号(多人地基)
  createdAt: number;           // UTC epoch ms
  updatedAt: number;
  completedAt?: number | null;
  deletedAt?: number | null;   // 软删 = 回收站;CRDT 下自然同步
}

/** 日程时间块: Timeline 视图的实体,精确到分钟 */
interface ScheduleEvent {
  id: ID;
  taskId: ID | null;           // 可独立于任务存在(纯日程)
  title: string;
  start: number;               // UTC epoch ms
  end: number;
  kind: 'focus' | 'meeting' | 'personal' | 'routine';
  completed?: boolean;
  ownerId: ID;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

/** 外部链接: Note / Agent / 任意 URL 的统一抽象(D8: 链接级) */
interface TaskLink {
  id: ID;
  taskId: ID;
  type: 'obsidian' | 'yuque' | 'url' | 'agent';
  target: string;              // obsidian://open?vault=..&file=.. | https://... | agent run url
  title?: string;
  ownerId: ID;
}

/** 专注记录 */
interface FocusSession {
  id: ID;
  taskId: ID | null;
  startedAt: number;
  endedAt: number;
  plannedMin: number;
  actualMin: number;
  mode: 'focus' | 'short-break' | 'long-break';
  completed: boolean;          // 是否完整走完
  distractions?: number;       // 中途切走次数
  ownerId: ID;
}

/** 习惯 */
interface Habit {
  id: ID;
  name: string;
  icon: string;                // lucide 图标名
  color: string;
  cadence:
    | { type: 'daily' }
    | { type: 'weekly'; timesPerWeek: number; days?: number[] }
    | { type: 'interval'; everyNDays: number }
    | { type: 'custom'; cron: string };         // 后期
  reminderAt?: string;         // 'HH:mm'(本地时区,仅提示意图)
  linkedTaskTemplateId?: ID;   // 可选:自动生成每日 TODO
  ownerId: ID;
  createdAt: number;
  archivedAt?: number | null;
}

interface HabitLog {
  id: ID;
  habitId: ID;
  date: string;                // 'YYYY-MM-DD'(本地时区日界)
  count: number;               // 支持每日多次打卡
  ownerId: ID;
}
```

要点:

- **任意层级子任务**:`parentId` 单亲模型 + `order` fractional indexing string(拖拽免全量重排)。并发排序冲突在 CRDT 下表现为个别条目交错,单人高频场景可忽略。
- **四象限**存 `important × urgent` 布尔对;拖动到某象限 = 改这两个布尔。
- **收集箱**不是单独的表:`status === 'inbox'` 即草稿。Quick Capture 零字段要求,标题可为空(粘贴的原始碎片)。
- **时间戳一律 UTC epoch ms,渲染一律本地时区**;"某一天"的边界在渲染端按设备时区计算——多设备跨时区不炸。
- **软删 `deletedAt`**:给回收站/撤销用,同时是 CRDT 的墓碑(删除可同步)。物理清除由本地"回收站 30 天"策略执行。
- 所有实体带 `ownerId` 与 `updatedAt`(后者 CRDT 场景主要用于展示,不参与合并仲裁)。

---

## 4. 面板一:TODO List Manager

### 4.1 List View(默认视图)

- 分组:**今天 / 已过期 / 即将到来 / 任何时候 / 已完成(今日)**,组内按 order。
- 树形展开:无限层级;父任务标题右侧内嵌微型渐变进度条(`3/7`)。
- 交互:
  - 勾选完成(划线 + 淡出)、拖拽跨层级排序(拖到另一任务上方 25% 区域 = 变为其子任务);
  - 快捷键:`Enter` 新建同级、`Tab/Shift+Tab` 降/升级、`⌘D` 完成、`1/2/3/4` 设 P0–P3、`T` 今天、`M` 明天、`⌫` 删除;
  - 行尾 hover 出现:一键专注(▶)、更多操作(手机上以长按/滑动菜单代替 hover)。
- 左侧二级侧栏(仅桌面):智能过滤(今天、未来 7 天、高优先级、无日期)、标签、保存的过滤器。

### 4.2 MindMap View

任务森林的放射状投影:

```
            ┌─ 子任务 B
   ┌─ 项目 A ┤                    节点 = 任务
   │        └─ 子任务 C           边   = 父子关系
根(视图根)─┤
   │        ┌─ …
   └─ 项目 B ┘
```

- **根节点可切换**:「全部」「某标签」「某个父任务」「今日」——任意子树都能当导图中心。
- 节点样式 = 状态:未完成描边发光、进行中呼吸动画、完成划线降透明;角落显示子任务进度环。
- 交互:`Tab` 加子节点、`Enter` 加兄弟、双击编辑、拖节点到另一节点 = 重挂层级;画布平移/捏合缩放/框选;右下 minimap。
- 布局:elkjs 的 radial/tidy tree 自动布局,允许拖动微调(只存 offset 不存绝对坐标,保持投影纯度)。
- 手机:双指缩放 + 长按节点菜单。
- 选型:**React Flow(`@xyflow/react`)**,自定义节点与 Tailwind/shadcn 融合好,minimap/缩放开箱即用。

### 4.3 四象限(Eisenhower Matrix)

```
┌─────────────────────┬─────────────────────┐
│  重要 · 不紧急        │  重要 · 紧急          │
│  PLAN 计划           │  DO 立即做    ● P0    │
│  (青色氛围)          │  (品红/橙氛围)        │
├─────────────────────┼─────────────────────┤
│  不重要 · 不紧急      │  不重要 · 紧急        │
│  ELIMINATE 淘汰      │  DELEGATE 委托/快速   │
│  (灰,低饱和)         │  (黄氛围)            │
└─────────────────────┴─────────────────────┘
```

- 2×2 玻璃卡片,中央十字轴渐变发光分隔(科技感核心画面之一);每象限计数徽标。
- 任务 chip 拖拽跨象限 = 改 `important/urgent`(掉落弹跳);象限内拖拽排序。
- 双击象限空白快速新建(自动带属性);点击 chip 开详情抽屉(手机为底部 sheet)。
- 数据范围默认:`status ∈ {todo, doing}` 且无日期或本周内,避免被远期任务淹没。
- 手机:纵向双列,象限可折叠。

### 4.4 Timeline View

顶部分段切换:**月 / 周 / 日**。

**月视图**
- 月历格:当日时间块彩色小条 + 任务 due 小圆点;今日格发光描边。
- 完成度热力:格子背景随「完成/计划」加深(单色渐变)。
- 点击某天 → 日视图。

**周视图**:7 列 × 垂直时间轴,适合排会议与整块工作。

**日视图(精确到分钟)— 重头戏**
- 左侧时间轴 `00:00–24:00`,**5 分钟小刻度 / 30 分钟大刻度**;当前时刻为横贯发光 now-line(呼吸动画,分钟级移动)。
- 时间块玻璃圆角条,高度 = 时长;整体拖动(吸附 5 分钟)、上下边缘拉伸、左右跨天。
- 空白处拖划 = 新建时间块(松开弹轻量气泡只填标题);双击 = 1 小时默认块。
- 右侧「今日待排任务」坞:从 List/四象限拖任务进来即转时间块(`taskId` 关联),反向可 detach 成任务;`focus` 块可一键开始专注。
- 手机竖屏:时间轴天然适配;新建手势 = 长按空白拖划。
- 选型:**自研**(绝对定位 + 分钟→像素线性映射,`60px/h` 起步)。分钟级交互与定制视觉是差异点,日历库是负资产。

---

## 5. 其他 Features(面板一附属)

### 5.1 收集箱草稿模式(Inbox)

- 独立页面 + 全局 Quick Capture 双入口。
- **Quick Capture**(web 页内 `N` 键 / 手机 FAB / Tauri 全局快捷键):中央单行输入框,回车即存、连续录入不清弹窗;内联语法加速:`#tag`、`!P1`、`~30m`(预估)、`@fri`(due)。语法仅是加速器不强制。
- Inbox 列表 = 原始碎片流(时间倒序),每条三个动作:**拖到结构**(拖入目标树/标签/日期)、**升级为任务**(抽屉补全,`status → todo`)、**丢弃**。
- 顶部「待处理 N 条」+ 每周日清空提示(可关)。

### 5.2 Link to Note / Link to Agent(D8: 链接级)

统一 `TaskLink` 抽象,全部是可点击跳转的引用,不抓取内容:

| 类型 | target 形态 | 行为 |
|---|---|---|
| Obsidian | `obsidian://open?vault=…&file=…` | 点击尝试唤起;失败(如 web 端未装)给复制提示 |
| 语雀 | `https://yuque.com/<ns>/<slug>` | 新开链接 |
| 任意 URL | url | 新开 |
| Agent | `https://claude.ai/…` 或自定义 run url | 新开 |

- 详情抽屉「链接」区块:图标 + 标题列表,`⌘L` 添加;粘贴自动识别类型(Obsidian URI / 语雀 / URL)。
- **Agent 集成远期形态**(占位,不在近期里程碑):本地 MCP server 暴露 `list_tasks / create_task / complete_task`,让外部 agent 直接读写任务库——"Link to Agent"从链接升级为协作。多账号后需加 per-user token。

---

## 6. 面板二:Focus / 番茄时钟

```
        ╭──────────────────────╮
        │      ┌────────┐      │   任务: 修复登录超时 bug
        │     ╱  24:31 ╱│      │   模式: ● 专注 50m  ○ 短休 5m  ○ 长休 15m
        │    │  ▓▓▓▓▓░ │      │   会话: 今日第 5 番茄 · 连续 3 天
        │     ╲       ╱│      │
        │      └────────┘      │   [ ⏸ 暂停 ]  [ ■ 放弃 ]  [ ✓ 提前完成 ]
        ╰──────────────────────╯
```

- **视觉主角**:巨大 SVG 进度环(渐变描边 + 外圈 glow),中央等宽倒计时;环外一圈缓转虚线装饰(仪表盘气质)。
- 模式:专注 25 / 50 / 90 / 自定义;短休/长休;经典循环(4 专注 1 长休)可开关。
- **任务绑定**:任意视图 ▶ 进入即关联;会话结束任务 `+1 🍅` 与时长累计。
- **沉浸模式**:全屏隐藏 chrome;可选白噪音(本地音频文件:rain / brown noise / cafe)。
- 纪律统计:运行中切走 > 1 分钟记一次 distraction(可关),结束轻量复盘。
- 结束提醒:原生端本地通知(Tauri/Capacitor,见 §9.8)+ 音效;暂停即停表;放弃需二次确认。
- 统计:今日时长/番茄数、streak 火焰、近 7 天柱状图、按标签分布。
- 进行中锁定视图切换防误触;页面标题实时显示剩余(`24:31 ▶ Fix login bug — Cortex`)。
- **macOS Tauri 增强(M5)**:菜单栏常驻迷你倒计时;全局快捷键开始/暂停。

---

## 7. 面板三:习惯养成

```
 喝水 8 杯     ▓▓▓▓▓░░░ 5/8      [+1]     ▩ 热力图(近 20 周)
 晨跑          ● streak 12 天     [✓]      █████▓▓▓▂▂░░…
 阅读 30min    3/周 · 本周 2      [✓]      █████████▓▓▓▓▓▓▂
 冥想          ● 今日未完成       [✓]
```

- 习惯卡片流:图标 + 名称 + 今日进度(每日多次计数:点 +1 / 长按批量)+ streak。
- **热力图**:GitHub contributions 风格;颜色用习惯自身 color;详情页放大为近一年。
- 每习惯详情:完成率环(近 30 天)、最长/当前 streak、打卡日历、编辑 cadence。
- Cadence:每天 / 每周 N 次 / 隔 N 天(初版),`cron` 留字段。
- **与任务联动(可选)**:习惯每日自动生成 TODO 模板,打卡或勾任务任一侧双向完成。
- 今日总览:Dashboard 与 Focus 底部放习惯迷你条,完成即点不跳页。

---

## 8. 全局体验

- **Command Palette(⌘K)**:`cmdk`;全局搜索任务/习惯 + 动作(`新建任务`、`开始专注 25m`、`切到四象限`…)。手机上以搜索图标代替。
- 快捷键总表(`?` 呼出);手机提供手势:列表左滑完成、右滑删除。
- 主题:dark / light / system;accent 可换(默认 cyan→violet,备选 emerald/amber/rose)。
- 数据安全:设置页「导出 JSON / 导入 JSON」(全量含元数据,CRDT 文档快照 + 领域对象双格式);危险操作二次确认;回收站 30 天。
- 账号:头像点开 = 切换账号 / 登出 / 新增账号(邀请码制,首个账号初始化时创建,见 §9.5)。
- i18n:中文优先,文案外置(i18n 就绪但初版只带 zh)。
- 无障碍:焦点环清晰,动画遵守 `prefers-reduced-motion`。

---

## 9. 技术架构

### 9.1 总体

```
┌────────────────────────────────────────────────────────────┐
│                    客户端(三端复用同一套代码)                 │
│  apps/web (Vite SPA/PWA)  apps/desktop(Tauri)  apps/mobile(Capacitor) │
├────────────────────────────────────────────────────────────┤
│  packages/ui        shadcn/ui 组件 + 主题 + 动效             │
│  packages/core      领域模型 + 用例(纯 TS,零 DOM/平台依赖)   │
│  packages/crdt      Yjs 文档结构 + 各端持久化适配             │
│                     ├─ IndexedDB(y-indexeddb, web/PWA)     │
│                     ├─ 文件/SQLite blob(Tauri, M5)          │
│                     └─ SQLite(Capacitor, M7)               │
│  packages/platform  平台能力适配:通知/快捷键/深链/分享        │
├────────────────────────────────────────────────────────────┤
│  apps/server(同容器) 哑同步服务:账号 + Yjs 更新转发/存储      │
│                     无业务逻辑,不解析数据内容                 │
└────────────────────────────────────────────────────────────┘
```

要点:CRDT 让存储层在三个平台**高度统一**(同一套 Yjs 代码,只有"字节落在哪"不同:IndexedDB / 文件 / SQLite),比 v0.1 的"每端各写 Repository"更省。原生壳(Tauri/Capacitor)接入时业务代码零改动。

### 9.2 技术选型清单

| 层 | 选择 | 备注 |
|---|---|---|
| 框架 | React 18 + TypeScript + Vite | |
| 路由 | React Router(v7 library mode) | 视图状态进 query(`?view=`) |
| 状态 | Zustand(UI 态)+ core 层订阅 CRDT 派生视图 | 数据源永远是从 Yjs doc 派生的普通对象 |
| UI 组件 | **shadcn/ui**(拷贝进 packages/ui 魔改) | Sheet/Command/Segmented 直接用 |
| 样式 | Tailwind CSS v4 | 主题 token 走 CSS variables |
| 动效 | framer-motion | |
| 拖拽 | **@dnd-kit** | Pointer Events,一套代码吃鼠标+触摸(HTML5 DnD 无触摸,排除) |
| 导图 | @xyflow/react + elkjs | |
| 图表 | recharts | |
| 命令面板 | cmdk | |
| 时间 | date-fns | UTC 存储,本地渲染 |
| ID/顺序 | nanoid + fractional indexing | |
| **数据** | **Yjs** + y-indexeddb(web) | CRDT 核心;Automerge 备选过,生态与体积选 Yjs |
| 同步 | WebSocket(y-protocols sync) | 断线自动重连,离线写入本地、上线合并 |
| 服务端 | **Hono + ws + better-sqlite3** | 单进程小服务,详见 §9.4 |
| 包管理 | pnpm workspaces | |
| 测试 | Vitest + Testing Library + Playwright | 见 §11 |

### 9.3 CRDT 数据层设计(packages/crdt)

**文档结构**:每账号 7 个**扁平 Y.Doc**(root/tasks/events/links/sessions/habits/habitLogs,单 WebSocket 多路复用,见 DEVLOG D-2):

```
tasks  → items: Y.Map<taskId, Y.Map<field, value>>
events → items: Y.Map<eventId, Y.Map<field, value>>
…(links / sessions / habits / habitLogs 同构)
root   → settings(Y.Map) + tags(Y.Map<id, Y.Map>)
```

- 每个实体是一个 `Y.Map`,**字段级合并**——两台设备同时改同一任务的不同字段,都能保住。
- 集合用 `Y.Map<id, entity>` 而非 `Y.Array`:增删改按 id 寻址,天然幂等,无需处理列表位置的 CRDT 语义;顺序由领域层的 `order` key 派生(渲染时排序)。
- **派生视图**:`packages/core` 提供 `useTasks(filter)` 之类订阅 hooks:从 Yjs doc 派生普通 `Task[]` + `memoize`,UI 永远只碰普通对象;Yjs 细节被挡在 core 之下。
- **schema 演进**:新增字段直接写(缺省读 undefined→默认值);改名/改类型需写一次性迁移(Y.Doc 遍历改写),迁移函数版本化存 `packages/crdt/migrations`。
- **本地持久化**:web 用 y-indexeddb(自动);Tauri/Capacitor 把 `encodeStateAsUpdate` 增量落文件/SQLite。
- **备份**:导出 = Yjs 二进制快照 + 人类可读 JSON 双格式;导入 = 重建本地 doc 并与远端合并(CRDT 保证不覆盖不丢)。

### 9.4 同步服务(apps/server,同容器)

定位:**哑管道**——鉴权、转发、存字节,不解析内容。约 300 行。

```
POST /api/auth/login      {username, password} → session cookie
POST /api/auth/register   {inviteCode, username, password}   ← 邀请码制
WS   /api/sync            y-protocols sync(按 subdoc 分流)
GET  /api/export          全量快照下载(备份用)
GET  /healthz             容器健康检查
```

- 存储:SQLite 单文件(`data/cortex.db`),存账号表 + 每 subdoc 的 update 日志,定期压实为 snapshot(控制体积);**卷挂载持久化**。
- 同步协议:标准 y-protocols(客户端 `y-websocket` 客户端部分可直接复用),服务端只按 `(userId, subdocId)` 路由字节。
- WS 鉴权:登录后发一次性 ticket,WS 握手携带(Cookie 在 WS 场景不可靠)。
- 体积预期:个人年度数据 < 几 MB,SQLite 毫无压力;压实后全量重放也秒级。
- **失败模式**:server 挂了/删了 → 各端本地照常全功能,恢复后自动补同步;这是 local-first 的红利。
- **E2EE(远期可选)**:客户端持对称钥加密 update 字节,服务端只见密文。公网裸奔阶段若提前有顾虑可提前做;见 Open Questions。

### 9.5 多账号(D10:小多人)

- **账号模型**:`users(id, username, passwordHash(argon2), createdAt)`;首个账号在首次部署的引导页创建,后续账号凭**邀请码**注册(设置页生成,可撤销)——挡住公网裸注册。
- **数据隔离**:每账号独立 subdoc 命名空间,同步服务按身份硬隔离。UI 单活动账号,一次登录长期有效(长 session),多人在同一浏览器用不同 profile/PWA 实例。
- **共享(后期,不进近期里程碑)**:实体已带 `ownerId`;未来共享某项目/列表 = 新增 shared subdoc + ACL 表,客户端把 shared doc 并入派生视图——现在的结构不需要推翻。
- **安全边界注意**:当前阶段(无域名无 TLS)密码明文过网络,仅限 LAN/VPN 内使用;Tailscale HTTPS 阶段起才可视为安全;公网阶段(域名+CF)强制 HTTPS + rate limit。

### 9.6 目录结构

```
cortex/
├─ apps/
│  ├─ web/                  # PWA(Vite),M0 起
│  ├─ server/               # 哑同步服务(Hono),M2 起
│  ├─ desktop/              # Tauri 壳,M5 起
│  └─ mobile/               # Capacitor 壳,M7 起
├─ packages/
│  ├─ core/                 # 领域模型、用例、派生视图 hooks(纯 TS)
│  ├─ crdt/                 # Yjs 文档结构 + 持久化适配 + 迁移
│  ├─ ui/                   # shadcn 组件 + 主题
│  └─ platform/             # 通知/快捷键/深链的平台实现(web/Tauri/Capacitor)
├─ docs/
├─ e2e/                     # Playwright 测试(Linux CI 跑)
├─ docker-compose.yml
└─ pnpm-workspace.yaml
```

### 9.7 部署与访问演进(D3)

**容器形态**:单镜像单进程——Node 服务同时伺服静态资源 + API + WebSocket(个人规模无需 Nginx 前置),一个端口 30090,一个数据卷。

```dockerfile
# 示意
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build   # web 产物 + server 编译

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/apps/server/dist ./server
COPY --from=build /app/apps/web/dist ./public
ENV PORT=30090
EXPOSE 30090
CMD ["node", "server/index.js"]
```

```yaml
# docker-compose.yml 示意
services:
  cortex:
    build: .
    ports: ["30090:30090"]
    volumes: ["./data:/app/data"]     # SQLite + 备份
    restart: unless-stopped
```

**访问三阶段**(每阶段的解锁项与前置条件):

| 阶段 | 形态 | 解锁 | 前置 |
|---|---|---|---|
| P0(现在) | `http://<内网IP>:30090` | Mac/Linux 浏览器开发与日常使用;iPhone 当普通网页用(数据正常,无 PWA 能力) | 无 |
| P1 | `https://<机器名>.<tailnet>.ts.net`(Tailscale HTTPS) | **iPhone PWA 全功能**(加主屏/离线/安全上下文 API);外出经 VPN 访问 | iPhone/Mac 装 Tailscale;管理台开 HTTPS 证书(~20 分钟,免费,无需域名) |
| P2(想要公网时) | 自有域名 + Cloudflare Tunnel | 任意网络直达;可开 Web Push;分享给他人的前提 | 买个域名 |

> **为什么 P0 的 iPhone 只是"普通网页"**:iOS 的 service worker(离线缓存)与 iOS 16.4+ 的 Web Push 都要求安全上下文(HTTPS);`navigator.clipboard`、`crypto.subtle` 同样。Tailscale 的 Let's Encrypt 证书(`*.ts.net`)是零成本解法。原生 Capacitor 壳不受影响(资源在包内,通讯走同一 API)。

### 9.8 通知(D6)

| 端 | 机制 | 触发 |
|---|---|---|
| web/PWA | 初版仅应用内(badge + 打开时提醒);Web Push 等 P2 | — |
| macOS(Tauri, M5) | 本地通知插件 | 番茄结束、日程前 10min、习惯提醒 |
| iPhone(Capacitor, M7) | 本地通知插件 | 同上 |

- 提醒调度在**客户端本地计算**(打开 app 时根据数据排程),不依赖服务端定时器——哑服务原则不破。
- iPhone 原生壳可申请通知权限后精确调度;PWA 在 P2 前无系统级提醒,已知取舍。

### 9.9 关键技术决策与理由(相对 v0.1 的变化)

1. **Dexie → Yjs**:多端一致从"以后再说"变成"架构保证"。存储、同步、离线三件事一次解决;代价是引入 CRDT 心智成本,由 §9.3 的"派生视图"封装隔离。
2. **纯静态 → 单进程小服务**:CRDT 需要一个汇合点;服务保持哑(无业务逻辑),失败不影响本地——local-first 精神保留。
3. **Repository 抽象 → 平台持久化适配器**:CRDT 统一了存储语义,只需换"字节落盘位置"。
4. **react-dnd 系 → @dnd-kit**:iPhone 触摸拖拽是硬需求。
5. **不引全功能日历库**:日视图分钟级交互是差异点,自研可控(核心是分钟→像素映射 + 拖拽状态机)。
6. **多账号进模型不进 UI**:ownerId 字段 + 邀请码注册即全部近期成本;共享列表留到真需要时。

---

## 10. 平台策略

| 平台 | 角色 | 形态 | 里程碑 |
|---|---|---|---|
| **Web(P0 起点与基准)** | 开发基准 + Mac 日常使用 | Vite SPA → PWA(manifest + service worker 随 HTTPS 分阶段启用) | M0 起 |
| **iPhone** | 一等公民 | **双轨**:PWA(日常主力) + Capacitor 原生(通知/分享入口/图标) | PWA M2;原生 M7 |
| **macOS** | 一等公民 | Web 先行 → Tauri 壳(全局 Quick Capture、菜单栏倒计时、本地通知) | Tauri M5 |
| **Linux** | 开发机/CI/宿主机,非产品目标 | 容器宿主 + 自动化测试;桌面 Linux 不专门适配(顺带能用就行) | — |

**iPhone 免费自签的已知代价**(D4):Xcode 个人团队签名 **7 天过期**,过期前需连 Mac 重签重装;TestFlight 需 $99/年开发者账号。因此定位:原生壳是"每 7 天续命的实验轨",**PWA 是 iPhone 日常主力**;哪天原生价值兑现(通知/分享用上瘾)再买账号转 TestFlight。

**原生构建须知**:Tauri 与 Capacitor 的 iOS/macOS 构建都只能在 Mac 上完成(Xcode);Linux 开发机出的产物是 web 资产,Mac 上 `pnpm tauri build` / Xcode 出包。CI 自动出原生包远期再说(需要 Mac runner)。

---

## 11. 测试策略

回答"Linux 能不能完整测试":**自动化层完全够,真机层不够**——按下表分工,Linux 承担 90%,真机抽检走 Mac/iPhone。

### 11.1 分工矩阵

| 层 | 在哪跑 | 内容 |
|---|---|---|
| 单元/组件测试 | **Linux CI**(Vitest + Testing Library) | core 用例(状态机、fractional order、cadence 计算、日界处理)、CRDT 迁移、派生视图 |
| CRDT 合并测试 | **Linux CI** | 脚本化"两客户端离线并发改→合并→断言不丢"(Yjs 可在内存模拟多端,无需网络) |
| E2E | **Linux CI**(Playwright) | 关键路径:注册/登录、Quick Capture→整理→完成、排一天日程、番茄全流程、习惯打卡。引擎跑 **chromium + webkit**(webkit 与 iOS Safari 同引擎,能覆盖大多数 Safari 特有坑) |
| API/同步测试 | **Linux CI** | server 起真进程:双客户端经 WS 同步收敛、鉴权、快照压实 |
| 容器冒烟 | **Linux CI** | docker build → 起容器 → healthz → 首页 200 |
| **手动·Mac** | Mac | Safari + Chrome 目检(布局/动效/字体);M5 起增加:Tauri 构建、全局快捷键、菜单栏、本地通知 |
| **手动·iPhone** | 真机 | 见 11.2 清单 |

### 11.2 iPhone 真机检查清单(每个里程碑过一遍,~15 分钟)

- [ ] P1 起从 Tailscale HTTPS 打开;加主屏后 standalone 全屏、无 Safari 地址栏
- [ ] 安全区适配:刘海/底部横条不遮挡(底部标签栏 padding)
- [ ] 触控目标 ≥44px;列表滑动完成/删除手势不误触
- [ ] 键盘弹起不盖住输入框;Quick Capture 弹层在键盘上方
- [ ] 日视图拖拽时间块跟手、无橡皮筋错位;导图双指缩放流畅
- [ ] 深色模式与系统一致;横竖屏(竖屏为主,横屏不崩即可)
- [ ] 弱网/断网下可开可改,恢复后同步收敛
- [ ] M7 起:原生壳通知到达、分享入口接住内容

### 11.3 跨端一致性的设计期保障(写进代码规范)

- 一切时间戳 UTC epoch ms;"今天"的边界渲染时按本地时区算——测试用例故意造跨时区双设备场景。
- 禁止 hover-only 交互:桌面 hover 出现的操作,触摸端必须有等价入口(长按/滑动/更多按钮)。
- 拖拽一律 @dnd-kit Pointer Sensor;布局 mobile-first 写断点。
- API/数据格式三端同一份 `packages/core` 定义,不允许任何端私改。

---

## 12. 里程碑

| 里程碑 | 内容 | 验收 |
|---|---|---|
| **M0 骨架** | monorepo + Vite + Tailwind + shadcn、主题系统、布局壳(桌面 rail + 手机底部栏)、Docker 跑通 30090 | `http://IP:30090` 三面板空壳,手机浏览器可看 |
| **M1 任务核心(本地)** | CRDT 数据层(Yjs + IndexedDB)、Task CRUD、无限层级树、List 视图、Inbox + Quick Capture、详情抽屉、导出 JSON | 单机日常收集→整理→完成闭环 |
| **M2 同步与账号** | server(登录/邀请码/WS 同步)、多账号模型、Tailscale HTTPS、**PWA manifest + 离线缓存** | **Mac 与 iPhone 加主屏后数据实时一致**;断网可用、恢复合并 |
| **M3 时间线** | 日视图(分钟级拖拽/拉伸/now-line)、周、月(热力)、任务↔时间块互转 | 一天日程完整排布,iPhone 竖屏可操作 |
| **M4 专注 + 习惯** | 番茄全功能(环/绑定/沉浸/统计)、习惯 CRUD/打卡/热力/streak/任务联动 | 三面板全部活起来;应用内提醒 |
| **M5 Tauri 桌面壳** | Mac 壳:全局 Quick Capture、菜单栏倒计时、本地通知、开机自启 | Mac 日常可脱离浏览器 |
| **M6 四象限 + 导图** | 两个投影视图 | 拖拽跨象限/重挂层级在手机上也顺 |
| **M7 Capacitor iPhone 壳** | 原生壳:本地通知、系统分享入口、App 图标;免费自签流程文档化 | 真机 7 天自签可用;通知到达 |
| **M8 链接与增强** | TaskLink 完整、`.ics` 导出、Dashboard 完善、同步 E2EE(评估)、备份自动化 | |

排序逻辑:M1→M2 让"多端一致"尽早成立(你三端使用,这是价值最大的一步);M3/M4 补齐核心体验;Tauri(M5)按你要求尽早;四象限/导图是廉价投影放后;原生壳放 M7 是因为 PWA 已覆盖日常,它的增量价值(通知/分享)在 M7 兑现最划算。

---

## 13. 待定决策(Open Questions)

1. **产品名**:Cortex 正式启用?
2. **共享的形态**(D10 后续):共享整个项目?只读还是可协作?何时点亮?
3. **同步 E2EE**:公网裸奔阶段前是否必须做(成本:客户端密钥管理 + 配对流程)?建议 P2(域名+公网)前决策。
4. **开发者账号升级时机**:原生壳用上瘾 → TestFlight;触发条件定为"7 天重签连续烦了三周"。
5. **域名购买时机**:Web Push 与"分享给别人"都需要 P2;无明确外部访问需求可一直停在 Tailscale。
6. **Apple Watch / 桌面 Widget**:远期是否有兴趣?影响 M7 的原生工程结构(是否留 watch target)。
