# Aluka Desktop

Aluka GUI（WebView2）桌面壳 + [`aluka_pi`](../aluka_pi) Agent 运行时。  
绿场项目：对标 [Zeno](../aluka_pi_desktop) 的能力面，**不是** Electron 移植。

## 文档

- [明细开发计划](./docs/development-plan.md)

## 要求

- Windows 10/11 + WebView2 Runtime（推荐）
- [Aluka](https://github.com/aluka-lang/aluka) 本机构建产物（设 `ALUKA` 或加入 PATH）
- Node ≥ 22（仅 Vite 构建；运行时是 Aluka）

## 快速开始（Phase 5）

```powershell
cd E:\codes\go_projects\aluka_lang\aluka_lang
CGO_ENABLED=0 go build -o bin\aluka.exe .\cmd\aluka

cd E:\codes\ts_projects\aluka_desktop
npm run install:app
$env:ALUKA = "E:\codes\go_projects\aluka_lang\aluka_lang\bin\aluka.exe"
npm run build:ui
npm start
# 或冒烟：
npm run smoke
```

### 单文件打包

```powershell
$env:ALUKA = "E:\codes\go_projects\aluka_lang\aluka_lang\bin\aluka.exe"
npm run build:gui
# 产物默认：dist\AlukaDesktop.exe
```

说明：产物会内嵌 `aluka_pi` 源码图；扩展用 jiti 动态加载在打包态可能受限（构建时有 non-constant import 警告）。日常开发用 `npm start`；本地 packages 路径在用户机器上仍须真实存在。
## 功能摘要

| 能力 | 说明 |
|------|------|
| 会话 / composer | Phase 1 |
| 扩展 UI bridge | Phase 2（notify/confirm/select） |
| Settings 全页 | Phase 3（主题、provider 预设、本地 packages、npm install、models.json 只读预览） |
| 托盘 | 关闭 → 隐藏到托盘；托盘 Show / Quit；`Ctrl+Alt+A` 唤起 |
| 单文件 GUI | `npm run build:gui` |
| 会话导出 | 侧栏 Export → `~/.aluka/agent/exports/*.md`（亦支持 json/jsonl RPC） |
| 会话分享 | 侧栏 Share → secret gist（需 [GitHub CLI](https://cli.github.com/) + `gh auth login`） |
| Session usage | composer 底部 chip + Settings；汇总本会话 LLM `usage`（input/output/cache） |
| 鉴权 | **仅 API key**（Settings / 环境变量）；**不支持** OAuth / 实时 Provider 账户配额 |
| 更新检查 | Settings → Check for updates（需 `ALUKA_DESKTOP_RELEASES_URL`） |

### Packages 边界

- **Add path**：只写 `settings.json` 的 `extraExtensions` / `extensions`
- **Install**：在 `~/.aluka/agent/npm-packages` 执行 `aluka install <spec>`（`ALUKA` 可用时）或 `npm install <spec>`，再把解析到的入口登记为本地包
- 包需提供 `index.js/ts` 或 `package.json` 的 `main` / `aluka.extension`
- 支持 `file:./path`；registry 安装需网络
- 打包 exe 内扩展动态加载仍可能受限（jiti）

## 布局

```
apps/desktop           主进程 + Vite UI + Host
apps/desktop/assets    icon.ico
scripts/smoke.ps1      开窗冒烟
docs/development-plan.md
```
