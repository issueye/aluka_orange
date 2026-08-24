# 插件 UI 形态收敛：后续修改计划

> 配套文档：`docs/aluka-build-warnings-analysis.md`（构建告警分析）。
> 状态：第 0 步（核心改造）已完成——嵌入内核改为常量动态 import 直接加载 TSX，打包版实测通过；本文档规划剩余的「逐步」收敛工作。

---

## 1. 背景与目标

已完成（commit `72dc4d0`）：

- `plugin-ui.ts`：`startEmbedded()` 优先 `import("./plugin-ui-core.tsx")`（常量说明符，dev 走运行时 TSX 加载、打包版编入 payload），`ssr-embedded.mjs` 降级为回退；
- `plugin-ui-core.tsx`：`react-dom/server` → `react-dom/server.browser`（node 变体在 aluka 运行时依赖 `stream/crypto` 内置，抛 `undefined is not a constructor`）；
- `build-gui.mjs`：ssr-embedded 缺失提示降级为可选回退说明。

目标形态：**单一 embedded 分发**，无 node 桥、无预构建内核、无相关告警。

当前文件结构（`src/main/plugin-ui.ts`，改动前基线）：

```
Transport = "node" | "embedded"
├─ node 桥   ：spawn node scripts/ssr-server.mjs → HTTP /render /action /unload
│             （jiti + esbuild 转译插件 TSX；依赖运行机有 Node）
├─ embedded  ：常量 import("./plugin-ui-core.tsx")（已生效）
│             └─ 失败回退 import(ssr-embedded.mjs 磁盘文件)
├─ 强制 ALUKA_SSR=embedded（plugin-ui.ts:175）
└─ prewarmPluginUi()：启动时无条件预载内核
```

---

## 2. 修改项清单

| # | 修改项 | 涉及文件 | 优先级 | 目标 |
|---|---|---|---|---|
| M1 | 删除 node 桥形态 | `src/main/plugin-ui.ts`、`scripts/ssr-server.mjs` | 高 | 单一形态；payload 去掉 jiti/esbuild 链路；dev 与打包版行为一致 |
| M2 | 删除 ssr-embedded.mjs 全链路 | `scripts/ssr-build.mjs`、`scripts/build-gui.mjs`、`src/main/plugin-ui.ts` | 高 | 少一个构建步骤；消除回退分支 |
| M3 | 默认 importer 改为抛错 | `src/main/plugin-ui-core.tsx` | 中 | 消除该文件动态 import 告警；未初始化即渲染提前暴露 |
| M4 | 运行时 externals 支持（jiti 出图） | `aluka_lang`（另仓） | 低/外部 | 打包版瘦身；消除 jiti 告警（详见分析文档 §6.2） |
| M5 | 文档/脚本注释清理 | 各注释、`build-gui.mjs`、两篇 docs | 低 | 消除「自动执行 ssr-build」等过时描述 |

M1 与 M2 相互独立但建议同批执行；M3 可在 M1/M2 后顺手做。

---

## 3. M1：删除 node 桥形态

### 目的

- `ssr-server.mjs` 依赖 jiti + esbuild，是 jiti 进入 payload 的途经之一（另一处是 `agent/src/extensions/loader.ts` 的静态 import，属 Node 模式扩展加载，保留）；
- dev 与打包版目前走不同形态，行为分叉；embedded 已证明覆盖两种模式（dev `aluka run` 支持 TSX 运行时加载，用户已确认）。

### 改法（`src/main/plugin-ui.ts`）

1. 删除 `startNodeBridge()`、`forward()`、`stopSsr()` 的 child 管理部分、`resolveTransport()` 的 node 分支（约 64-121、149-186、274-284 行）。
2. `Transport` 类型与 `transport`/`transportPromise` 状态删除；`renderPluginComponent`/`runPluginComponentAction`/`unloadPluginComponent` 直接走 embedded：
   - 保留 `resolveTransport()` 名称（语义变为「确保内核可用」）或直接调用 `startEmbedded()`；建议保留函数名以缩小 diff：内部只做 `await startEmbedded(); return "embedded";`。
3. `ALUKA_SSR` 检查（约 175 行）删除（embedded 成为唯一形态）；若是为 A/B 回归保留，可改为仅当 `ALUKA_SSR=node` 时提示已移除。
4. 头部注释（1-12 行）改写为单一形态说明。
5. `scripts/ssr-server.mjs` 删除。

### 上下游影响

- `main/index.ts:12` import 的 `stopSsr` 若不再导出，同步删除引用；退出清理逻辑（`stopSsr()` 调用处）一并移除。
- `scripts/build-gui.mjs` 对 ssr-server 无引用，不受影响。
- 验证脚本 `scripts/http-smoke.ts` 是否依赖 node 桥渲染接口——如依赖，改为直连 embedded 或删除。

### 风险与验收

- 风险：dev 模式下插件组件渲染首次从「node 子进程」切换为「主进程内运行时 TSX 加载」，若运行时 TSX 加载有任何边界（如特定 JSX 语法），可能出现此前未暴露的问题。缓解：M1 合并窗口内用真实扩展在 dev 与打包版各回归一轮。
- 验收：
  - dev：`npm run dev` + 安装一个扩展（含 `ui` 贡献点）→ 组件正常渲染/交互/卸载；
  - 打包版：`npm run build:gui` → 运行 exe → 日志含 `[plugin-ui] core loaded from module graph`，插件面板正常；
  - `tasklist` 确认无残留 `node` 子进程（原 ssr-server）。

---

## 4. M2：删除 ssr-embedded.mjs 全链路

### 目的

- `ssr-build.mjs` 的 vite 库模式构建（react/react-dom 二次打包）与 payload 内已打包的 react 重复，纯冗余；
- 消除 `build:gui` 前「必须（或曾经必须）先生成内核文件」的步骤与相关提示。

### 改法

1. `scripts/ssr-build.mjs`、`src/main/ssr-out/`（如存在）删除。
2. `scripts/build-gui.mjs`：删除 70-79 行整段（ssrBundle 探测与拷贝）。
3. `src/main/plugin-ui.ts`：
   - 删除 `embeddedCandidates`、`findEmbeddedPath()`、`embeddedPath`（约 26-48 行）；
   - `startEmbedded()` 删除回退分支（约 128-136 行），直接 `await import("./plugin-ui-core.tsx")`。
4. `package.json`：`build:gui` 若曾被建议加 `ssr-build`，确认不加（脚本链保持 `build:ui && build-gui`）。
5. 检索并清理 `ssr-embedded` / `ssr-out` 的其余引用（README、docs）。

### 验收

- `npm run build:gui` 无任何 ssr 相关提示；
- 打包版运行日志为 `core loaded from module graph` 且无回退 warn；
- 从空工作区（无 `ssr-out/`）执行完整打包可直接产出可用 exe。

---

## 5. M3：默认 importer 改为抛错（消除 plugin-ui-core 动态 import 告警）

`src/main/plugin-ui-core.tsx:26-28` 现状：

```ts
/** 模块导入器（jiti 或 aluka 原生 import；支持插件 TSX 源码） */
let importer: (modulePath: string) => Promise<unknown> = (modulePath) =>
  Promise.resolve().then(() => import(modulePath));
```

`initCore` 在两种形态下都会被调用（embedded 在 `startEmbedded` 内、node 桥在 ssr-server 内），默认实现从不实际执行，但其中的 `import(modulePath)` 触发编译期动态 import 告警。

改法：

```ts
let importer: (modulePath: string) => Promise<unknown> = () =>
  Promise.reject(new Error("plugin-ui core used before initCore()"));
```

- 收益：`plugin-ui-core.tsx` 的告警消除（M1 完成后 `plugin-ui.ts` 的告警也已消除，桌面工程仅剩 `agent` 侧 loader.ts / jiti 两条）；
- 风险：无（行为上从「静默失败」变为「明确报错」，更利于发现未初始化调用）。

---

## 6. M4：运行时侧 externals（关联，另仓排期）

见 `docs/aluka-build-warnings-analysis.md` §6.2：`aluka build` 增加 externals/排除声明，使 jiti 可标注为外部依赖（不打包、不告警）。完成前提：确认 `agent/src/extensions/loader.ts` 在 Aluka 运行时走原生 import 分支（`loader.ts:477` 起），jiti 仅 Node 模式需要。

---

## 7. M5：文档与注释清理

- `plugin-ui.ts` / `plugin-ui-core.tsx` / `build-gui.mjs` 内关于「node 桥 / ssr-embedded / 自动执行」的注释，随 M1/M2 一并改写；
- 本文档与 `aluka-build-warnings-analysis.md` 的 §5（ssr-embedded 缺失）在 M2 后更新为「已移除」；
- `docs/http-and-plugin-roadmap.md` 中组件档运行时分发描述同步。

---

## 8. 建议执行顺序与总体验收

1. **M1 + M3 同批**（同一文件，避免反复 diff）→ dev + 打包版各回归一轮（含真实扩展）；
2. **M2**（构建链瘦身）→ 空工作区全量打包验证；
3. **M4** 交由运行时仓库排期，不阻塞 1/2；
4. **M5** 收尾。

总体验收清单：

- [ ] `npm run build:gui` 无警告（vite chunk 体积提示除外），无 ssr 相关输出
- [ ] 打包版 exe：启动日志 `core loaded from module graph`；扩展加载、插件组件渲染/交互/卸载正常；无残留子进程
- [ ] dev（`npm run dev`）：插件组件渲染正常，行为与打包版一致
- [ ] git 检索无 `ssr-server` / `ssr-embedded` / `ssr-out` / `ALUKA_SSR` 残留引用