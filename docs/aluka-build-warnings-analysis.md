# Aluka 构建警告分析：动态 import 预编译告警与 ssr-embedded 缺失

> 适用版本：aluka 运行时可执行文件（aluka_lang 仓库）+ aluka_desktop（桌面壳工程）。
> 生成日期：2026-08-24。本文档用于在运行时项目（`E:\code\issueye\golang\aluka_lang`）中提交问题与修复建议。
> 现状（2026-08-24）：`ssr-embedded.mjs` 全链路与 node 桥形态已移除（plugin-ui 收敛为单一嵌入内核），第 5 条告警（ssr-embedded 缺失）已随构建脚本删除而消失；另两条「非静态动态 import」告警（`loader.ts`、`jiti.mjs`）按 §6.2 的 externals 方案继续跟踪，属运行时项目改进项。本文档正文保留作历史分析。

---

## 1. 背景与重现方式

aluka_desktop 执行单文件打包：

```bash
cd desktop/apps/desktop
npm run build:gui
# 等价于：
#   vite build
#   aluka build --compile --gui --web-dir dist/ui --outfile dist/AlukaDesktop.exe \
#     --icon assets/icon.ico src/main/index.ts
```

构建输出中出现的全部警告（共 5 条）：

```
aluka build: warning: ../../../../../agent/src/extensions/loader.ts: dynamic import with non-constant specifier cannot be precompiled; it will fail at runtime
aluka build: warning: ../../../../../agent/node_modules/jiti/lib/jiti.mjs: dynamic import with non-constant specifier cannot be precompiled; it will fail at runtime
aluka build: warning: plugin-ui.ts: dynamic import with non-constant specifier cannot be precompiled; it will fail at runtime
aluka build: warning: plugin-ui-core.tsx: dynamic import with non-constant specifier cannot be precompiled; it will fail at runtime
[build-gui] WARNING: ssr-embedded.mjs not found (src/main/ssr-out/ssr-embedded.mjs); run "node scripts/ssr-build.mjs" first
```

前 4 条出自 aluka 编译器（本文档主体）；第 5 条出自 aluka_desktop 的打包脚本 `scripts/build-gui.mjs`，属构建流程缺失（见 §5，非运行时问题）。

**当前事实**：打包产物（AlukaDesktop.exe）在缺失 `ssr-embedded.mjs` 时仍可启动，UI 正常（`ui-ready` 正常发出）。即这 4 条告警涉及的执行路径在现有运行场景中未被触发或未致命。

---

## 2. 告警语义：编译器当前的说法与依据

### 2.1 发出位置（运行时仓库）

`cmd/aluka/build.go`（约 365-368 行）：

```go
// T2-B4：无法静态解析的动态 import 构建期警告（产物运行时会失败）。
for _, key := range graphResult.UnresolvedDynamic {
    fmt.Fprintf(os.Stderr, "aluka build: warning: %s: dynamic import with non-constant specifier cannot be precompiled; it will fail at runtime\n", key)
}
```

### 2.2 判定逻辑（内部报告用）

`internal/bundler/graph/graph.go` `collectDeps`（约 425-462 行）：

- parser 将 `import(spec)` lower 为 `__import(spec)` 调用；
- `__import` 实参为字符串字面量 → 记录为静态依赖（`Dynamic: true`）；
- 实参可常量折叠（字符串拼接、无插值模板）→ 同样可静态解析；
- **否则**（变量、`pathToFileURL(...).href` 这类运行时计算值）→ 追加到 `UnresolvedDynamic`，即本告警。

```go
case "__import": // 动态 import() 经 parser lower 的形式
    if lit, ok := arg.(*ast.StringLit); ok { ... }
    if v, ok := astutil.FoldConst(arg); ok { ... }
    // 无法静态解析：构建期警告，产物运行时报错。
    *unresolved = append(*unresolved, key)
```

### 2.3 告警文案的问题

文案称「cannot be precompiled; **it will fail at runtime**」。但从运行时实现看，该断言**过强**：

- 运行时核心**支持**动态 import（见 §3）——非字面量 specifier 不会被丢弃，而是在运行时经模块加载器解析；
- 它真正无法保证的只有一点：**目标模块不会被预编译并打入 payload**，运行时能否解析取决于目标文件在目标机器上是否存在。

即正确的语义应为：

> 「该动态 import 未参与预编译/打包；运行时按 specifier 实时解析，请确保目标模块文件随产物分发。」

---

## 3. 运行时确实支持动态 import 的证据（运行时仓库）

| 位置 | 内容 |
|---|---|
| `internal/runtime/module/cjs.go`（约 117-120） | 每个模块注入 `__import` 全局：`parser 把 import(spec) lower 成 __import(spec)` |
| `internal/runtime/module/loader.go`（约 539+） | `makeImportFunc`：`__import` → `requireWithAttributes(spec, modulePath)` 走完整模块加载管线，返回命名空间对象（ESM/CJS/JSON 语义齐全） |
| `internal/runtime/module/fileurl.go` | 支持 `file://` URL 形式解析（本项目恰好大量使用 `pathToFileURL(...).href`） |
| `internal/runtime/module/dynamic_import_test.go` | 既有运行时动态 import 测试（CJS/ESM default/命名/命名空间） |

Conclusion：**告警条件（非字面量）≠ 运行时失败条件**。只要目标文件在运行时可解析（磁盘路径存在），该模式即可工作；运行时若解析失败，报的是模块未找到类错误，而非「动态 import 不支持」。

---

## 4. 四个触发点的逐一评估（aluka_desktop 侧）

| # | 触发模块（告警 key） | 源码位置 | 代码 | 用途 | 打包版是否必经 | 能否项目侧消除 |
|---|---|---|---|---|---|---|
| 1 | `agent/src/extensions/loader.ts` | 约 482 行 | `import(pathToFileURL(path.resolve(file)).href)` | 扩展加载（用户磁盘上的 .ts 扩展） | 是（安装扩展即触发） | 否，设计如此（同文件 476 行注释：打包 exe 无 node_modules，用原生 import() 加载 .ts） |
| 2 | `agent/node_modules/jiti/lib/jiti.mjs` | 第三方内部 | jiti 自身“编译后文件”的动态 import | TS 运行时加载器内部机制 | 打包版基本是死代码（loader.ts 在 Aluka 运行时走原生 import()，不创建 jiti 实例；node 桥走子进程不在图内） | 不能改第三方；**可考虑用 externals 排除** |
| 3 | `desktop/apps/desktop/src/main/plugin-ui.ts` | 130、139 行 | `import(pathToFileURL(embeddedPath).href)`、`import(pathToFileURL(modulePath).href)` | 加载嵌入内核 + 插件组件模块 | 是（插件组件渲染必经） | 否，核心机制 |
| 4 | `desktop/apps/desktop/src/main/plugin-ui-core.tsx` | 28 行 | `Promise.resolve().then(() => import(modulePath))` | 同上（贡献点组件加载） | 是 | 否，核心机制 |

要点：

- 第 1、3、4 项是「运行时按路径加载用户/扩展模块」的正规用法，**不应禁止，也不应要求改写为静态 import**（静态改写等于放弃动态扩展能力）。
- 第 2 项（jiti）与第 1 项同源：`loader.ts` 第 16 行**静态** `import { createJiti } from "jiti"` 把 jiti 整体拉进了依赖图，于是 jiti 内部的不定动态 import 也被扫出来。它随 payload 打包但运行时基本不使用（native 分支优先），属于「打了包但用不上」的冗余。
- `scripts/ssr-server.mjs`（node 桥服务）不在依赖图内（主进程以子进程方式 spawn，路径是字符串参量），其自身的 jiti 动态 import 未触发告警——这也佐证：**只要不进图就不会有这条告警**，为 externals 方案提供了直接对照。

---

## 5. 第五条告警（ssr-embedded.mjs not found）——项目侧，非运行时问题

`scripts/build-gui.mjs`（约 70-79 行）期望打包前已生成 `src/main/ssr-out/ssr-embedded.mjs`（嵌入内核：react/react-dom/plugin-ui-kit 的单文件 ESM，供单文件 exe 原生 import），否则告警且**不复制**到产物旁。

根因：`package.json` 的 `build:gui` 脚本链没有接入生成步骤：

```json
"build:gui": "npm run build:ui && node ./scripts/build-gui.mjs"   // 缺 ssr-build
```

而 `scripts/ssr-build.mjs` 头部注释声明「build:ui / build:gui 前自动执行」，实际并未接线。修复（已建议项目采纳）：

```json
"build:gui": "npm run build:ui && node ./scripts/ssr-build.mjs && node ./scripts/build-gui.mjs"
```

影响不止告警：缺内核时，打包版插件组件渲染（`plugin-ui.ts` 的 `startEmbedded()`）会失败，被 `prewarmPluginUi` 的 try/catch 静默吞掉，表现为插件面板空白。

---

## 6. 修复建议（运行时仓库侧）

### 6.1 短期：修正告警文案与级别（推荐先做）

位置：`cmd/aluka/build.go`（约 365-368 行）。

建议：
1. 将文案由「cannot be precompiled; **it will fail at runtime**」改为准确描述，例如：

   ```
   dynamic import with non-constant specifier is not precompiled; it will be resolved at runtime (ensure target modules are shipped with the artifact)
   ```

2. 级别降级为提示（informational），或提供开关（如 `--warn-as-error` 语义保留给安全敏感场景）。理由：该模式是运行时**官方支持的加载方式**（§3），并非错误。

### 6.2 中长期：externals / 排除声明

- 当前 `aluka build`（`cmd/aluka/build.go`）调研后未见 external/exclude 类选项。
- 建议新增构建选项（如 `--external <spec>`），使项目可将第三方模块（典型如 jiti）标注为外部依赖：不打包、不告警，运行时按需从运行机解析。对照证据：`scripts/ssr-server.mjs` 因不在图内而告警为 0。
- jiti 场景收益：aluka_desktop 打包产物将缩小（去掉 jiti 及其依赖），并消除第 2 条告警。

### 6.3 策略一致性（可选）

`internal/bundler/webemit/emit.go`（约 43 行）对同一条件（UnresolvedDynamic）在 web 目标是**硬错误**：

```go
return empty, fmt.Errorf("web target requires a string literal for dynamic import() (source %s)", ...)
```

而 `--compile / --gui` 路径只是**告警**。两者策略不一致，且 web 错误文案同样隐含「不允许」的假设。建议统一语义并文档化：静态目标 → 预编译；动态目标 → 运行时解析（web 目标无运行时加载器因此报错，compile/gui 有加载器因此仅提示）。

---

## 7. 验证方案（修复后回归）

1. **基础**：重新执行 aluka_desktop `npm run build:gui`，确认 4 条动态 import 告警变为提示或消失，`ssr-embedded.mjs` 复制成功（第 5 条告警由项目侧脚本修复验证）。
2. **动态 import 运行时路径（核心）**：打包版 exe 中——
   - 安装一个本地扩展（`.ts`），确认扩展可加载（走 `loader.ts:482` 的原生 import()）；
   - 渲染一个插件组件贡献点（走 `plugin-ui.ts:139` / `plugin-ui-core.tsx:28`），确认 HTML 片段正常返回；
   - 确认 `ssr-embedded.mjs` 缺失时插件面板按「错误回退」处理而非白屏。
3. **jiti 路径（如做了 externals）**：排除 jiti 后打包版重复上述 1/2，确认扩展（Aluka 原生 import 分支）与插件渲染不受影响；node 桥（ssr-server.mjs，dev 场景）仍可用。

---

## 8. 运行时仓库源码位置索引

| 关注点 | 位置 |
|---|---|
| 告警发出 | `cmd/aluka/build.go`（约 365-368，`UnresolvedDynamic` 遍历） |
| 告警判定（collectDeps） | `internal/bundler/graph/graph.go`（约 425-462；字段 65-66、收尾 336、344-353） |
| 运行时动态 import 实现 | `internal/runtime/module/loader.go`（约 539，`makeImportFunc`）；`internal/runtime/module/cjs.go`（约 117-120，`__import` 注入） |
| file:// URL 解析 | `internal/runtime/module/fileurl.go` |
| 运行时测试 | `internal/runtime/module/dynamic_import_test.go` |
| web 目标对照（错误 vs 告警） | `internal/bundler/webemit/emit.go`（约 43） |
| externals 支持检索结论 | `cmd/aluka/build.go` 无 external/exclude 选项（本文档撰写时） |