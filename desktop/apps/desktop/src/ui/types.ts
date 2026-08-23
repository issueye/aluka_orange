/**
 * UI 共享类型定义
 *
 * 渲染层各视图（对话 / 设置 / 扩展）与 App 壳之间传递的数据结构。
 * 仅放类型，不放运行时逻辑。
 */

/** 用户消息携带的图片附件（Base64 数据 + MIME 类型） */
export type TimelineImage = {
  data: string;
  mimeType: string;
};

/** 时间线消息项：对话中的一条消息 */
export type TimelineItem = {
  id: string;
  /** 消息角色：用户/助手/工具/系统 */
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  /** 用户消息携带的图片附件 */
  images?: TimelineImage[];
  /** 工具调用时的工具名（仅 tool 类型） */
  toolName?: string;
  timestamp: number;
  toolCallId?: string;
  args?: unknown;
  resultText?: string;
  isError?: boolean;
  toolStatus?: "running" | "done" | "error";
};

/** 输入框待发送的图片附件（含预览用 dataUrl） */
export type ImageAttachment = {
  id: string;
  name: string;
  /** 预览与发送共用的 data:image/... URL */
  dataUrl: string;
  /** Base64 数据（不含 data: 前缀） */
  base64: string;
  mimeType: string;
  size: number;
};

/** 会话摘要：用于侧边栏列表显示 */
export type SessionSummary = { id: string; title: string; mtime: number };

export type OpenedSession = {
  id: string;
  cwd: string;
  timeline?: TimelineItem[];
};

export type ChooseWorkspaceResult =
  | { cancelled: true }
  | ({ cancelled: false } & OpenedSession);

/** 设置视图：当前用户配置 */
export type SettingsView = {
  model?: string;
  provider?: string;
  baseUrl?: string;
  cwd?: string;
  theme?: "dark" | "light";
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  hasApiKey?: boolean;
  extraExtensions?: string[];
  providerPreset?: string;
  workspaces?: string[];
  /** 侧栏宽度（px）；未设置时用默认 288 */
  sidebarWidth?: number;
};

/** 模型选项：供模型选择器下拉列表使用 */
export type ModelOption = {
  provider: string;
  id: string;
  name?: string;
  api?: string;
  baseUrl?: string;
  /** 是否已配置 API 密钥 */
  configured: boolean;
};

/** 会话用量统计 */
export type SessionUsageView = {
  sessionId: string;
  totals: {
    input: number;     // 输入 token 数
    output: number;    // 输出 token 数
    cacheRead: number;  // 缓存读取 token 数
    cacheWrite: number; // 缓存写入 token 数
    totalTokens: number; // 合计 token 数
    calls: number;      // API 调用次数
  };
  estimatedCostUsd?: number; // 预估费用（美元）
  /** 最近一轮请求占用的 token（上下文占比环） */
  contextTokens?: number;
  /** 当前模型上下文窗口 */
  contextWindow?: number;
  note: string;
};

/** 全局用量统计：单模型行（agent 侧 usage-store.ts 的 UI 副本） */
export type UsageModelStat = {
  provider: string;
  model: string;
  input: number;        // 输入 token 累计
  output: number;       // 输出 token 累计
  cacheRead: number;    // 缓存读取累计
  cacheWrite: number;   // 缓存写入累计
  totalTokens: number;  // 合计 token
  calls: number;        // 调用次数
  share: number;        // 占全局合计的比例（0-1）
  estimatedCostUsd?: number; // 预估费用（美元；单价未知时省略）
  lastUsedAt: number;   // 最近使用时间戳（ms）
};

/** 全局用量统计：供应商分组 */
export type UsageProviderStat = {
  provider: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  calls: number;
  share: number;        // 占全局合计的比例（0-1）
  models: UsageModelStat[]; // 按 totalTokens 降序
};

/** 全局用量统计（getUsageStats RPC 结果，来自 ~/.aluka/agent/usage.json） */
export type UsageStatsView = {
  totals: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    calls: number;
  };
  estimatedCostUsd?: number;
  providers: UsageProviderStat[]; // 按 totalTokens 降序
  since: number;                  // 最早记录时间戳（ms）
  updatedAt: number;              // 最近记录时间戳（ms）
};

/** 扩展 UI 请求：扩展可通过此机制与用户交互 */
export type ExtensionUiRequest =
  | { id: string; kind: "notify"; message: string; level: "info" | "warning" | "error" }
  | { id: string; kind: "confirm"; title: string; message: string }
  | { id: string; kind: "select"; title: string; options: string[] }
  | { id: string; kind: "input"; title: string; placeholder?: string };

/** Toast 通知项（level：成功/信息/警告/错误） */
export type Toast = { id: number; message: string; level: "success" | "info" | "warning" | "error" };

/** 顶层视图切换状态（内置视图 + 运行时注册的插件视图 id，`plugin:<id>`） */
export type ShellView = "chat" | "settings" | "extensions" | (string & {});

/** 扩展 UI 贡献（listUiContributions RPC 结果条目，v1 声明式） */
export type UiContribution = {
  id: string;
  version: 1;
  title: string;
  description?: string;
  /** lucide 图标名（宿主白名单映射，未知回退拼图图标） */
  icon?: string;
  /** 关联 slash 命令：面板「运行命令」把 /command 预填到输入框 */
  command?: string;
  /** 外部链接 */
  url?: string;
};

/** 技能条目（listSkills RPC 结果） */
export type SkillItem = { name: string; description: string; path: string };

/** 提示词条目（listPrompts RPC 结果，含正文供插入输入框） */
export type PromptItem = { name: string; description: string; path: string; body: string };
