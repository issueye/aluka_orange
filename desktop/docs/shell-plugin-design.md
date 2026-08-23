# Aluka Desktop — 壳层插件化设计方案

> 制定日期：2026-08-23
> 代号：`shell-plugin-design`
> 前置讨论结论（本轮评估已确认）：
> 1. **完整重构**：一次性重写壳层到终态，不保留渐进兼容层；agent 运行时的事件发射协议（`DesktopRuntimeEvent`）作为唯一不动的地基。
> 2. **外部动态插件**：插件由外部动态提供，不与项目打包（沿用 agent 现有发现机制），UI 侧必须按"不可信、可能离线、可能升级"设计。
> 3. **参考模型**：VS Code 扩展架构（贡献点 + when 子句 + 宿主注入组件 / Webview 模型），本方案是其"小集合"裁剪版。
> 4. **分层交付**：T0 声明式/数据提供者档先行（约 6 周），组件档独立排在之后（合计约 9 周）。

---

## 0. 目标与非目标

### 0.1 目标

把桌面壳从"单体 App"重构为"插件可参与、可替换的骨架"：

- 壳层布局（侧栏 / 顶栏 / 主区 / 状态栏 / 空态 / 输入区）拆分为**离散槽位（slots）**；
- 扩展（扩展 = 外部动态插件）可向槽位声明贡献：T0 元数据/数据（宿主渲染），组件档 `@aluka/ui` 组件（同树渲染）；
- 内置功能与插件贡献**同构**（内置即默认贡献，`builtin:*` 前缀），插件可声明式替换/补充内置；
- UI 与 agent 侧的贡献契约单一来源，版本化、可协商。

### 0.2 非目标

| 不做 | 原因 |
|------|------|
| 窗口控制按钮、托盘、闪屏、标题栏拖拽插件化 | 壳保护区；插件代码已有全权限，这类"可插拔"只有视觉伪装风险 |
| 完整 VS Code 式扩展宿主进程隔离 | agent 运行时时序重构是手术；先用 per-extension 错误隔离垫底（远期项） |
| Marketplace 全套（发布/审核/签名体系） | 过重；保留 npm:/git:/路径安装，可加校验和（远期） |
| 插件渲染到宿主主视图区域之外的原生 UI（菜单、弹窗渲染扩展等） | 无需求支撑 |
| 扩展用户侧"市场/搜索/评分" | 无需求支撑 |

---

## 1. 现状与问题

### 1.1 耦合盘点（量化）

| 耦合点 | 位置 | 量级 |
|---|---|---|
| 状态容器 | `apps/desktop/src/ui/App.tsx:63-112` | 30+ useState + 5 类事件订阅 |
| 视图 props 体积 | `ChatView` 15 个 props、`WorkspaceSidebar` 8 个回调 | 460 / 280 行 |
| 事件路由 | `App.tsx:562-868`（activeIdRef 分流 + 5 个 bus.on） | ~300 行 |
| 布局 JSX | `App.tsx:983-1259` | ~280 行 |
| 契约重复 | `agent/src/extensions/types.ts:921` 与 `ui/types.ts:161` | 两份 UiContribution |
| 全局样式 | `styles.css` 3522 行 + `components/ui.css` 1021 行 | 单文件全局 |

### 1.2 已具备的资产（M1-M4，全部保留）

- 视图注册表 `ui/views/registry.ts`：`SHELL_VIEWS` + `registerRuntimeView` / `clearRuntimeViews`（幂等语义）；
- 声明式贡献链路：`pi.contributes(ui)` → loader 校验 → `listUiContributions` RPC → UI 侧同步注册表；
- 双通道传输 `ui/bridge.ts`：`window.aluka` 桥接 ↔ HTTP（token + 长轮询）自适应，浏览器模式已可用；
- HTTP 服务 `main/http-server.ts`：静态 + RPC + 事件长轮询 + 安全校验（token / Host / Origin / 防穿越）；
- 热重载：`reloadExtensions` → 新建 ExtensionRuntime → `aluka:extensions-reloaded` → 重新拉取贡献；
- 示例扩展：`agent/examples/extensions/greet.ts`（四类注册演示）、`guard.ts`（工具拦截）。

---

## 2. 目标架构

### 2.1 分层插件形态

```
┌────────────────────────────────────────────────────────────┐
│ GUI 壳（重构后的骨架）                                        │
│  shell/store.ts   三域外部 store（shell / session / view）    │
│  shell/chrome.tsx 布局铬片（Sidebar/Header/Main/Toast/Dialog）│
│  shell/slots.tsx  SlotOutlet 渲染器（内置 builtin:* 注册）     │
│  shell/registry.ts 视图+槽位统一注册表                         │
│  plugins/ssr.tsx      主进程 SSR 渲染器（jiti 加载插件组件）│
├────────────────────────────────────────────────────────────┤
│ 主进程 HTTP 服务 + RPC（handler 表 → 加白名单分级）            │
├────────────────────────────────────────────────────────────┤
│ DesktopRuntime（agent 运行时，事件协议不动）                   │
│  extensions/loader.ts  两轨注册：manifest 轨 + pi.contributes │
│  extensions/types.ts   契约 v2（slot / when / entry / …）    │
│  槽位数据提供者（host 侧执行插件回调，向 UI 供 T0 数据）        │
└────────────────────────────────────────────────────────────┘
```

- **T0（默认档）**：插件声明槽位元数据（标题/图标/命令/链接）或提供**数据**（动态文本、动作列表），UI 由宿主渲染。插件无需任何前端代码，任意语言可实现。
- **组件档**：插件 TSX 组件经内部 SSR 动态加载——主进程 jiti 加载（零构建）→ `ReactDOMServer` 渲染为 HTML 片段 → 注入渲染层槽位，交互事件回传主进程处理后局部替换；与内置零割裂（见 §5）。仅 T0 无法满足时启用。

### 2.2 目标文件树

```
desktop/apps/desktop/src/ui/
├── shell/
│   ├── store.ts            # 外部 store：shell/session 两域，useSyncExternalStore + 选择器
│   ├── events.ts           # 事件路由（runtime.event 分流、bus 订阅、CustomEvent）
│   ├── init.ts             # 启动时序（host 就绪 → 数据 → 闪屏退出 → ui-ready）
│   ├── chrome.tsx          # ShellSidebar / ShellHeader / ShellMain / ToastHost / DialogHost / Splash
│   ├── slots.tsx           # SlotName + SlotOutlet（渲染内置或插件贡献，含 loading/empty/error 态）
│   ├── registry.ts         # 视图+槽位统一注册表（现 views/registry.ts 上移合并）
│   ├── context-keys.ts     # when 子句上下文键求值器
│   └── styles/             # shell.css / sidebar.css / chat.css / settings.css（自全局样式拆出）
├── views/                  # ChatView 等：props 改从 store 选择器取（保留类名与 JSX 结构）
├── plugins/
│   ├── templates.tsx       # T0 白名单模板（badge/link/button/card/compact-row）
│   └── renderer.tsx        # 贡献 → 模板渲染；插件片段容器 PluginScan（R5 时扩展）
├── components/             # 现有原子组件不动
└── bridge.ts               # 不动（双通道已抽象好）
```

### 2.3 状态域划分（重渲染风暴对策）

- `shellStore`：view、侧栏收起/动画、status/idleStatus、toasts、闪屏、弹窗、`uiContributions`、槽位上下文键（context keys）、主题；
- `sessionStore`：sessions、workspaces、activeId、timeline、streaming、busy、busyIds、usage、attachments、prompt、sessionRef；
- 两个 store 用 `useSyncExternalStore` + 选择器订阅。**验收标准：`text_delta` 每 token 触发时，侧栏/顶栏零重渲染（React DevTools 实测）。**
- 视图内部瞬态（输入框焦点、滚动位置）留在视图组件本地，不进入 store。

---

## 3. 贡献契约 v2

### 3.1 槽位清单（ShellSlot）

| Slot | 宿主渲染 | T0 数据 | 组件档 |
|---|---|---|---|
| `view.registry` | 独立视图（现 M4 面板机制，保留） | 静态元数据 | 可用 |
| `sidebar.top` / `sidebar.foot` | 徽章/链接/紧凑行 | 动态文本可选 | 可用 |
| `header.actions` | 图标按钮 | 静态 | 可用 |
| `statusbar` | 状态 chip（**需动态文本**） | **必须有** | — |
| `chat.empty` | 空态卡片（对应 VS Code `viewsWelcome`） | 动作列表 | — |
| `chat.timeline.item` | **自定义时间链条目**（customType 白名单模板） | 插件数据经事件推送 | 可用（条目渲染） |
| `chat.composer.before` / `chat.composer.after` | 输入区上下提示条/工具条 | 可选 | 可用 |
| `chat.composer.actions` | 输入框按钮条 | 静态 | 可用 |
| `chat.meta` | 输入框下方状态区（usage chip 旁） | 推荐 | — |
| `settings.section` | 设置表单段（经 configuration 贡献） | schema | — |

**聊天框是核心**：`chat.*` 槽位（5 个）覆盖 ChatView 的拆分，是本节重点，见 §3.6。

### 3.2 when 子句（替换语义）

引用 VS Code 的 when 子句模型（最小语法子集）：

```
表达式 := 裸键/复合项 AND('&&')/OR('||') 组合；如：
  "aluka.activeView=='chat' && aluka.workspaceOpen"
```

上下文键（host 维护，插件只读）：

| 键 | 取值 |
|---|---|
| `aluka.activeView` | `chat` / `settings` / `extensions` / `plugin:*` |
| `aluka.workspaceOpen` | boolean（是否已选工作区） |
| `aluka.busy` | boolean |
| `aluka.modelSelected` | boolean |
| `aluka.sidebarCollapsed` | boolean |

**替换语义 = 条件声明 + 用户启停**（替代早期方案的静态 `replace` 字段）：内置贡献与插件贡献共存于同一槽位，`when` 求值 + 用户在贡献管理页的启停（将 context key 写入 用户/工作区 级别的槽位启用表）决定最终可见集合。内置贡献默认 enabled 且**可禁不可删**。

### 3.3 UiContribution v2 schema

```ts
/** 单源定义：agent/src/extensions/contracts/shell.ts（纯 TS，无 node 依赖） */
export const SHELL_SLOTS = [
  "view.registry", "sidebar.top", "sidebar.foot",
  "header.actions", "statusbar", "chat.empty", "chat.composer.actions",
] as const;
export type ShellSlot = (typeof SHELL_SLOTS)[number];

export interface UiContribution {
  id: string;                 // 全局唯一（跨扩展去重）
  version: 2;                 // 条目级版本（v1 兼容：v2 host 下 v1 贡献仍按视图面板渲染）
  title: string;
  description?: string;
  icon?: string;              // lucide 白名单名（未知回退拼图）
  command?: string;           // slash 命令，预填输入框
  url?: string;               // 外链
  slot: ShellSlot;            // v2 必填
  order?: number;             // 同槽位排序（小在前；内置 0-999，插件 1000+）
  when?: string;              // when 子句表达式
  uiModule?: string;         // v2 可选：组件档入口，相对插件根（如 "ui/Component.tsx"）
  uiVersion?: 1;             // @aluka/ui 契约版本（组件档）
  permissions?: Array<"session.read" | "session.write">; // 组件档权限声明，见 §5.4
  settings?: ConfigSchema;    // settings.section 槽位的 schema
}
```

### 3.4 两轨注册（manifest 轨优先）

| 轨道 | 载体 | 说明 |
|---|---|---|
| **manifest 轨（新）** | 插件根 `aluka-ui.json`（或 `package.json` 的 `aluka.ui` 字段） | **不执行插件代码**即可获得元数据；外部插件离线/损坏时槽位仍有占位与错误态 |
| **代码轨（既有）** | `pi.contributes(ui)` | 动态注册；与 manifest 轨同 id 时后者优先，代码轨同 id 注册被拒绝并告警 |

loader 校验（扩展自 `agent/src/extensions/loader.ts:469-484`）：slot 白名单、version 识别（未知版本整条忽略 + 告警）、id 重复、`when` 表达式语法解析失败即视为匹配失败（安全侧默认隐藏）。

### 3.5 单一来源与导入

- 契约定义在 `agent/src/extensions/contracts/shell.ts`（`SHELL_SLOTS` 常量 + 全部类型，**零 node 依赖**）；
- desktop UI 经 vite `resolve.alias`（`@aluka/shell-contracts`）+ tsconfig `paths` 引用该文件；desktop 主进程/host 沿用现状的相对路径 import agent 源码；
- 删除 `ui/types.ts` 中的 `UiContribution` 副本；
- 依赖方向保持：agent（上游）→ desktop（下游），禁止反向。

### 3.6 聊天框拆分（核心区域）

ChatView（`apps/desktop/src/ui/views/ChatView.tsx`，460 行）按区域映射为槽位与内部模块：

| ChatView 区域（行号） | 拆分归属 | 槽位/机制 |
|---|---|---|
| 时间线容器 + 自动滚动（156-280） | `TimelinePane`（shell 内部组件） | — |
| 空态 `chat-empty`（160-219，双态：未选工作区/已就绪） | `EmptyState` 内部组件 | `chat.empty` |
| 工具条目 `ToolCard`（221-227，tool 角色） | `ToolBubble`（保持内置） | — |
| 用户条目（228-262：图片/复制/时间） | `UserBubble`（保持内置） | — |
| 助手/系统条目（263-273） | `AssistantBubble` / `SystemBubble` | — |
| **自定义条目（新）** | `CustomBubble` | `chat.timeline.item` + 渲染器注册 |
| 流式输出 bubble（274-279） | `StreamingBubble`（保持内置） | — |
| 附件条（307-324） | `AttachmentStrip` 内部组件 | — |
| 输入框（325-347，粘贴/拖拽/Enter） | `ComposerInput` 内部组件 | — |
| 输入按钮条（348-446 左/右） | `ComposerActions` | `chat.composer.actions`（右区）、`chat.composer.before`/`.after`（上下） |
| 状态区 usage chip + ContextRing（448-454） | `ComposerMeta` | `chat.meta` |
| 图片查看器（457） | 保持壳级弹层 | — |

**自定义时间链条目链路（聊天框插件化第一契入点）**：

- **现状缺口**：agent 侧已有 `ExtensionAPI.appendEntry(customType, data)` / `sendMessage({ customType })` / `registerMessageRenderer(customType, renderer)` 能力，但 `DesktopRuntimeEvent` 投影时被过滤丢弃（`agent/src/desktop/runtime.ts:300-313` 仅放行 user/assistant），桌面 UI 不消费 customType——renderer 体系目前只服务于 TUI；
- **目标**：`DesktopRuntimeEvent` 新增 `entry_added`（`{ sessionId, customType, data }`，投影自消息/条目事件）；`TimelineItem` 增加 custom 分支（`role: "custom"` + `customType` + `customData`）；宿主按 customType 白名单模板渲染（T0 模板：卡片/表/日志/映射到内置 ToolCard 样式），组件档按条目渲染（`chat.timeline.item` 槽位）；
- 渲染器注册（T0）：`pi.contributes.define` 的 `renderStrategy: "template" | "builtin:toolcard" | …`；模板字段仍由宿主锁定，插件只出数据——与 §4 数据提供者模型同构；
- **兼容**：custom 条目在宿主无匹配渲染器时回退为"文本/JSON 摘要"条目，不打断时间线。

---

## 4. T0 数据提供者模型

状态栏等槽位需要**动态数据**（token 计数、分支名、插件自己的后端状态）。T0 不渲染插件代码，但插件（agent 进程内）可注册数据提供者：

```ts
// 扩展 API 新增（agent 侧）
pi.contributes({
  id: "my-counter",
  version: 2,
  title: "计数器",
  icon: "chart",
  slot: "statusbar",
  when: "aluka.workspaceOpen",
});
// 为槽位贡献注册数据提供者（宿主渲染时回调）
pi.contributesData("my-counter", ({ cwd }) => {
  return { text: "1,234 tok", kind: "info" };
});
```

- 数据流：宿主渲染槽位 → RPC `getSlotData(slot, contributionId)` → runtime 调插件回调 → 返回；UI 侧 3s 轮询保持动态（`refreshData` 推送通道预留，事件 `slot_data_changed` 已埋点）；
- **两种数据形态**：badge（text/kind，状态栏 chip）与列表（items/summary/empty，composer.before 等卡片类槽位的组件卡渲染）——白名单字段由 contracts 单源定义；
- 回调必须 try/catch + 超时（500ms），失败/缺失回退静态元数据，**绝不阻塞会话循环**；
- 组件档内该通道由 `@aluka/ui` 提供（RPC 白名单见 §5.4）。

白名单模板（宿主渲染，无插件代码）：

| 模板 | 字段 | 槽位适用 |
|---|---|---|
| `badge` | text, kind | statusbar / sidebar.* |
| `link` | title, url, icon | sidebar.* / chat.empty |
| `button` | title, command, icon | header.actions / composer.actions |
| `card` | title, description, icon, actions[] | chat.empty / sidebar.foot |
| `compact-row` | title, value, icon | sidebar.* |

---

## 5. 组件档：内部 SSR — 动态加载插件 UI 组件

> 修订说明（0.5）：「同树 React + import map」改型为**内部 SSR（服务器驱动 UI）**——插件组件的执行位置从渲染层移到**主进程（Node）**，与扩展同侧。插件 TSX 经 jiti 动态加载（零构建、任意 npm 依赖正常解析、直读 agent 数据），SSR 渲染为 HTML 片段注入渲染层，交互经事件回传主进程处理后局部更新。一举解决：插件组件不进渲染层 JS 环境（无 import map/externals/双 React 协调问题）、渲染层从不执行插件代码、样式与主题/滚动天然一致（无割裂感）、组件崩溃面局限在单体片段。

### 5.1 形态与执行模型

```
┌─ 渲染层（宿主 React SPA）─────────────────────────────┐
│  shell/chrome + SlotOutlet（PluginScan 容器）            │
│  <div data-aluka-plugin="<id>">…SSR HTML 片段…</div>      │
│  事件委托：click / change / submit → data-aluka-action    │
└──────────────┬──────────────────────────────────────────┘
               │ POST /ssr/<id>/render | /action（本地，~ms）
┌──────────────▼──────────────────────────────────────────┐
│ 主进程：内部 SSR 渲染器                                    │
│  jiti 动态 import 插件 TSX（与扩展同一加载机制，零构建）     │
│  ReactDOMServer.renderToString → HTML 片段（版本号）       │
│  组件动作处理器 → 改状态 → 重渲染 → 片段局部替换             │
└──────────────┬──────────────────────────────────────────┘
               │ 同进程
┌──────────────▼──────────────────────────────────────────┐
│ agent 运行时（会话/扩展/工具/数据，组件直读，无需 UI RPC）    │
└─────────────────────────────────────────────────────────┘
```

- 插件组件以 **TSX 源码**交付：`ui/Component.tsx`（默认导出组件工厂），主进程 jiti 加载——**作者零构建**；
- 组件与 agent 运行时同进程：直读宿主 API（会话/设置/用量/扩展数据），无 UI 侧 RPC/事件桥；
- `@aluka/ui` 为 **Node 侧包**：组件基元（`<Card/>` `<Badge/>` `<Action/>`）、类型与工具函数——浏览器侧 import map/externals 概念整体消失；
- 渲染层**不加载、不执行插件 JS**：片段以 HTML 注入（`dangerouslySetInnerHTML`，数据来自本地可信服务）。

### 5.2 组件契约（渲染 + 动作 + 状态）

```tsx
// ui/Component.tsx —— 零构建；宿主以 jiti 加载
import { Action, Card, Badge } from "@aluka/ui";
import type { PluginComponent } from "@aluka/coding-agent";

const component: PluginComponent = {
  render: (ctx) => (
    <Card>
      <Badge kind="info">{ctx.state.count} tok</Badge>
      <Action name="inc"><button>+1</button></Action>
    </Card>
  ),
  actions: {
    inc: async (ctx) => { ctx.state.count++; await ctx.changed(); },
  },
  serialize: (ctx) => ctx.state,
  restore: (ctx, s) => { ctx.state = s; },
  unmount: (ctx) => { /* 清理计时器 */ },
};
export default component;
```

- **渲染 = 纯函数**（读 `ctx.state` / `ctx.session` / `ctx.settings`…）；**交互 = actions 表 + `<Action name>` 元素**（SSR 输出 `data-aluka-action`，渲染层事件委托收集回传）；
- 状态在主进程内存（插件工厂闭包），同扩展进程直读 agent 数据；热重载 serialize/restore；
- **高频交互（连续输入/逐 token 流式）不适用本档**——此类区域保持宿主内置组件；插件动作自行合并/防抖（本地往返 ~ms 级）；
- 大列表强制宿主 `<VirtualList/>` 或分页；单贡献点渲染/动作超时（渲染 100ms / 动作 2s）→ 回退 fallback；
- 样式：只消费 CSS token（`--aluka-*`）与 `@aluka/ui` 类；根元素类前缀 `aluka-plugin-<id>`；禁止全局样式注入与 DOM 越界查询（约定，无运行时禁制）。

### 5.3 SSR 渲染协议

```
POST /ssr/<contributionId>/render          → { html, version }
POST /ssr/<contributionId>/action          → { html?, version, events? }
    body: { name, payload }                 // events：toast（api.notify 透传）等

渲染层 PluginScan：捕获 click/input/submit → data-aluka-action → POST
  → 以 morphdom 替换容器（保留输入焦点）；输入类动作降级整块替换
```

- 每个贡献点渲染独立 try/catch + 超时 → 失败输出 `builtin:*` 模板 + 原因 toast（服务端 ErrorBoundary 语义），不影响其他区域与会话；
- `version` 单调递增防乱序；本地 HTTP（127.0.0.1 + token）往返 <5ms，morphdom 片段更新无闪烁。

### 5.4 生命周期

| 时机 | 行为 |
|---|---|
| 首次可视 | 懒加载：首次渲染该槽位时才 import 组件 + render；`view.registry` 例外（进入视图即渲染） |
| 隐藏/显示 | `chat.composer.actions`、`view.registry` 保活（片段常驻）；其余槽位卸载 |
| 热重载 | `reloadExtensions` → 组件工厂重建 → serialize → 卸载 → 重渲染（版本号递增） |
| 失败 | 加载/渲染/动作异常 → fallback 内置模板 + 提示，绝不空白 |

### 5.5 声明字段（组件档）

```ts
uiModule?: string;    // 组件 TSX 相对插件根（如 "ui/Component.tsx"）
uiVersion?: 1;        // 契约版本
permissions?: Array<"session.read" | "session.write">;  // 留档（§6）
```

---

## 6. 安全模型（延后；后续以插件补充）

**决策（0.4）**：v1 **不内建安全机制**。信任模型 = 插件与宿主同权（扩展本就以全权限运行于 agent 进程，组件档渲染在 UI 进程，不做额外限制）。安全不构成 v1 架构约束，占用只记一条：

| 项 | 说明 |
|---|---|
| 已有基础（保留） | http-server 的 token/Host/Origin/防穿越校验为通识保护，不新增不删除；贡献管理页（启停/来源标识 tooltip）保留 |
| 延后的机制 | RPC 白名单分级、强制权限确认、`@aluka/ui` API 面禁制、首启用确认、"伪装宿主 UI"防误用——**v1 均不做** |
| 补充路径（插件化） | 与 agent 侧 `guard.ts` 同一模式：工具调用拦截已有（`pi.on("tool_call")` + `block/reason`）；后续同一机制扩展 UI 动作审计、贡献来源校验、内容扫描——由安全类插件实现，不内置 |
| 留档 | `permissions` 声明字段保留值语义，供安全插件读取；v1 不强制 |

---

## 7. 版本与兼容（外部插件不可控）

| 机制 | 内容 |
|---|---|
| **条目级 version** | v1 贡献在 v2 host 下仍按视图面板渲染；未知 version 忽略+告警（现状延续，已正确） |
| **engines 声明** | 插件 manifest 可声明 `engines: { aluka: ">=0.2" }`，host 低于声明版本时贡献降级为提示 |
| **proposed 门控** | 槽位 API 首版标记 `proposed`，需用户（设置页）开启后才生效；稳定后转正 |
| **弃用不移除** | host 对旧字段只弃用（文档标记）不删，保证已发布插件可用 |
| **前后向矩阵** | 验收项：host v2 + 插件 v1 / 插件 v2 + 未来 host v3 均不崩溃 |
| **包名与兼容** | 移除 `@earendil-works/pi-coding-agent`（及其余旧别名）导入兼容（`agent/src/extensions/loader.ts:252-258`、`:327-336` 别名表与 `pi-compat.ts` 随重构删除），统一 **`@aluka/coding-agent`**；注意 loader 别名表需同步新增 `@aluka/coding-agent` → 同一兼容模块，v0.1 兼容期双名共存，v0.2 起仅新名。外部插件规范见 [external-plugin-spec.md](./external-plugin-spec.md) |

---

## 8. 里程碑

| 阶段 | 内容 | 验收 | 工期 |
|---|---|---|---|
| R1 | 契约单源 + v2：`contracts/shell.ts`（slot 枚举/类型）、代码轨 v1/v2 校验、UI 别名接入、删 UI 副本、包名 `@aluka/coding-agent`、v1 兼容测试 | 两侧 tsc；greet 改 v2；plugin 用 v1 声明仍渲染 | ⏳ 部分完成（2026-08-23）：manifest 轨（aluka-ui.json 读取）未做 |
| R2 | shell 重写：store 两域 + events.ts + init.ts 迁移，App.tsx 降为装配 | 行为契约清单全过（§9.2）；流式下 chrome 零重渲染 | ✅（2026-08-23） |
| R3 | chrome 骨架 + SlotOutlet 渲染器 + 内置注册 `builtin:*`（header.actions / sidebar.top / sidebar.foot / statusbar）+ context-keys when 求值器 + plugins.css | 视觉逐项对照；内置不坏 | ✅（2026-08-23，CSS 全量拆模块延后——styles.css 保持原文件，仅新增 plugins.css） |
| R4 | T0 完整：白名单模板 + 数据提供者通道（getSlotData/slot_data_changed）+ **聊天框核心链路**（`entry_added` 事件投影 + TimelineItem custom 分支 + customType 模板白名单 + 无匹配回退）+ configuration 贡献（设置表单段）+ 贡献管理页（启停/when 求值/回退态） | greet 迁移 header.actions 与 chat.empty；**插件向时间线插入自定义条目并渲染**；状态栏插件动态文本；禁用内置空态生效 | ⏳ 部分完成（2026-08-23）：✅ 聊天框核心链路（agent 钩子/事件投影/custom 气泡/回退摘要）+ manifest 轨（aluka-ui.json）+ chat.* 槽位接入（empty/before/after/actions/meta）+ **数据提供者通道**（contributesData/getSlotData RPC/500ms 超时/3s 轮询）；✅（2026-08-23 补齐）：configuration 设置贡献（ConfigSchema 契约 + loader 前缀/形状校验 + pluginSettings 落盘 + `pi.getPluginSetting` 读取 + 设置页自动渲染表单段 + patchPluginSetting RPC）+ 贡献管理页（ExtensionContributionsPanel：清单/when 求值显示/启停开关，localStorage 禁用集合，SlotOutlet 与菜单同步过滤）|
| R5 | 组件档（内部 SSR）：主进程 jiti 加载组件 + `ReactDOMServer` 渲染器 + `/ssr` 路由 + `<Action>` 事件协议 + morphdom 片段替换 + 超时/失败回退 | TSX 示例组件（计数器/表格）直接载入 `chat.composer.before` 并在点击后局部更新；组件异常回退内置且会话不受影响；开发者改 TSX 保存即生效（零构建 | ✅（2026-08-23；**实施调整**：SSR 渲染运行在 Node 子进程（`scripts/ssr-server.mjs`：jiti + esbuild 转 TSX + ReactDOMServer），aluka 主进程经 HTTP 桥接——aluka 无法加载 React CJS、其内 jiti import 不可用；`@aluka/ui` kit 为 `.mjs` 纯 createElement 实现；片段局部替换 v1 用整块 HTML 替换，morphdom 后置；打包 exe 形态后置评估；**窗口模式约束已实测**：GUI 桥不 await Promise（main/index.ts 注释）——所有数据型 RPC 必须同步返回（getSlotData 已同步化），长流程走 RPC 发起（{started}）+ emitToUi 事件回传（pluginui.render/action）；编译版（单文件 exe 无 Node）组件档自动回退 T0 数据模板（fallback），不红字报错 |
| R6（可选） | 主题贡献（resource_discover 的 themePaths 补通）、per-extension 错误隔离、包校验和 | 插件主题生效；扩展崩溃不拖垮会话 | 3-5 天 / 未定 |

**T0 完整版合计约 6 周（R1-R4）；含组件档合计约 9 周（R1-R5）。**

---

## 9. 风险与验收

### 9.1 风险清单

| 风险 | 对策 |
|---|---|
| 流式重渲染风暴 | 两域 store + 选择器；DevTools 实测 |
| 启动时序回归（闪屏最短时长/数据就绪/ui-ready） | 行为契约清单条目 + 独立验收 |
| ChatView 常驻挂载丢失（草稿/滚动） | R3 保持 `hidden` prop 挂载；清单显式验收 |
| 热重载竞态（外部插件增删） | 贡献表版本号 + 幂等 clear/register（沿用 M4 语义，扩展到 slot 级） |
| 契约漂移 | R1 单源；此后变更只改一处 + 两侧 tsc |
| 组件崩溃/加载失败 | 模板/组件双保险：T0 始终可用，组件档失败回退 |
| 恶意/误操作攻击面（伪装系统 UI 等） | 延后决策：v1 不做内建防护，由安全类插件补充（guard 模式）；仅保留来源标识与管理页 |

### 9.2 行为契约清单（终态验收用）

1. 打开会话 → 时间线加载 → 流式输出逐 token 渲染 → 完成后刷列表与用量；
2. 流式输入中关闭/切换侧栏 → 草稿与滚动位置保留；
3. 删除当前会话 → 自动切到最近会话/新建会话；
4. 扩展重载 → 贡献表重建 → 槽位即刻反映（增删/排序/停用）；
5. 浏览器模式（无 window.aluka）完整启动与实时事件更新；
6. 双通道冒烟：GUI 桥接与 HTTP 各一轮完整会话；
7. 插件目录被删/损坏 → 槽位回退内置模板 + 提示，不空白、不白屏；
8. 热重载后组件状态恢复（序列化往返）。

---

## 10. 与 VS Code 的映射（设计依据）

| Aluka | 对应 VS Code 机制 | 借鉴点 |
|---|---|---|
| ShellSlot | `viewsContainers` / `views` / `viewsWelcome` | 槽位化 + 空态贡献 |
| T0 元数据/数据 | `contributes` + TreeDataProvider/statusbar item | 宿主渲染、插件出数据 |
| when 子句 | `menus` 的 `when` + context keys | 声明式可见性，替代静态 replace |
| 组件档（现 T1） | Webview 的贡献点模型（注入 API / 生命周期 / Serializer）+ 服务器驱动 UI（RSC/HTMX 式：服务端渲染 + action 回传 + 片段替换） | 贡献点机制沿用；组件执行在 Node 侧（与扩展同侧），渲染层不执行插件 JS |
| 内置 `builtin:*` | `@builtin/*` 内置即扩展 | 狗粮验证的"内置=默认贡献" |
| configuration 贡献 | `contributes.configuration` | 设置表单自动渲染 |
| `chat.timeline.item` 自定义条目 | 自定义消息渲染（`registerMessageRenderer` / `appendEntry`，agent 现有能力扩到桌面） | 统一"数据在 agent、渲染在 host"的条目模型 |
| 两轨注册 | manifests（声明式） | 元数据不执行插件代码即可见 |
| 版本治理 | `engines.vscode` / proposed API / 弃用不移除 | 外部插件生态长期稳定 |

不借鉴：扩展宿主独立进程（大手术）、Marketplace 体系、语言/调试器/Notebook 等大类贡献点、数百 API 的面量。

---

## 11. 待办决策（执行前确认）

1. 组件档细节确认：片段替换库选型（推荐 morphdom）；高频交互边界（连续输入/流式区不开放组件档）是否接受？
2. **安全机制延后确认**：v1 不做内建安全（§6），防护全部以插件补充（guard 模式）——是否接受？
3. `settings.section` 配置贡献的 schema 语言（推荐 JSON Schema 子集，只读渲染）？
4. 槽位启用表的作用域：用户级（推荐）还是工作区级（VS Code workspace trust 变体）？
5. R6（主题贡献/错误隔离/校验和）是否纳入首期排期？

---

## 12. 修订记录

| 版本 | 日期 | 说明 |
|---|---|---|
| 0.1 | 2026-08-23 | 首版：完整重构前提 + 外部动态插件约束 + VS Code 借鉴 + T0/T1 分层 |
| 0.2 | 2026-08-23 | 版本兼容：移除 `@earendil-works/pi-coding-agent` 包名兼容，统一 `@aluka/coding-agent`（v0.1 兼容期双名共存） |
| 0.3 | 2026-08-23 | 组件档改型：iframe/srcdoc 沙箱 → 同树 React 组件框架（`@aluka/ui` 契约 + import map 单例 + Error Boundary 健壮性隔离），聚焦 chat.* 槽位拆分 |
| 0.4 | 2026-08-23 | 安全延后：v1 不内建安全机制（白名单/强制确认/API 禁制全部移除），防护后续以插件补充（guard 模式） |
| 0.5 | 2026-08-23 | 组件档改型为**内部 SSR**：插件 TSX 组件由主进程 jiti 加载并 SSR 渲染为片段（零构建/无 import map/externals/双 React；渲染层不执行插件 JS），动作回传 + morphdom 局部替换 |
| 0.7 | 2026-08-23 | 窗口模式适配：GUI 桥不 await Promise → getSlotData 同步化、组件档 RPC 改「发起+事件回传」；编译版无 Node → 组件档自动回退 T0 模板（PluginScan fallback） |
| 0.6 | 2026-08-23 | R5 落地：SSR 渲染下沉 Node 子进程（aluka 无法加载 React CJS）+ HTTP 桥接；esbuild 转插件 TSX + jiti 解析（jsx 转换问题）；kit 改 .mjs；TODO 插件升级目录形式 `ui/Component.tsx` 实例 |
