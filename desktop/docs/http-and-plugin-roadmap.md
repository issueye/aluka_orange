# Aluka Desktop — HTTP 服务与前端插件化路线图

> 制定日期：2026-08-23
> 前置讨论结论：
> 1. **后端形态**：主进程内嵌 HTTP 服务（Express 或 `node:http` 薄层），GUI 窗口经 `http://127.0.0.1:<port>` 加载页面；`window.aluka` 桥接由 WebView 注入、与页面来源无关（已在 aluka_lang 源码核实），窗口控制 / 无边框拖拽 / 缩放手柄不受影响。
> 2. **前端形态**：静态模板（Vite SPA 静态产物）完全可行；「动态」设计在客户端运行时（注册表 + 贡献点），不做服务端拼页。扩展性来自运行时机制，不来自页面是否动态生成。

## 总体架构

```
┌─ GUI 壳（WebView2，无边框/托盘/原生对话框）──────────┐
│  页面来源：http://127.0.0.1:<port>/?token=…           │
│  window.aluka 桥接仍由壳注入（窗口控制 / 拖拽 / 缩放）  │
└───────────────┬───────────────────────────────────────┘
                │ HTTP(REST) + WebSocket
┌───────────────▼───────────────────────────────────────┐
│  主进程 HTTP 服务                                       │
│  - 静态目录 dist/ui                                    │
│  - POST /rpc/:method  → 复用 registerRPC handler 表     │
│  - WS  /events        → 转发 win.emit 事件             │
│  - 127.0.0.1 + 随机端口 + token + Origin/Host 校验      │
└───────────────┬───────────────────────────────────────┘
                │ 现有 DesktopHost / DesktopRuntime
┌───────────────▼───────────────────────────────────────┐
│  agent 运行时（会话 / 扩展 / 技能 / 模型配置）           │
└───────────────────────────────────────────────────────┘

前端内部（静态壳）：
  ViewRegistry（视图注册表）→ 侧栏菜单 / 顶栏标题 / 视图切换
  M4 起：扩展 manifest contributes.ui 经运行时注册 API 挂入同一张表
```

## 里程碑

### M1 — 壳视图注册表（前端解耦，零行为变化）

**内容**
- 新增 `src/ui/views/registry.ts`：`SHELL_VIEWS`（id / label / icon / order / inMenu / persistent）。
- `App.tsx` 侧栏底部菜单、顶栏标题、视图切换改为注册表驱动；chat 保持常驻挂载。
- 视图打开副作用（settings 打开时刷新设置与用量）收敛为 App 内 `openView()`。

**验收**：三个内置视图行为与现在完全一致；`tsc` / `vite build` 通过；预览截图比对无回归。

**为什么先做**：后续所有动态能力（浏览器模式、插件贡献点）都以注册表为挂载点；此步纯内部解耦、无风险。

### M2 — HTTP 后端服务 + GUI URL 加载 ✅（2026-08-23 完成）

**内容（按实际落地）**
- `src/main/http-server.ts`：基于运行时 `Aluka.serve`（无 node:http / WS upgrade）：
  - 静态目录 `dist/ui`（仅文本资产：html/js/css/svg/json/map）；
  - `POST /rpc/<name>`：复用 `app.registerRPC` 双注册的 handler 表，回包 `{ result }` / `{ error }`；
  - `GET /events?since=<seq>`：**长轮询**（挂起至有新事件或 20s 超时，环形队列 500 条）；
  - 安全：绑 127.0.0.1 随机端口、启动 token（query / `x-aluka-token` 头）、Host 校验（防 DNS rebinding）、Origin 校验（防跨站）、静态目录防穿越。
- `main/index.ts`：RPC 双注册（`registerRPC` 本地 helper）、事件扇出（`emitToUi` = win.emit + httpServer.emit）、GUI URL 按需切换（磁盘 dist/ui 存在 → `http://127.0.0.1:<port>/?token=…`；打包态回落 `aluka://`）；开发态打印 `http page:` 地址。
- `bridge.ts`：transport 自适应——有 `window.aluka` 走桥接，否则 HTTP（rpc → fetch，events → 长轮询循环，断线 1s 退避）；浏览器模式窗口控制为 no-op。
- 新增 `src/main/aluka-gui.d.ts`，tsconfig 纳入 `src/main`（主进程首次进入类型检查，顺手修复 4 个既有类型错误）。

**运行时（aluka_lang）配套修复**
- `alukaThen`：`then` 改用 `interpreter.CallWithThis` 以 Promise 为 this 调用（原实现丢失接收者导致 async handler 全部报 "then called on non-Promise" / 请求悬挂）；补拒绝路径回写 500。
- `Aluka.serve` 请求头补 `Host`（Go r.Header 不含 Host）。
- `Response.json` 默认 Content-Type 的 `headers.has/set` 同样改 CallWithThis。

**验证**
- 无头冒烟（`aluka.exe run scripts/http-smoke.ts` + curl）：静态 200 / 无 token 403 / RPC 往返 / 未知方法 404 / 伪 Host 403 / 跨站 Origin 403 / 目录穿越 404 / JS·CSS 资产 200 / 长轮询事件即时投递 —— 全部通过。
- 纯浏览器端到端（无 window.aluka）：UI 经 HTTP 传输完整启动；实时触发 usage 事件后用量 chip 1.5s 内更新。
- `go test ./internal/runtime/globals/` 通过；desktop `tsc` / `vite build` 通过。

**决策修订**
- D2 修订：~~WS 用 ws 包~~ → **长轮询**（`Aluka.serve` 无 upgrade 能力且响应同步写出；本地单客户端场景长轮询延迟可忽略，零依赖）。

### M3 — 开发工作流（HMR 免构建）✅（2026-08-23 完成）

**内容（按实际落地）**
- `npm run dev`（`scripts/dev.mjs`）：一键起无窗口后端（`ALUKA_HEADLESS=1`）+ vite dev server；`ALUKA_WINDOW=1` 可保留 GUI 窗口。
- 主进程支持 `ALUKA_HTTP_PORT` / `ALUKA_HTTP_TOKEN` 固定端口与 token（http-server 新增对应选项）；无窗口模式下托盘/窗口调用全部空安全。
- `vite.config.ts`：`/rpc`、`/events` 代理到后端（`changeOrigin` 重写 Host、剥掉 Origin 以通过安全校验）；端口默认 4560。
- `bridge.ts`：开发态 token 由 `VITE_ALUKA_TOKEN` 注入（页面查询串优先）。
- 原「构建后运行」流程保留为 `npm run dev:gui`。

**验收实测**
- `http://localhost:5173` 打开后经代理加载**真实 host** 数据（会话/工具卡片正常渲染）；
- `/events` 长轮询经代理工作（启动期 host.ready 事件即时返回）；
- 修改 `registry.ts` 文案 2.5s 内热更新到页面（React Fast Refresh），全程无需 `build:ui`。

### M4 — 插件 UI 贡献点（声明式，路线 A）✅（2026-08-23 完成）

**内容（按实际落地）**
- 扩展 API 新增 `pi.contributes(ui)`（v1 schema：`{ id, version: 1, title, description?, icon?, command?, url? }`）：
  - loader 侧校验（缺 id/title、version ≠ 1、id 重复 → 整条拒绝并 console.warn，不影响扩展其余注册）；
  - 贡献存储于扩展实例，`listUiContributions` RPC 汇总（跨扩展 id 去重 + 告警清单）。
- UI 侧：
  - `views/registry.ts` 开放运行时注册（`registerRuntimeView` / `clearRuntimeViews`，内置 id 优先、重复忽略）；`ShellView` 类型放宽支持 `plugin:<id>`；
  - `views/PluginPanel.tsx` 声明式面板：标题/描述/贡献元信息 + 「运行命令」（复用 `aluka:prompt-insert` 预填 `/<command> ` 并切回对话）+「打开链接」；
  - `App.tsx`：挂载与扩展重载后拉取贡献并同步注册表；停留的面板被移除时自动回对话；
  - 图标白名单映射（puzzle/terminal/book/wrench/chart，未知回退拼图）。
- 示例：`agent/examples/extensions/greet.ts` 声明 `greet-demo`（问候插件，命令 /hello），开发态默认加载。

**验收实测**（`npm run dev` 真实 host + vite HMR，浏览器端到端）
- `listUiContributions` RPC 返回 greet 贡献；侧栏出现「问候插件」菜单项（terminal 图标）；
- 点击菜单项 → 声明式面板渲染（标题/描述/id·版本·命令元信息）；
- 点击「运行命令」→ 视图切回对话、输入框预填 `/hello `、成功 Toast；
- agent vitest 无新增失败（既有 providers 8 失败不变）；两侧 tsc 通过。

**v1 边界（记录在案）**
- 贡献只含元数据，不含前端代码（沙箱组件属 M5）；
- `command` 以预填输入框方式交互（宿主不直接执行扩展命令处理器，保持 agent loop 单一入口）；
- 贡献 schema 未进 `PROTOCOL_VERSION` 全局协商（v1 以条目级 `version` 字段校验，M5 前再统一）。

### M5 —（远期，不承诺）沙箱组件

iframe / Worker 沙箱渲染插件提供的运行时组件，消息协议（props/events）与宿主通信。仅在 M4 声明式能力无法满足真实需求时启动。

## 决策记录

| # | 决策 | 理由 |
|---|------|------|
| D1 | 后端优先 `node:http` 薄层，Express 待路由/中间件需求出现再引入 | 单文件 exe 体积与启动；当前仅需静态 + REST + WS |
| D2 | WebSocket 优先用 `ws` 包（打包验证过 node_modules 可 bundle）；若体积敏感再手写握手 | 手写 WS 帧协议维护成本高 |
| D3 | 窗口内仍走 `window.aluka` 桥接做数据 RPC，浏览器模式才走 HTTP | 双通道并存期风险最小；统一到 HTTP 放到 M4 之后评估 |
| D4 | 不做服务端模板（SSR/EJS）；动态性全部在客户端注册表 | 本地优先 + GUI 壳场景无 SSR 动机；服务端拼页会堵死插件化 |
| D5 | 样式隔离：插件 UI 只消费 CSS token（`--border` 等），禁止依赖具体色值 | 主题切换对插件生效；为沙箱组件预留边界 |

## 里程碑与依赖关系

```
M1 视图注册表 ──► M4 插件 UI 贡献点 ──► M5 沙箱组件(远期)
      │
      └──► M2 HTTP 后端 ──► M3 HMR 开发流
```

M1 与 M2 可并行推进；M3 依赖 M2；M4 依赖 M1（M2 非强依赖，插件贡献在窗口内即可验证）。
