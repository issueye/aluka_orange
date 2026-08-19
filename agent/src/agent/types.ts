/**
 * Agent 类型定义
 *
 * 定义了 Agent 循环所需的所有核心类型：
 * - 消息类型（用户、助手、工具结果、自定义）
 * - 工具接口
 * - Agent 上下文和配置
 * - 事件类型（生命周期、消息流、工具执行）
 */

import type {
  AssistantMessage,
  AssistantMessageEvent,
  ContentBlock,
  ImageContent,
  LlmMessage,
  Model,
  TextContent,
  ThinkingLevel,
  ToolExecutionMode,
  ToolResultMessage,
  Usage,
  UserMessage,
} from "../ai/types.ts";

/** Agent 消息类型：可以是 LLM 消息或自定义消息 */
export type AgentMessage =
  | LlmMessage
  | CustomMessage
  | BranchSummaryMessage
  | CompactionSummaryMessage;

/**
 * 自定义消息
 * 由扩展生成的特殊消息类型，用于在对话中插入非标准内容
 */
export interface CustomMessage {
  role: "custom";
  /** 自定义消息类型标识符 */
  customType: string;
  /** 消息内容（文本或图片） */
  content: Array<TextContent | ImageContent>;
  /** 是否在 LLM 上下文中显示 */
  display?: boolean;
  /** 附加的元数据 */
  details?: unknown;
  timestamp?: number;
}

/** 切分支时对放弃路径的摘要，进入 LLM 上下文 */
export interface BranchSummaryMessage {
  role: "branchSummary";
  summary: string;
  fromId: string;
  timestamp: number;
}

/** 上下文压缩摘要，进入 LLM 上下文 */
export interface CompactionSummaryMessage {
  role: "compactionSummary";
  summary: string;
  tokensBefore: number;
  timestamp: number;
}

export const COMPACTION_SUMMARY_PREFIX = `The conversation history before this point was compacted into the following summary:

<summary>
`;

export const COMPACTION_SUMMARY_SUFFIX = `
</summary>`;

export const BRANCH_SUMMARY_PREFIX = `The following is a summary of a branch that this conversation came back from:

<summary>
`;

export const BRANCH_SUMMARY_SUFFIX = `</summary>`;

/**
 * 工具执行结果
 * @template TDetails - 工具返回的详细数据类型
 */
export interface AgentToolResult<TDetails = unknown> {
  /** 结果内容 */
  content: Array<TextContent | ImageContent>;
  /** 工具特定的详细信息 */
  details?: TDetails;
  /** 是否为错误结果 */
  isError?: boolean;
  /** 本次执行的 token 用量 */
  usage?: Usage;
}

/** 工具执行过程中的部分更新回调 */
export type AgentToolUpdateCallback<TDetails = unknown> = (partial: {
  content?: Array<TextContent | ImageContent>;
  details?: TDetails;
}) => void;

/** 工具调用请求 */
export interface AgentToolCall {
  /** 调用 ID，用于关联结果 */
  id: string;
  /** 工具名称 */
  name: string;
  /** 工具参数 */
  arguments: Record<string, unknown>;
}

/**
 * 工具定义接口
 * @template TParams - 工具参数类型
 * @template TDetails - 工具结果详情类型
 */
export interface AgentTool<TParams = unknown, TDetails = unknown> {
  /** 工具名称（唯一标识） */
  name: string;
  /** 显示名称 */
  label?: string;
  /** 工具描述（发送给 LLM） */
  description: string;
  /** 参数 Schema */
  parameters: unknown;
  /** 执行模式：串行或并行 */
  executionMode?: ToolExecutionMode;
  /**
   * 执行工具
   * @param toolCallId - 本次调用的唯一 ID
   * @param params - 工具参数
   * @param signal - 中止信号
   * @param onUpdate - 部分结果更新回调
   */
  execute(
    toolCallId: string,
    params: TParams,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
  ): Promise<AgentToolResult<TDetails>>;
}

/**
 * Agent 运行上下文
 * 包含 Agent 循环执行所需的全部状态
 */
export interface AgentContext {
  /** 系统提示词 */
  systemPrompt: string;
  /** 对话消息历史 */
  messages: AgentMessage[];
  /** 可用工具列表 */
  tools: AgentTool[];
}

/**
 * Agent 循环配置
 * 控制 LLM 调用的行为和参数
 */
export interface AgentLoopConfig {
  /** 使用的模型 */
  model: Model;
  /** 采样温度 */
  temperature?: number;
  /** 最大输出 token 数 */
  maxTokens?: number;
  /** 思考深度等级 */
  thinkingLevel?: ThinkingLevel;
  /** 上下文消息变换函数（扩展可修改消息列表） */
  transformContext?: (messages: AgentMessage[]) => Promise<AgentMessage[]> | AgentMessage[];
  /** 请求发送前的拦截钩子 */
  beforeProviderRequest?: (payload: unknown) => Promise<unknown> | unknown;
  /** 请求头修改钩子 */
  beforeProviderHeaders?: (headers: Record<string, string | null>) => void;
  /** 响应后的回调钩子 */
  afterProviderResponse?: (status: number, headers: Record<string, string>) => void;
  /** API Key */
  apiKey?: string;
  /** 自定义 API 基础 URL */
  baseUrl?: string;
}

/**
 * Agent 事件联合类型
 *
 * 覆盖 Agent 生命周期中的所有事件：
 * - agent_start/end: Agent 循环的开始和结束
 * - turn_start/end: 每轮对话的开始和结束
 * - message_start/update/end: 消息流式传输的各个阶段
 * - tool_execution_start/update/end: 工具执行的各个阶段
 */
export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start"; turnIndex: number; timestamp: number }
  | { type: "turn_end"; turnIndex: number; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end"; message: AgentMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: unknown; partialResult: unknown }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: unknown; isError: boolean };

/** 事件发送回调类型 */
export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;

/**
 * 将 Agent 消息列表转换为 LLM 可理解的消息格式
 * 自定义消息如果标记为 display=true，则转换为用户消息；
 * 否则被忽略（不发送给 LLM）
 */
export function convertToLlm(messages: AgentMessage[]): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (const message of messages) {
    if (message.role === "custom") {
      if (!message.display) continue;
      out.push({ role: "user", content: message.content });
      continue;
    }
    if (message.role === "compactionSummary") {
      out.push({
        role: "user",
        content: [{ type: "text", text: `${COMPACTION_SUMMARY_PREFIX}${message.summary}${COMPACTION_SUMMARY_SUFFIX}` }],
      });
      continue;
    }
    if (message.role === "branchSummary") {
      out.push({
        role: "user",
        content: [{ type: "text", text: `${BRANCH_SUMMARY_PREFIX}${message.summary}${BRANCH_SUMMARY_SUFFIX}` }],
      });
      continue;
    }
    out.push(message);
  }
  return out;
}

/**
 * 从消息中提取纯文本内容
 * 支持助手消息、用户消息、工具结果和自定义消息
 */
export function textFrom(message: AgentMessage): string {
  if (message.role === "compactionSummary" || message.role === "branchSummary") {
    return message.summary;
  }
  const parts = message.role === "toolResult" || message.role === "user" || message.role === "assistant" || message.role === "custom"
    ? message.content
    : [];
  return parts
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export type { AssistantMessage, ContentBlock, ToolResultMessage, UserMessage };
