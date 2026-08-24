/**
 * Phase 2 协议扩展（与 UI / Host 共用约定）
 */
export const PROTOCOL_VERSION = 1 as const;

export interface PingResult {
  ok: true;
  ts: number;
  protocolVersion: typeof PROTOCOL_VERSION;
}

export interface RuntimeInfo {
  protocolVersion: typeof PROTOCOL_VERSION;
  product: "aluka-desktop";
  productVersion: string;
  platform: string;
  arch: string;
  agentDirHint: string;
  phase: "0" | "1" | "2" | "3" | "4" | "5";
}

export interface SessionSummaryView {
  id: string;
  title: string;
  mtime: number;
}

export interface WorkspaceSessionView {
  id: string;
  title: string;
  mtime: number;
}

export interface WorkspaceView {
  path: string;
  name: string;
  temporary: boolean;
  sessions: WorkspaceSessionView[];
}

export interface TimelineItemView {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  /** 助手消息的思考内容（ThinkingContent 合并文本） */
  thinking?: string;
  toolName?: string;
  timestamp: number;
  toolCallId?: string;
  args?: unknown;
  resultText?: string;
  isError?: boolean;
  toolStatus?: "running" | "done" | "error";
}

export interface SettingsView {
  model?: string;
  provider?: string;
  baseUrl?: string;
  cwd?: string;
  lastSessionId?: string;
  theme?: "dark" | "light";
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  hasApiKey: boolean;
  extraExtensions?: string[];
  providerPreset?: "openai" | "anthropic" | "openai-compatible";
}

export interface ExtensionListItemView {
  path: string;
  tools: string[];
  commands: string[];
}

export interface ExtensionInventoryView {
  extensions: ExtensionListItemView[];
  errors: Array<{ path: string; error: string }>;
}

export interface SkillListItemView {
  name: string;
  description: string;
  path: string;
}

export type ExtensionUiRequestView =
  | { id: string; kind: "notify"; message: string; level: "info" | "warning" | "error" }
  | { id: string; kind: "confirm"; title: string; message: string }
  | { id: string; kind: "select"; title: string; options: string[] }
  | { id: string; kind: "input"; title: string; placeholder?: string };
