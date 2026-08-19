/**
 * UI 共享类型定义
 *
 * 渲染层各视图（对话 / 设置 / 扩展）与 App 壳之间传递的数据结构。
 * 仅放类型，不放运行时逻辑。
 */

/** 时间线消息项：对话中的一条消息 */
export type TimelineItem = {
  id: string;
  /** 消息角色：用户/助手/工具/系统 */
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  /** 工具调用时的工具名（仅 tool 类型） */
  toolName?: string;
  timestamp: number;
  toolCallId?: string;
  args?: unknown;
  resultText?: string;
  isError?: boolean;
  toolStatus?: "running" | "done" | "error";
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
  note: string;
};

/** 扩展 UI 请求：扩展可通过此机制与用户交互 */
export type ExtensionUiRequest =
  | { id: string; kind: "notify"; message: string; level: "info" | "warning" | "error" }
  | { id: string; kind: "confirm"; title: string; message: string }
  | { id: string; kind: "select"; title: string; options: string[] }
  | { id: string; kind: "input"; title: string; placeholder?: string };

/** Toast 通知项 */
export type Toast = { id: number; message: string; level: "info" | "warning" | "error" };

/** 顶层视图切换状态 */
export type ShellView = "chat" | "settings" | "extensions";

/** 插件市场条目（searchPackages RPC 结果，pi 生态 npm 包） */
export type MarketRow = {
  name: string;
  version?: string;
  description?: string;
  author?: string;
  monthlyDownloads?: number;
  keywords?: string[];
  npmUrl?: string;
  installed: boolean;
};

/** 已安装插件条目（listInstalledPackages RPC 结果） */
export type InstalledPkg = { name: string; version?: string; description?: string };
