# aluka_orange · Brand Spec

> 采集日期：2026-08-19
> 资产来源：母品牌 logo（E:\codes\go_projects\aluka_lang\aluka_lang\assets\logo.svg）、
> desktop/apps/desktop/src/ui/styles.css（双主题 token）
> 资产完整度：正式 logo 已选定 —— **方案 C「橙光剖面」**（2026-08-19 落地）

## 🎯 核心资产

### Logo（正式）
- **正式 logo：方案 C 橙光剖面** `variant-c-citrus.svg` — 橙子剖面 × 中心棱镜 A
- 已落地：
  - `desktop/apps/desktop/assets/icon.ico` — 7 尺寸（16–256px，PNG 条目），exe/窗口/托盘共用
  - `desktop/apps/desktop/src/ui/Logo.tsx` — UI 内联组件，已接入侧栏品牌位（替换原蓝绿渐变占位）

### 落选方案（存档，见本目录）
- 方案 A 橙棱镜：`variant-a-prism.svg` — 母品牌棱镜 A 的橙色换皮，家族延续最大化
- 方案 B 橙核：`variant-b-core.svg` + mark 版 `variant-b-mark.svg` — 扁平 A 单字标 + 终端光标断口
- 对比画廊：`index.html`（双击打开），整页预览：`preview.png`

### 母品牌参照
- Aluka 运行时 logo：多面棱镜「A」、青×品红双色翼、白晶尖、光桥、rx≈108/512 圆角方

## 🎨 辅助资产

### 色板（Orange 家族）
- 琥珀 #FFD166（高光/晶尖）
- 亮橙 #FF9E2C（左翼亮部）
- 主橙 #FF7A1A（主色，UI accent 候选）
- 焰橙 #F2600C（右翼/强调）
- 焦橙 #B32D0C（右翼暗部）
- 暖黑 #1F1410 / #170F09（图标底）
- 奶油 #FFF6EA（浅底方案背景）

### 字型
- UI：Inter / SF Pro Text / Segoe UI / Noto Sans SC（与 App styles.css 一致）
- Mono：SF Mono / Cascadia Code

### 签名细节
- 横杠右端 12px 断口 = 终端光标（方案 B 的产品属性表达）
- 中心白芯嵌母品牌最小棱镜 A（方案 C 的家族联系）

### 禁区
- 不用紫色/青色渐变（那是母品牌运行时的色谱）
- 不拉伸、不改色、不给 logo 加描边
- 小尺寸（≤24px）场景优先用方案 B，不用 A/C

### 气质关键词
- 温暖的性能 · 本地终端里的炉火 · 可靠 · 克制

## 后续可选
1. 把 UI `--primary` 从中性蓝调整为橙系（styles.css），让「orange」身份贯彻到按钮/焦点环
2. 关于页 / 设置页加入 Logo lockup（复用 `Logo.tsx`）
3. Windows 任务栏缓存图标可能需要重建图标缓存（ie4uinit.exe -show）才会刷新显示
