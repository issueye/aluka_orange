/**
 * AI 模块入口
 *
 * 导出 LLM 交互所需的所有类型、流式调用函数和 Schema 工具。
 * 支持 OpenAI 和 Anthropic 两种 API 协议。
 */

import { Type } from "typebox";

export { Type };

/** pi-ai/compat：内置供应商 id 列表（newapi 用它避免覆盖内置名） */
export function getProviders(): string[] {
  return [
    "openai",
    "anthropic",
    "google",
    "google-gemini-cli",
    "google-vertex",
    "amazon-bedrock",
    "azure-openai-responses",
    "groq",
    "cerebras",
    "xai",
    "zai",
    "minimax",
    "huggingface",
    "opencode",
    "github-copilot",
    "mistral",
    "openrouter",
    "vercel-ai-gateway",
  ];
}
export {
  StringEnum,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type ContentBlock,
  type Context,
  type ImageContent,
  type LlmMessage,
  type Model,
  type ModelCost,
  type OAuthCredentials,
  type OAuthLoginCallbacks,
  type Provider,
  type ProviderHeaders,
  type RefreshModelsContext,
  type SimpleStreamOptions,
  type StreamOptions,
  type TextContent,
  type ThinkingContent,
  type ThinkingLevel,
  type ToolCallContent,
  type ToolExecutionMode,
  type ToolResultMessage,
  type ToolSpec,
  type Usage,
  type UserMessage,
} from "./types.ts";

// OpenAI 兼容 API 流式调用
export { streamOpenAI } from "./openai.ts";

// Anthropic Messages API 流式调用
export { streamAnthropic } from "./anthropic.ts";

// 统一的模型流式调用入口（根据模型 API 类型自动路由）
export { streamModel, type StreamFn } from "./stream.ts";

// TypeBox Schema 与 JSON Schema 的转换及参数校验
export { typeboxToJsonSchema, validateArgs } from "./schema.ts";
