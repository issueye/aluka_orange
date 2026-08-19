/**
 * AI 类型定义
 *
 * 定义了与 LLM 交互所需的全部类型：
 * - 消息类型（用户、助手、工具结果）
 * - 内容块类型（文本、图片、工具调用、思考）
 * - 模型和提供商配置
 * - 流式传输事件类型
 * - Token 用量统计
 */

/** API 协议类型 */
export type Api = "openai-completions" | "anthropic-messages";

/** 思考深度等级（控制模型的推理深度） */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high";

/** 工具执行模式 */
export type ToolExecutionMode = "sequential" | "parallel";

/** 文本内容块 */
export interface TextContent {
  type: "text";
  text: string;
}

/** 图片内容块 */
export interface ImageContent {
  type: "image";
  /** Base64 编码的图片数据 */
  data: string;
  /** MIME 类型（如 "image/png"） */
  mimeType: string;
}

/** 工具调用内容块 */
export interface ToolCallContent {
  type: "toolCall";
  /** 调用 ID，用于关联工具结果 */
  id: string;
  /** 工具名称 */
  name: string;
  /** 工具参数 */
  arguments: Record<string, unknown>;
  /** 参数是否已完整接收 */
  argumentsComplete?: boolean;
}

/** 思考内容块（模型的内部推理过程） */
export interface ThinkingContent {
  type: "thinking";
  thinking: string;
}

/** 内容块联合类型 */
export type ContentBlock = TextContent | ImageContent | ToolCallContent | ThinkingContent;

/** Token 用量统计 */
export interface Usage {
  /** 输入 token 数 */
  input: number;
  /** 输出 token 数 */
  output: number;
  /** 缓存读取 token 数 */
  cacheRead?: number;
  /** 缓存写入 token 数 */
  cacheWrite?: number;
  /** 总 token 数 */
  totalTokens?: number;
}

/** 模型定价配置 */
export interface ModelCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * 模型配置
 * 描述一个 LLM 模型的完整能力参数
 */
export interface Model {
  /** 模型 ID（如 "gpt-4.1"） */
  id: string;
  /** 显示名称 */
  name: string;
  /** 提供商标识 */
  provider: string;
  /** API 协议类型 */
  api: Api;
  /** 自定义 API 基础 URL */
  baseUrl?: string;
  /** 是否支持推理/思考模式 */
  reasoning: boolean;
  /** 支持的输入类型 */
  input: Array<"text" | "image">;
  /** 定价信息 */
  cost: ModelCost;
  /** 上下文窗口大小（token 数） */
  contextWindow: number;
  /** 最大输出 token 数 */
  maxTokens: number;
  /** 自定义请求头 */
  headers?: Record<string, string>;
  /** 提供商兼容性参数 */
  compat?: Record<string, unknown>;
  /** 思考等级映射（用于不同提供商的等级名称转换） */
  thinkingLevelMap?: Record<string, string | null>;
}

/** 提供商响应头类型 */
export type ProviderHeaders = Record<string, string | null>;

/** OAuth 认证凭据 */
export interface OAuthCredentials {
  /** 访问令牌 */
  access: string;
  /** 刷新令牌 */
  refresh?: string;
  /** 过期时间戳 */
  expires?: number;
}

/** OAuth 登录回调 */
export interface OAuthLoginCallbacks {
  /** 授权 URL 回调 */
  onUrl?(url: string): void;
  /** 等待用户输入授权码 */
  onCode?(): Promise<string>;
}

/** 模型刷新上下文 */
export interface RefreshModelsContext {
  /** 发布更新 */
  publish?(entry: { persist?: unknown }): void;
  /** 中止信号 */
  signal?: AbortSignal;
}

/** 简化的流式调用选项 */
export interface SimpleStreamOptions {
  /** API Key */
  apiKey?: string;
  /** 中止信号 */
  signal?: AbortSignal;
  /** 请求体修改钩子（可同步或异步） */
  onPayload?(payload: unknown): unknown | Promise<unknown>;
  /** 响应回调 */
  onResponse?(status: number, headers: Record<string, string>): void;
}

/**
 * 助手消息
 * LLM 返回的完整响应消息
 */
export interface AssistantMessage {
  role: "assistant";
  /** 内容块列表（文本、工具调用等） */
  content: ContentBlock[];
  /** API 协议类型 */
  api?: Api;
  /** 提供商名称 */
  provider?: string;
  /** 实际使用的模型 ID */
  model?: string;
  /** token 用量 */
  usage?: Usage;
  /** 停止原因 */
  stopReason?: "stop" | "toolUse" | "length" | "error" | "aborted";
  /** 错误信息（仅在 stopReason 为 "error" 时） */
  errorMessage?: string;
}

/** 用户消息 */
export interface UserMessage {
  role: "user";
  content: Array<TextContent | ImageContent>;
  timestamp?: number;
}

/** 工具执行结果消息 */
export interface ToolResultMessage {
  role: "toolResult";
  /** 关联的工具调用 ID */
  toolCallId: string;
  /** 工具名称 */
  toolName: string;
  /** 结果内容 */
  content: Array<TextContent | ImageContent>;
  /** 是否为错误 */
  isError?: boolean;
  /** 工具特定的详细信息 */
  details?: unknown;
}

/** LLM 消息联合类型（用户、助手、工具结果） */
export type LlmMessage = UserMessage | AssistantMessage | ToolResultMessage;

/**
 * LLM 请求上下文
 * 包含发送给 LLM 的完整信息
 */
export interface Context {
  /** 系统提示词 */
  system?: string;
  /** 对话消息列表 */
  messages: LlmMessage[];
  /** 可用工具定义 */
  tools?: ToolSpec[];
}

/** 工具规格（发送给 LLM 的工具定义） */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: unknown;
}

/**
 * 助手消息事件联合类型
 * 流式传输过程中的各种事件
 */
export type AssistantMessageEvent =
  | { type: "start" }
  | { type: "text"; delta: string; content: TextContent }
  | { type: "thinking"; delta: string; content: ThinkingContent }
  | { type: "toolcall_start"; id: string; name: string }
  | { type: "toolcall_delta"; id: string; delta: string }
  | { type: "toolcall_end"; content: ToolCallContent }
  | { type: "done"; message: AssistantMessage }
  | { type: "error"; error: Error };

/** 助手消息事件的异步可迭代流 */
export interface AssistantMessageEventStream extends AsyncIterable<AssistantMessageEvent> {
  /** 获取最终的完整助手消息 */
  result(): Promise<AssistantMessage>;
}

/** 完整的流式调用选项 */
export interface StreamOptions extends SimpleStreamOptions {
  /** 采样温度 */
  temperature?: number;
  /** 最大输出 token 数 */
  maxTokens?: number;
  /** 思考深度等级 */
  thinkingLevel?: ThinkingLevel;
}

/**
 * LLM 提供商配置
 * 定义一个 API 提供商的连接参数和模型列表
 */
export interface Provider {
  /** 提供商 ID */
  id: string;
  /** 显示名称 */
  name: string;
  /** API 协议类型 */
  api?: Api;
  /** API 基础 URL */
  baseUrl?: string;
  /** API Key */
  apiKey?: string;
  /** 自定义请求头 */
  headers?: Record<string, string>;
  /** 是否在请求头中发送认证信息 */
  authHeader?: boolean;
  /** 该提供商支持的模型列表 */
  models?: Model[];
  /** 简化流式调用方法（可覆盖默认实现） */
  streamSimple?(model: Model, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream;
}

/**
 * 创建字符串枚举 Schema 工具
 * 用于定义工具参数中只允许特定字符串值的字段
 */
export function StringEnum<T extends string[]>(values: [...T], options?: { description?: string }) {
  return {
    type: "string",
    enum: values,
    description: options?.description,
  } as const;
}
