# Aluka Desktop — 外部插件规范

> 制定日期：2026-08-23
> 版本：0.1（规范预览）
> 修订：0.2 — 组件档改型为**内部 SSR**（插件 TSX 由主进程 jiti 加载并 SSR 渲染为片段，零构建）；安全机制延后（v1 不内建，后续以插件补充）；包名统一 `@aluka/coding-agent`
> 读者：外部插件作者（独立分发，不随项目打包）
> 关系：实现规范；内部架构与里程碑见 [shell-plugin-design.md](./shell-plugin-design.md)
> 包名：外部插件统一从 **`@aluka/coding-agent`** 导入扩展 API 类型；
> `@earendil-works/pi-coding-agent` 兼容**自 v0.2 起移除**（v0.1 兼容期两包名共存）。
>
> **合规说明**：本规范按「当前可用」与「规范预览」标注。
> 「当前可用」= 现有版本即生效；「规范预览」= 随 R1-R5 里程碑落地，届时另有发布说明。

---

## 1. 快速开始

在 `~/.aluka/agent/extensions/` 下新建插件目录（或单文件 `.ts`/`.js`）：

```
~/.aluka/agent/extensions/
└── my-greet/
    └── index.ts          # 或 index.js；单文件扩展可直接放上层的 .ts 文件
```

`index.ts`：

```ts
import type { ExtensionAPI } from "@aluka/coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.notify("my-greet 已加载", "info");
  });

  pi.contributes({
    id: "my-greet",
    version: 1,
    title: "问候插件",
    description: "侧栏面板示例",
    icon: "terminal",
    command: "hello",
  });

  pi.registerCommand("hello", {
    description: "Say hello",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Hello ${args || "world"}!`, "info");
    },
  });
}
```

保存后，点击桌面壳顶栏的「重载扩展」按钮（或扩展页里的刷新），侧栏出现「问候插件」菜单项。完成。

---

## 2. 插件包结构与安装

### 2.1 发现路径（按优先级）

| 路径 | 说明 |
|---|---|
| `~/.aluka/agent/extensions/` | 用户级，推荐 |
| `<workspace>/.aluka/extensions/` | 工作区级 |
| settings.json 的 `extensions` / `extraExtensions` | 显式路径列表（桌面「添加本地路径」写入这里） |
| settings.json 的 `packages`: `npm:name` / `git:org/repo` | 包管理安装 |

### 2.2 包结构约定

```
my-plugin/
├── index.ts               # 入口（目录形式要求 index.ts / index.js）
├── aluka-ui.json          # (v2 可选) 声明式 UI 贡献，见 §4.3
└── ui/                    # (组件档 可选) TSX 组件源码
    └── Component.tsx      # 主进程 jiti 加载（零构建），见 §6
```

- 单文件扩展：`my-plugin.ts` 直接放扩展目录（文件名即入口）；
- npm/git 包：`package.json` 的 `aluka.extension`（或 `aluka.extensions[]`）声明入口，回退 `main`/`exports`/`index.*`；
- 入口必须 `export default` 一个工厂函数：`(pi: ExtensionAPI) => void | Promise<void>`。

### 2.3 加载与热重载

- 插件在 **agent 进程内**加载（Node 环境，jiti/原生 import），拥有完整文件系统与网络能力；
- 添加/修改插件后必须手动触发「重载扩展」（顶栏按钮或扩展页），运行时不会自动监听文件变化；
- 重载 = 全新 ExtensionRuntime 重建：旧事件订阅全部废弃，所有注册（工具/命令/贡献）从零重建。**插件不应依赖模块级长驻状态**。

---

## 3. 扩展 API 总览（当前可用）

工厂函数接收的 `pi` 实例（摘要；完整签名以 `agent/src/extensions/types.ts` 为准）：

| 类别 | API | 用途 |
|---|---|---|
| 事件 | `pi.on(event, handler)` | 订阅生命周期/工具/消息事件（如 `session_start`、`tool_call`、`agent_end`） |
| 工具 | `pi.registerTool(tool)` | 注册 agent 可调工具（typebox 参数 schema） |
| 命令 | `pi.registerCommand(name, opts)` | 注册 slash 命令（`/name`），可覆盖同名单内置命令 |
| UI 贡献 | `pi.contributes(ui)` | 声明 UI 贡献（本规范 §4） |
| 快捷键 | `pi.registerShortcut(keyId, opts)` | 注册快捷键 |
| 参数 | `pi.registerFlag(...)` / `pi.getFlag(name)` | 插件自有开关/参数 |
| 消息 | `pi.sendMessage(...)` / `pi.sendUserMessage(...)` / `pi.appendEntry(...)` | 向会话注入消息 |
| 会话 | `pi.setSessionName(...)` / `pi.getSessionName()` | 会话命名 |
| 模型 | `pi.setModel(...)` / `pi.setThinkingLevel(...)` | 运行期切换模型/思考档 |
| 供应商 | `pi.registerProvider(...)` | 注册模型供应商 |
| 执行 | `pi.exec(command, args, opts)` | 运行外部命令（返回结果对象） |
| 工具集 | `pi.getActiveTools()` / `pi.setActiveTools(...)` | 操作工具启用集 |
| 扩展上下文 | 事件回调第二参 `ctx.ui` | 与用户交互，见 §5 |

---

## 4. UI 贡献（contributes）

### 4.1 v1（当前可用）

```ts
pi.contributes({
  id: "my-plugin",          // 全局唯一；跨插件重复时后者被拒并 console.warn
  version: 1,               // schema 版本；宿主不识别的版本整条忽略
  title: "插件名",           // 必填
  description: "描述",       // 可选
  icon: "terminal",         // 可选：puzzle | terminal | book | wrench | chart（未知回退 puzzle）
  command: "hello",         // 可选：关联 slash 命令，「运行命令」预填 /hello 到输入框
  url: "https://…",         // 可选：面板「打开链接」
});
```

行为：宿主在侧栏附加「插件名」菜单项 → 打开声明式面板（标题/描述/元信息 + 运行命令/打开链接）。**不含前端代码，宿主模板渲染**。

### 4.2 v2 槽位贡献（规范预览，R1-R4 生效）

v2 在 v1 字段基础上增加槽位（slot）与可见性（when）：

```ts
pi.contributes({
  id: "my-counter",
  version: 2,
  title: "计数器",
  icon: "chart",
  slot: "statusbar",        // 槽位名，见下表
  order: 1000,              // 同槽位排序（小在前；内置 0-999，插件建议 1000+）
  when: "aluka.workspaceOpen", // 可见性条件，见 §4.2.2
});
```

#### 槽位清单

| Slot | 宿主渲染 | 需要数据 |
|---|---|---|
| `view.registry` | 独立面板（等价 v1 行为） | 否 |
| `sidebar.top` / `sidebar.foot` | 徽章/链接/紧凑行 | 可选 |
| `header.actions` | 图标按钮 | 否 |
| `statusbar` | 状态 chip | **必须有**（§4.4） |
| `chat.empty` | 空态卡片 | 推荐（动作列表） |
| `chat.timeline.item` | **自定义时间链条目**（customType 白名单模板，§4.5） | 插件数据经 `entry_added` 事件推送 |
| `chat.composer.before` / `chat.composer.after` | 输入区上下提示条/工具条 | 可选 |
| `chat.composer.actions` | 输入框按钮条 | 否 |
| `chat.meta` | 输入框下方状态区（用量 chip 旁） | 推荐 |

**聊天框是核心**：`chat.*` 槽位覆盖对话视图的拆分，其中 `chat.timeline.item` 允许插件向时间线注入自定义条目（agent 侧 `appendEntry` 已可用，桌面桥接随 R4 落地）。

#### when 子句语法

表达式：裸键、`&&`（与）、`||`（或）、`==`/`!=` 比较；例：

```
aluka.activeView=='chat' && aluka.workspaceOpen
```

| 上下文键 | 取值 |
|---|---|
| `aluka.activeView` | `chat` / `settings` / `extensions` / `plugin:*` |
| `aluka.workspaceOpen` | boolean |
| `aluka.busy` | boolean |
| `aluka.modelSelected` | boolean |
| `aluka.sidebarCollapsed` | boolean |

语法解析失败视为**条件不满足**（安全侧默认隐藏），不影响其他贡献。

### 4.3 manifest 轨（规范预览）

不执行插件代码即可展示元数据——在插件根放 `aluka-ui.json`：

```json
{
  "version": 2,
  "contributes": [
    {
      "id": "my-counter",
      "version": 2,
      "title": "计数器",
      "icon": "chart",
      "slot": "statusbar",
      "when": "aluka.workspaceOpen"
    }
  ]
}
```

- 与代码轨同 id 时 **manifest 轨优先**，代码轨该 id 注册被拒绝并告警；
- 适用场景：插件代码加载失败/被禁用时，槽位仍可显示占位与错误态；
- 无 `aluka-ui.json` 的 v1 插件不受影响。

### 4.4 数据提供者（v2：动态数据）

`statusbar` 等槽位需要动态文本（token 计数、分支名等）。v2 允许为贡献注册数据提供者：

```ts
pi.contributes({                       // 元数据（与 §4.2 同）
  id: "my-counter",
  version: 2,
  title: "计数器",
  icon: "chart",
  slot: "statusbar",
  when: "aluka.workspaceOpen",
});

// 数据提供者：宿主渲染时回调（同步返回、500ms 超时兜底）
pi.contributesData("my-counter", ({ cwd, id }) => {
  return { text: `${count} tok`, kind: "info" };   // kind: info | success | warning | error
});

// 列表形态（composer.before 等卡片类槽位 → 宿主渲染组件卡）
pi.contributesData("todo-app/board", () => ({
  summary: "待办 1/2",
  items: [
    { title: "#1 写周报", desc: "待办", state: "pending" },   // state: pending | done | error
    { title: "#2 修复构建告警", desc: "已完成", state: "done" },
  ],
  empty: "暂无待办 · 输入 /todo add 添加",
}));
```

**行为**：
- 宿主渲染该槽位时经 `getSlotData` RPC 拉取（超时/异常/缺失 → 回退贡献标题/静态模板，**不影响会话**）；
- UI 侧每 3s 轮询保持动态；`pi.refreshData(id)` 推送通道已预留（当前无需调用）；
- **约束**：回调同步返回、无副作用；状态保存在插件模块内部（注意 §2.3 热重载会重置）；返回数据仅限白名单字段（badge：text/kind；列表：items/summary/empty）。

### 4.5 时间线自定义条目（聊天框核心能力）

插件可向对话时间线注入**自定义条目**（当前可用，agent 侧 API）：

```ts
// 1) 给条目声明渲染器（TUI 已支持；桌面模板渲染 R4 生效）
pi.registerMessageRenderer("build-status", {
  render: (entry) => `构建 ${entry.data?.branch} → ${entry.data?.status}`,
});

// 2) 向时间线插入一条（触发 turn 或静默均可）
pi.appendEntry("build-status", { branch: "main", status: "ok" });
// 或包装为消息：
pi.sendMessage({ customType: "build-status", content: [{ type: "text", text: "构建完成" }] });
```

桌面侧行为（R4 生效）：

- `DesktopRuntimeEvent` 新增 `entry_added`（`{ sessionId, customType, data }`），时间线以 custom 角色条目渲染；
- 宿主按 customType 匹配**模板白名单**（卡片/表/日志风格，对应内置 ToolCard 视觉），插件只出数据；
- **无匹配渲染器时回退为文本/JSON 摘要**，不打断时间线；
- 强制约束：customType 命名建议 `my-plugin/item-name` 形式，跨插件隔离；条目数据应可 JSON 序列化（≤ 64KB）。

**警惕循环**：`appendEntry` 触发 turn 时要避免插件自身再次注入同类型条目（用 `options: { triggerTurn: false }` 默认静默）。

---

## 5. 交互 API（当前可用）

事件回调中的 `ctx.ui`：

| 方法 | 行为 | 响应 |
|---|---|---|
| `ctx.ui.notify(message, level)` | Toast 通知 | 无 |
| `ctx.ui.confirm(title, message)` | 确认框 | `Promise<boolean>` |
| `ctx.ui.select(title, options)` | 选择框 | `Promise<string \| undefined>` |
| `ctx.ui.input(title, { placeholder })` | 输入框 | `Promise<string \| undefined>` |

示例（工具拦截确认，见 `agent/examples/extensions/guard.ts`）：

```ts
pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "bash" && event.input.command.includes("rm -rf /")) {
    const ok = await ctx.ui.confirm("危险命令", `允许执行：${event.input.command}？`);
    return ok ? undefined : { block: true, reason: "已由 guard 扩展拦截" };
  }
});
```

---

## 6. UI 组件档：内部 SSR — 动态加载组件（规范预览，R5 生效）

T0（元数据/数据/面板）无法满足时，插件可提供**真正的 UI 组件**——无需构建、无需沙箱、与宿主 UI 零割裂。

> 设计取向：组件由**主进程（Node，内部 SSR 渲染器）**动态加载——`jiti` 直接加载插件 TSX 源码（与扩展同一加载机制，**零构建**），`ReactDOMServer` 渲染为 HTML 片段注入宿主；点击等交互回传主进程，组件处理并重渲染后再局部替换。渲染层不执行插件 JS，样式/主题/滚动与宿主完全一致。

### 6.1 资产形态

- 插件根 `ui/Component.tsx`（**TSX 源码交付**，无构建步骤；也可 `ui/Component.ts`）；
- 默认导出**组件对象**（`PluginComponent`）：

```tsx
// ui/Component.tsx
import { Action, Card, Badge, Button } from "@aluka/ui";
import type { PluginComponent } from "@aluka/coding-agent";

const component: PluginComponent = {
  // 渲染：纯函数，读 ctx.state / ctx.session / ctx.settings…
  render: (ctx) => (
    <Card>
      <Badge kind="info">{ctx.state.count} tok</Badge>
      <Action name="inc">
        <Button variant="secondary">+1</Button>
      </Action>
    </Card>
  ),

  // 动作：点击/提交回传后在这里处理，改状态后 ctx.changed() 触发重渲染
  actions: {
    inc: async (ctx) => {
      ctx.state.count += 1;
      await ctx.changed();
    },
  },

  serialize: (ctx) => ctx.state,   // 热重载时保存
  restore: (ctx, s) => { ctx.state = s; },
  unmount: (ctx) => { /* 清理计时器 */ },
};
export default component;
```

### 6.2 组件 API（`ctx` 上下文）

| 成员 | 说明 |
|---|---|
| `ctx.state` | 组件状态（主进程内存，可 serialize/restore） |
| `ctx.session` / `ctx.settings` / `ctx.usage` | 当前会话/设置/用量（**同进程直读**，无 UI RPC） |
| `ctx.changed()` | 标记状态变化 → 宿主重渲染该片段 |
| `ctx.notify/confirm/select/input` | 复用 `extension_ui` 通路 |
| `ctx.invoke(command)` | 预填 slash 命令 |
| `<Action name>` / `<Card/> <Badge/> <Button/> <Select/> <VirtualList/>` | 组件基元（`@aluka/ui`） |

**界限**（约定，非运行时禁制）：样式只消费 CSS token（`--aluka-*`）与 `@aluka/ui` 类；根元素类前缀 `aluka-plugin-<id>`；禁止全局样式注入与 DOM 越界查询；**高频交互（连续输入、逐 token 流式）不适合组件档**——此类区域保持宿主内置组件。

### 6.3 声明字段

```ts
pi.contributes({
  id: "my-panel",
  version: 2,
  slot: "chat.composer.before",
  uiModule: "ui/Component.tsx",   // 相对插件根
  uiVersion: 1,                   // 契约版本
  permissions: ["session.read"],  // 留档：v1 不读取不校验（安全延后）
});
```

### 6.4 生命周期与失败回退

| 时机 | 行为 |
|---|---|
| 首次可视 | 懒加载：首次渲染该槽位才 `jiti` import 组件；`view.registry` 例外 |
| 交互 | 点击 → 事件回传主进程 → `actions[name]` → 重渲染片段 → morphdom 局部替换（保留焦点） |
| 隐藏/显示 | `chat.composer.actions`、`view.registry` 保活；其余槽位卸载 |
| 热重载 | `serialize` → 工厂重建 → `restore` → 重渲染 |
| 组件异常 | 渲染/动作 try/catch + 超时（渲染 100ms / 动作 2s）→ 回退该槽位内置模板 + 提示，**不影响其他区域与会话** |
| 失败 | 加载失败/超限/语法错误 → 回退内置模板并显示提示，**绝不空白** |

> 开发体验：`npm run dev` 下改插件 TSX 保存，主进程 watch 并重渲染——即改即见（R5 达成，无需构建）。

---

## 7. 设置贡献（规范预览）

`settings.section` 槽位允许插件声明自己设置项（JSON Schema 子集）：

```json
{
  "id": "my-options",
  "version": 2,
  "slot": "settings.section",
  "settings": {
    "my-plugin.interval": { "type": "number", "default": 50, "label": "刷新间隔" }
  }
}
```

宿主在设置页自动渲染表单段并写回 `~/.aluka/agent/settings.json`（命名空间前缀 `my-plugin.` 隔离）。插件用 `pi.getFlag` 之外的设置读取 API（v2 预览）消费。

---

## 8. 版本兼容与安全边界

### 8.1 版本规则

- 贡献条目级 `version`：v1 依赖永远可用（宿主按 v1 面板渲染）；未知版本整条忽略并告警；
- `aluka-ui.json` 可选 `engines: { "aluka": ">=0.2" }`：不满足时贡献降级为提示；
- 插件发布策略：**只增字段，不改已有字段语义**；新增字段会被旧宿主忽略（安全）；
- 包名规则：类型导入统一 **`@aluka/coding-agent`**；`@earendil-works/pi-coding-agent` 兼容**自 v0.2 起移除**（v0.1 兼容期两包名共存）。旧插件需同步改 import，否则 v0.2 起解析失败——发布说明会给出迁移提示。

### 8.2 信任与约定（v1 无内建安全机制）

| 事项 | 说明 |
|---|---|
| 运行位置 | 插件代码在 agent 进程（Node）运行，**与宿主 UI 组件同权**；v1 不做白名单/权限强制（安全延后，由安全类插件补充——参考 `guard.ts` 拦截模式） |
| 社区公约 | 不伪装宿主 UI（如伪造"系统更新提示"）；所有贡献显示插件来源（图标/名/路径）并可一键停用（管理功能，非安全机制） |
| 热重载 | 添加/修改插件后手动重载；重载丢弃全部模块级状态 |
| 数据提供者 | `getData` 会被宿主以 500ms 超时调用，异常/超时回退静态元数据 |

### 8.3 常见被拒原因（loader 校验，console.warn）

- 缺 `id` / `title`；`version` 不是可识别值；`slot` 不在白名单；`id` 与已注册贡献重复；
- `when` 表达式解析失败（按不满足处理）；
- `uiModule` 文件缺失/超 2MB/加载校验失败（组件档）。

---

## 9. 调试

- **扩展页**：显示已加载扩展、工具、命令、技能、提示词清单与错误；
- **重载**：顶栏刷新按钮；日志去应用控制台（开发态 `npm run dev`）看 console.warn；
- **浏览器模式**：`npm run dev` 后浏览器打开 vite 地址，与 GUI 行为一致（窗口控制除外）；
- 常见故障链：文件没放对路径 → 重载后扩展页数量没变 → 看控制台告警 → 检查入口 default 导出与类型导入路径（**`@aluka/coding-agent`**；旧包名 `@earendil-works/pi-coding-agent` 自 v0.2 起会解析失败并报错）。

---

## 10. 完整示例（v2 槽位 + 数据提供者）

```ts
// ~/.aluka/agent/extensions/my-status/index.ts
import type { ExtensionAPI } from "@aluka/coding-agent";

export default function (pi: ExtensionAPI) {
  let totalTokens = 0;

  pi.contributes({
    id: "my-status",
    version: 2,
    title: "Token 计数",
    icon: "chart",
    slot: "statusbar",
    when: "aluka.workspaceOpen",
  });
  pi.contributesData("my-status", () => ({ text: `${totalTokens} tok`, kind: "info" }));

  pi.on("agent_end", () => {
    totalTokens += 1;                 // 宿主每 3s 轮询，无需主动推送
  });

  pi.contributes({
    id: "my-greet-panel",
    version: 2,
    title: "问候面板",
    slot: "view.registry",
    command: "hello",
  });

  pi.registerCommand("hello", {
    description: "Say hello",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Hello ${args || "world"}!`, "info");
    },
  });
}
```

配套 manifest（免执行代码即显示占位）：

```json
{
  "version": 2,
  "contributes": [
    { "id": "my-status", "version": 2, "title": "Token 计数", "icon": "chart", "slot": "statusbar" }
  ]
}
```

### 完整示例：聊天框插件（时间线自定义条目 + 输入区前条）

```ts
// ~/.aluka/agent/extensions/my-build/index.ts
import type { ExtensionAPI } from "@aluka/coding-agent";

export default function (pi: ExtensionAPI) {
  // 1) 时间线自定义条目：构建状态卡（宿主按模板渲染，插件出数据）
  pi.registerMessageRenderer("my-build/result", {
    render: (entry) => `构建 ${entry.data?.branch} → ${entry.data?.status}`,
  });

  // 2) 输入区上方提示条（T0 槽位贡献）
  pi.contributes({
    id: "my-build-bar",
    version: 2,
    title: "构建提示",
    slot: "chat.composer.before",
    when: "aluka.workspaceOpen",
  });

  // 3) 监听工具执行结束：构建类工具结果作为自定义条目回写时间线
  pi.on("tool_result", (event) => {
    if (event.toolName !== "bash" || !/npm run build/.test(event.result?.command ?? "")) return;
    pi.appendEntry("my-build/result", {
      branch: "main",
      status: (event.result?.code ?? -1) === 0 ? "ok" : "failed",
    });
  });
}
```

效果：构建命令执行后，时间线上出现「构建 main → ok」卡片；输入框上方常驻提示条。插件卸载后条目回退为摘要文本。

---

## 11. 相关文档

- [shell-plugin-design.md](./shell-plugin-design.md) — 内部架构与里程碑（R1-R5）
- [http-and-plugin-roadmap.md](./http-and-plugin-roadmap.md) — 已完成里程碑 M1-M4 记录
- `agent/examples/extensions/` — 官方示例（greet / guard / **todo**：v2 槽位 + 动态状态栏 + 时间线条目 + 命令/工具）
