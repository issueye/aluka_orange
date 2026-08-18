# Aluka Desktop 明细开发计划

> 日期：2026-08-18  
> 代号：`aluka-desktop`  
> 策略：**绿场重建**（不 fork Electron Zeno）  
> 运行时：**Aluka GUI**（WebView2）+ **`aluka_pi`**（Agent）  
> 对标产品：Zeno（`aluka_pi_desktop`）能力面，非代码移植  
> 仓库落点：`E:\codes\ts_projects\aluka_desktop`（与 Zeno / aluka_pi 并列）

---

## 0. 目标与非目标

### 0.1 目标

用 Aluka 单语言全栈桌面壳，承载 Codex 风格 Agent UI；Agent 后端唯一实现为 `aluka_pi`（扩展合同兼容 pi，配置默认 `~/.aluka/agent`，可选读 `~/.pi`）。

最终用户可感知能力对齐 Zeno：**会话、设置、扩展、包管理**（分阶段达到，非 Day-1 全量）。

### 0.2 非目标（明确不做）

| 不做 | 原因 |
|------|------|
| 复用 Electron main / preload / utilityProcess | Aluka GUI 模型不同 |
| 依赖 `@earendil-works/pi-coding-agent` | Agent 换成 aluka_pi |
| 完整 OAuth / MCP / session tree / share（首期） | 后置里程碑 |
| Linux GUI | Aluka 明确未支持 |
| electron-updater | 改 Release 手工/自研检查 |

### 0.3 已确认决策

| 项 | 决定 |
|----|------|
| 代码位置 | 并列仓 `aluka_desktop` |
| 依赖 aluka_pi | `file:../aluka_pi`（开发期） |
| 依赖 Aluka 运行时 | 本机 `aluka` 二进制（PATH 或 `ALUKA` 环境变量） |
| 包管理 | npm workspaces（构建 UI；运行时仍是 Aluka） |
| UI 策略 | 自研轻量 UI，信息架构参考 Zeno，**不**直接拷 Electron 版 renderer |
| 第一刀 | **Phase 0 + Phase 1**（空窗冒烟 → 可配置模型并完成一轮对话） |

---

## 1. 架构

```
┌──────────────────────────────────────────────────────────────┐
│  aluka 进程（主进程 = TS）                                     │
│                                                              │
│  apps/desktop/src/main/index.ts                              │
│    aluka:gui → createWindow / registerRPC / events           │
│         │                                                    │
│         │ window.aluka.rpc / events                          │
│         ▼                                                    │
│  WebView UI (Vite → dist/ui)  ←── aluka://app/*              │
│         │                                                    │
│         ▼                                                    │
│  packages/host  ←── packages/contracts                       │
│         │                                                    │
│         ▼                                                    │
│  aluka_pi（runAgentLoop / SessionManager / extensions…）     │
└──────────────────────────────────────────────────────────────┘
```

### 1.1 进程模型

- **单进程优先**：主进程 TS 与 Agent 同 VM，经 `app.registerRPC` 暴露 Host API。  
- **可选后续**：长跑 Agent 用 `child_process`/`Aluka.spawn` 隔离（Phase 4）；首期不做。

### 1.2 协议包 `@aluka/desktop-contracts`

语义对标 Zeno `@zeno/contracts` 的**子集**，命名用 `HostCommand` / `HostEvent`，但：

- 无 Electron `parentPort` 假设；
- 版本字段 `protocolVersion: 1`；
- 首期只定义 Phase 1 命令表（见 §3）。

### 1.3 目录布局

```
aluka_desktop/
├── docs/
│   └── development-plan.md          # 本文
├── apps/desktop/
│   ├── package.json                 # Phase 0：单包（避免 Windows symlink）
│   ├── src/main/index.ts            # Aluka GUI 主进程
│   ├── src/host/                    # Phase 0 Host（ping / runtimeInfo）
│   ├── src/shared/contracts.ts      # 协议类型
│   ├── src/ui/                      # Vite UI 源码
│   ├── dist/ui/                     # 构建产物（aluka:// 根）
│   └── scripts/run-aluka.mjs
├── packages/                        # Phase 1+ 再拆出 contracts/host（可选）
└── README.md
```

> Phase 0 已在 Windows 验证：`ui-ready` 事件可达，RPC 可点。
---

## 2. 里程碑总览

| Phase | 名称 | 工期估 | 依赖 | 完成定义 |
|-------|------|--------|------|----------|
| **0** | 工程骨架 + 空窗 | 0.5–1 天 | Aluka GUI | `aluka run` 开窗；UI 调通 `rpc.ping` |
| **1** | Host + 最小会话 | 2–4 天 | 0 + aluka_pi API 补强 | 设 API key/模型/cwd，多轮对话+工具事件上屏，会话落盘可恢复 |
| **2** | Extensions / Skills | 2–3 天 | 1 | 发现扩展/skills；greet 类扩展可用；confirm/select 走桌面 UI |
| **3** | Settings / Packages / Models | 3–5 天 | 2 | 设置页；自定义 OpenAI-compatible provider；本地/路径包或 `aluka install` 子集 |
| **4** | 桌面体验与打包 | 2–3 天 | 1+ | 无边框/托盘；`aluka build --gui --compile`；冒烟脚本 |
| **5** | 对标加深（可选） | 持续 | 3–4 | session export、usage、OAuth、MCP… |

**第一刀交付：Phase 0 + Phase 1。**

---

## 3. Phase 0 — 工程骨架（明细）

### 3.1 任务清单

| ID | 任务 | 验收 |
|----|------|------|
| P0-1 | 初始化 npm workspaces + TS | `npm install` 成功 |
| P0-2 | `packages/contracts`：`ping` / `getRuntimeInfo` 类型 | 可被 main/ui 引用 |
| P0-3 | `apps/desktop` 主进程：`setAssetDir` + `createWindow` + `registerRPC` | 参考 `demo/studio` |
| P0-4 | Vite UI：最小页面（标题、ping 按钮、结果显示） | `npm run build:ui` |
| P0-5 | 脚本：`dev`（先 build ui，再 `aluka run`） | 窗口出现且 ping 返回 |
| P0-6 | README：如何设置 `ALUKA` 路径、Windows 前提 | 文档可读 |

### 3.2 技术要点

```ts
// 主进程伪代码
import { app, createWindow, setAssetDir } from "aluka:gui";
setAssetDir("./dist/ui"); // 相对 cwd = apps/desktop
app.registerRPC("ping", () => ({ ok: true, ts: Date.now() }));
createWindow({ title: "Aluka Desktop", width: 1100, height: 720, url: "aluka://app/index.html", devTools: true });
app.run();
```

```ts
// UI
const r = await window.aluka.rpc.call("ping", {});
```

### 3.3 风险

- `aluka:gui` 仅 Windows/macOS 部分可用 → 文档标明 Windows 主验证。  
- `setAssetDir` 相对 cwd → 启动脚本固定 `cd apps/desktop`。

---

## 4. Phase 1 — Host + 最小会话（明细）

### 4.1 需在 `aluka_pi` 补强的 API（阻塞项）

| ID | API | 说明 |
|----|-----|------|
| PI-1 | `createDesktopRuntime(opts)` | 封装：extensions + tools + session + model + abort |
| PI-2 | `listSessions(dir)` / `openSession(id)` | 侧栏需要；现仅有 `latest`/`create` |
| PI-3 | `runtime.prompt(text)` → AsyncIterable/事件回调 | 投影 agent/tool 事件 |
| PI-4 | `runtime.abort()` | 停止当前 turn |
| PI-5 | 设置：读写 `~/.aluka/agent/settings.json` 子集（model、apiKey 源、cwd 上次） | 桌面设置页 |

实现位置：`aluka_pi/src/desktop/` 或 `src/runtime/host.ts`，由 desktop `packages/host` 调用。

### 4.2 Host RPC 命令表（v1）

| Method | 方向 | 用途 |
|--------|------|------|
| `ping` | UI→Host | 健康检查 |
| `getRuntimeInfo` | UI→Host | 版本、平台、agentDir |
| `getSettings` / `patchSettings` | UI→Host | 模型、provider、上次 cwd |
| `chooseWorkspace` | UI→Host | 调 `dialog.showOpenDialog` 选目录 |
| `listSessions` | UI→Host | 会话列表 |
| `createSession` / `openSession` | UI→Host | 新建/打开 |
| `sendPrompt` | UI→Host | 发送用户消息 |
| `abortPrompt` | UI→Host | 中止 |
| `runtime.event` | Host→UI（`win.emit`） | 流式事件 |

### 4.3 事件投影（Host→UI）

对齐用户可读时间线，不暴露 pi SDK 原语：

```
agent_start | message_start | text_delta | tool_start | tool_end | message_end | agent_end | error
```

映射自 `aluka_pi` `runAgentLoop` 的 callback 事件。

### 4.4 UI 最小信息架构（Phase 1）

1. **侧栏**：会话列表 + New Chat  
2. **主区**：消息时间线（user / assistant / tool）  
3. **Composer**：输入框 + Send / Stop  
4. **顶栏/设置抽屉**：API key（或提示用环境变量）、model、workspace 路径  

视觉：简洁深色/浅色均可，**不**追求复刻 Zeno 皮肤；避免通用 AI slop 紫渐变。

### 4.5 验收用例

| # | 步骤 | 期望 |
|---|------|------|
| 1 | 无 key 发消息 | UI 明确错误，不崩溃 |
| 2 | 设 `OPENAI_API_KEY` / settings 后 `-p` 等价一轮 | 有 assistant 文本 |
| 3 | 提示「列出当前目录」 | 出现 tool 卡片 + 结果 |
| 4 | 重启应用 | 会话仍在列表，可打开历史 |
| 5 | Stop | 中止进行中的 turn |

### 4.6 测试

- `aluka_pi`：Host API 的 `node:test` / `aluka test`（mock stream）。  
- desktop：contracts 类型测试；可选主进程 RPC 表驱动（无 GUI）。  
- 手工：Windows WebView2 冒烟清单（文档勾选）。

---

## 5. Phase 2 — Extensions / Skills

| ID | 任务 | 验收 |
|----|------|------|
| P2-1 | 发现路径与 Zeno/aluka_pi 一致 | 列出已加载扩展 |
| P2-2 | UI：扩展列表 + 错误展示 | 加载失败可见 |
| P2-3 | 注入 desktop UI bridge（notify/confirm/select） | greet + 需 confirm 的扩展可跑 |
| P2-4 | Skills 进 system prompt | 设置中可见 skills 计数 |

---

## 6. Phase 3 — Settings / Packages / Models

| ID | 任务 | 验收 |
|----|------|------|
| P3-1 | Settings 全页（模型、目录、主题） | 持久化 |
| P3-2 | 自定义 OpenAI-compatible provider | 可切换并对话 |
| P3-3 | Packages：至少「本地路径扩展」注册 | 重启仍在 |
| P3-4 | （可选）`aluka install` 包装 npm 包到 agent 目录 | 文档说明边界 |
| P3-5 | 导入 pi `models.json` 只读预览 | 不写回密钥到 UI |

---

## 7. Phase 4 — 体验与打包

| ID | 任务 | 验收 |
|----|------|------|
| P4-1 | 无边框 + 拖拽区 + 托盘 | 参考 studio demo |
| P4-2 | `aluka build --compile --gui --web-dir dist/ui` | 单 exe 可开 |
| P4-3 | `scripts/smoke.ps1` | ping + 开窗超时检测 |
| P4-4 | 更新检查（可选） | GitHub Release JSON |

---

## 8. Phase 5 — 对标加深

| ID | 任务 | 验收 |
|----|------|------|
| P5-1 | Session export（markdown/json/jsonl） | 写入 `agentDir/exports`，UI 可导出 |
| P5-2 | Session share（`gh gist create --public=false`） | 侧栏 Share；需本机 `gh auth login` |
| P5-3a | Session usage（token 汇总） | composer chip + Settings；RPC `getSessionUsage` |
| P5-3b | OAuth / 实时 Provider 配额 | **明确不做**：仅 API key；Settings 文案说明 |
| P5-3c | MCP / 多会话 | backlog |

- **Phase 5 状态（2026-08-18）**：导出 / gist 分享 / **session token usage** 已接通；OAuth 与实时账户配额明确 defer。

---

## 9. 依赖与版本

| 组件 | 版本策略 |
|------|----------|
| Aluka | 跟随本机构建的 `aluka_lang`（≥ 当前 main，需 GUI） |
| aluka_pi | `file:../aluka_pi`，Phase 1 起需要带 Host API 的分支/提交 |
| Node（仅工具链） | ≥ 22（Vite）；**运行时是 Aluka，不是 Node Electron** |
| npm | workspaces 管理 monorepo |

---

## 10. 实施顺序（第一刀）

```
1. 写本文并锁定目录布局          ← 本提交
2. Phase 0：workspace + 空窗 RPC
3. aluka_pi：PI-1…PI-5 Host API
4. packages/host 接 RPC
5. UI：侧栏 + 时间线 + composer
6. 端到端手工验收 §4.5
7. 再开 Phase 2
```

### 10.1 并行约束

- UI 可先用 mock Host（内存假事件）并行；接真 `aluka_pi` 前 contracts 冻结 v1。  
- 不改 Zeno 仓；最多文档交叉链接。  
- **Phase 0 状态（2026-08-18）**：空窗 + `ping`/`getRuntimeInfo`/`ui-ready` 已在 Windows 跑通。  
- **Phase 1 状态（2026-08-18）**：`aluka_pi` DesktopRuntime + 桌面会话/设置/composer 已接通；`host ready (phase 1)` / `ui-ready` 冒烟通过。完整 LLM 对话需配置 API key。  
- **Phase 2 状态（2026-08-18）**：扩展/skills 清单、desktop UI bridge（notify/confirm/select/input）、标题栏 Extensions 面板；开发启动默认加载 greet/guard。  
- **Phase 3 状态（2026-08-18）**：Settings 全页；本地路径包；models.json 只读预览；**npm/file: 包装 install → agent/npm-packages**（优先 `aluka install`，失败回退 `npm`）。  
- **Phase 4 状态（2026-08-18）**：系统托盘；`npm run build:gui`；`scripts/smoke.ps1`；可选更新检查。

---

## 11. 风险登记

| 风险 | 影响 | 缓解 |
|------|------|------|
| aluka_pi 能力远小于 pi SDK | Phase 3+ 延期 | 对外称「对标」非「兼容 Zeno」 |
| WebView2 未安装 | 无法开窗 | README 链到 Evergreen Runtime |
| 同 VM 跑 Agent 阻塞 UI 线程感 | 卡顿 | 长任务切子进程（Phase 4） |
| API key 进 settings 文件 | 安全 | 文件权限 + 永不 `win.emit` 回传明文到日志 |

---

## 12. 成功标准（第一刀结束）

1. 仓库 `aluka_desktop` 可 `npm install` + 构建 UI。  
2. `aluka run apps/desktop/src/main/index.ts`（或脚本）打开桌面窗。  
3. UI `ping` / `getRuntimeInfo` 成功。  
4. （Phase 1）配置 key 后完成至少一轮含工具的对话，会话可重启恢复。  
5. 本文档与 README 描述一致，无「假 Electron」表述。

---

## 13. 参考

- Aluka GUI：`aluka_lang/docs/aluka-gui-architecture-plan.md`，`demo/studio`，`demo/gui-demo`  
- aluka_pi：`E:\codes\ts_projects\aluka_pi`  
- Zeno（能力参考）：`E:\codes\ts_projects\aluka_pi_desktop`（只读）
