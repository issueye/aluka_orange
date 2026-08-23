---
name: plugin-authoring
description: 指导生成 Aluka 插件（扩展）：工具、命令、事件钩子、UI 槽位与安装落地。当用户要求"写个插件/扩展/定制工具/给 agent 加能力/注册一个命令/做个工具扩展"时使用
---

# 插件（扩展）生成指南

用户要求生成或修改 Aluka 插件（扩展）时，按以下流程产出可直接运行的扩展文件。

## 插件是什么

- 插件即扩展（extension），pi-agent 兼容：`export default function (pi: ExtensionAPI) { ... }`
- 单文件 TypeScript，jiti 直接加载，无需编译；模块导入用 `@aluka/coding-agent`（别名：`@aluka/pi` 及 pi-coding-agent 系列兼容名）
- 能力面：`pi.registerTool`（工具）、`pi.registerCommand`（/ 命令）、`pi.on`（事件钩子）、`pi.contributes`（UI 槽位贡献）、`pi.appendEntry`（时间线条目）、`pi.setModel` / `pi.registerProvider`（模型与供应商）

## 安装位置

| 位置 | 作用域 |
| --- | --- |
| `{cwd}/.aluka/extensions/*.ts` | 当前工作区生效 |
| `~/.aluka/agent/extensions/*.ts` | 全局生效（所有工作区） |
| CLI `-e <path>` | 临时加载验证 |

仓库内参考示例统一放在 `agent/examples/extensions/`。落盘后需重启或重载扩展才生效。

## 生成步骤

1. **先读参照示例再写**（按需求选一个，风格保持一致）：
   - `agent/examples/extensions/greet.ts` — 最小完整插件：工具 + 命令 + UI 贡献 + 状态栏
   - `agent/examples/extensions/web_fetch.ts` — 抓取外部数据的工具扩展
   - `agent/examples/extensions/tavily.ts` — 外部 API 工具（API Key 经环境变量配置）
   - `agent/examples/extensions/guard.ts` — 事件拦截（危险命令确认）
   - `agent/examples/extensions/todo/` — 完整插件：工具 + 命令 + 组件卡 + 状态栏 + 设置 + 文件持久化
2. **写扩展文件**，要点：
   - 工具：`pi.registerTool({ name, label, description, parameters: Type.Object({...}), async execute(_id, params, signal, _onUpdate, _ctx) {...} })`。description 写清"何时用、怎么用"（agent 靠它决定调用）；成功返回 `{ content: [{ type: "text", text }] }`，失败返回 `isError: true`；必填参数在 execute 内校验
   - 命令：`pi.registerCommand("name", { description, handler: async (args, ctx) => ... })`，对应 `/name`
   - 事件：`pi.on("tool_call", async (event, ctx) => ...)`；返回 `{ block: true, reason }` 可拦截
   - UI 槽位（v2）：`pi.contributes({ id, version: 2, title, icon, slot, when })`，再 `pi.contributesData(id, provider)` 提供数据（badge 形态：text/kind；list 形态：items/summary/empty）。槽位白名单见 `agent/src/extensions/contracts/shell.ts`；常用槽位：statusbar（状态栏）、chat.composer.before（输入框上方组件卡）、settings.section（设置表单，settings 键必须以 `{id}.` 前缀）
   - 持久化：数据文件放 `~/.aluka/agent/data/<name>.json`，并提供 `ALUKA_*_DATA_FILE` 环境变量覆盖路径（照 todo 示例的 load/save 模式）
   - 命名避让内置工具：read / write / edit / bash / grep / find / ls / web_fetch
3. **验证**：在 agent/ 目录用 `npx tsx src/cli.ts -e <path> -p "..."` 冒烟测试；重启/重载扩展后在界面确认工具、命令已注册

## 行为偏好

1. **先读示例再写**：示例是契约的可执行参考，保持 typebox 参数、isError 返回、jiti 无编译等既有风格。
2. **单文件优先**：能用 `.ts` 单文件解决就不建目录；需要 `uiModule` 组件时才扩展为 `<name>/` 目录 + `ui/Component.tsx`（见 todo 示例）。
3. **输出要落地**：生成后告知用户文件路径、作用域（工作区/全局）和生效方式（重启/重载）。
4. **内置工具不动**：`agent/src/tools/` 是内置工具（defineTool + typebox），除非用户明确要求，新增能力一律走扩展文件。