/**
 * 壳层插件契约（单一来源，零 node 依赖）
 *
 * - agent 侧：extensions/types.ts 的 UiContribution 与 loader 校验引用本文件；
 * - desktop UI：apps/desktop 经 vite alias（@aluka/shell-contracts）与 tsconfig paths 引用本文件；
 * - 修改本文件时两侧 tsc 同时受检，防止契约漂移。
 *
 * 内部架构与里程碑：desktop/docs/shell-plugin-design.md
 * 插件作者规范：desktop/docs/external-plugin-spec.md
 */

/** 槽位清单（同槽位排序：内置 0-999，插件建议 1000+） */
export const SHELL_SLOTS = [
  "view.registry", // 独立视图（现 M4 面板机制）
  "sidebar.top",
  "sidebar.foot",
  "header.actions",
  "statusbar", // 需动态数据（数据提供者）
  "chat.empty", // 空态卡片
  "chat.timeline.item", // 自定义时间链条目（customType）
  "chat.composer.before",
  "chat.composer.after",
  "chat.composer.actions",
  "chat.meta",
  "settings.section", // 设置表单段（configuration 贡献）
] as const;

export type ShellSlot = (typeof SHELL_SLOTS)[number];

/** T0 宿主模板白名单（插件只出数据，宿主渲染） */
export const SHELL_SLOT_TEMPLATES = [
  "badge",
  "link",
  "button",
  "card",
  "compact-row",
] as const;
export type ShellSlotTemplate = (typeof SHELL_SLOT_TEMPLATES)[number];

/** v1 声明式贡献：宿主按视图面板渲染（永久兼容） */
export interface UiContributionV1 {
  /** 全局唯一 id（跨扩展重复时后者被拒并告警） */
  id: string;
  /** 贡献 schema 版本；宿主不识别的版本整条忽略并告警 */
  version: 1;
  title: string;
  description?: string;
  /** lucide 图标名（宿主白名单映射，未知回退拼图图标） */
  icon?: string;
  /** 关联 slash 命令：面板「运行命令」把 /command 预填到输入框 */
  command?: string;
  /** 外部链接（面板「打开链接」） */
  url?: string;
}

/** 设置贡献（settings.section/configuration 槽位）schema 条目（JSON Schema 子集） */
export type ConfigValueType = "boolean" | "string" | "number" | "select";
export interface ConfigSchemaEntry {
  type: ConfigValueType;
  /** 设置页展示名 */
  label: string;
  description?: string;
  default?: string | number | boolean;
  /** type=select 的选项 */
  options?: string[];
  /** type=number 范围（可选） */
  min?: number;
  max?: number;
}
/** settings.section 槽位的 schema；key 必须以「贡献id + .」前缀（loader 校验） */
export type ConfigSchema = Record<string, ConfigSchemaEntry>;

/** v2 槽位贡献 */
export interface UiContributionV2 {
  id: string;
  version: 2;
  title: string;
  description?: string;
  icon?: string;
  command?: string;
  url?: string;
  /** 槽位名（SHELL_SLOTS 白名单，loader 校验） */
  slot: ShellSlot;
  /** 同槽位排序（小在前） */
  order?: number;
  /** when 子句表达式；解析失败视为不满足（安全侧默认隐藏） */
  when?: string;
  /** T0 宿主模板（SHELL_SLOT_TEMPLATES 白名单；缺省按字段形状推断） */
  template?: ShellSlotTemplate;
  /** 组件档入口，相对插件根（如 "ui/Component.tsx"；内部 SSR 加载） */
  uiModule?: string;
  /** 组件档契约版本 */
  uiVersion?: 1;
  /** 权限声明留档（v1 不读取不校验，供后续安全插件/审计消费） */
  permissions?: Array<"session.read" | "session.write">;
  /** settings.section 槽位的设置 schema（key 前缀约束见 loader 校验） */
  settings?: ConfigSchema;
}

export type UiContribution = UiContributionV1 | UiContributionV2;

/** 槽位数据提供者：宿主渲染 T0 模板时的动态数据源（白名单字段，两种形态） */
export interface SlotDataBadge {
  /** 展示文本（必填） */
  text: string;
  /** 展示语义，默认 info */
  kind?: "info" | "success" | "warning" | "error";
}
export interface SlotDataListItem {
  /** 条目标题 */
  title: string;
  /** 单行描述（可选） */
  desc?: string;
  /** 状态语义（默认 pending） */
  state?: "pending" | "done" | "error";
}
export interface SlotDataList {
  /** 列表条目（card 形态数据源） */
  items: SlotDataListItem[];
  /** 列表概要（如"待办 2/5"）；缺省用贡献标题 */
  summary?: string;
  /** 空态文案（items 为空时显示） */
  empty?: string;
}
export type SlotData = SlotDataBadge | SlotDataList;
export function isSlotDataList(data: SlotData): data is SlotDataList {
  return Array.isArray((data as SlotDataList).items);
}

/**
 * 组件档（内部 SSR）组件契约。
 * 插件根 `ui/Component.tsx` 默认导出 PluginComponent；
 * 由主进程 jiti 加载并以 ReactDOMServer 渲染为 HTML 片段（desktop/docs/shell-plugin-design.md §5）。
 */
export interface PluginComponentContext<State = unknown> {
  /** 组件状态（主进程内存；serialize/restore 往返） */
  state: State;
  /** 标记状态变化 → 宿主重渲染该片段 */
  changed(): Promise<void> | void;
  /** 宿主 toast 通知 */
  notify(message: string, level?: "info" | "success" | "warning" | "error"): void;
  /** 当前会话信息（cwd 等） */
  session?: { cwd?: string };
}
export interface PluginComponent<State = unknown> {
  /** 渲染为 React 元素（JSX）；读取 state/session，纯函数无副作用 */
  render(ctx: PluginComponentContext<State>): unknown;
  /** 交互动作（渲染层 data-aluka-action 回传） */
  actions?: Record<
    string,
    (ctx: PluginComponentContext<State>, payload?: unknown) => Promise<void> | void
  >;
  /** 热重载/卸载前保存状态 */
  serialize?(ctx: PluginComponentContext<State>): State;
  /** 重建时恢复状态 */
  restore?(ctx: PluginComponentContext<State>, state: State): void;
  /** 卸载清理（计时器等） */
  unmount?(ctx: PluginComponentContext<State>): void;
}
export type SlotDataProvider = (ctx: {
  slot: ShellSlot;
  cwd?: string;
  id: string;
}) => SlotData | undefined;

/** when 子句可用的上下文键（host 维护，插件只读） */
export const SHELL_CONTEXT_KEYS = [
  "aluka.activeView",
  "aluka.workspaceOpen",
  "aluka.busy",
  "aluka.modelSelected",
  "aluka.sidebarCollapsed",
] as const;
