/**
 * 流式调用路由模块
 *
 * 根据模型的 API 类型自动选择对应的流式调用实现：
 * - anthropic-messages → streamAnthropic
 * - openai-responses → streamOpenAIResponses
 * - openai-completions → streamOpenAI（默认）
 */

import { streamAnthropic } from "./anthropic.ts";
import { streamOpenAI } from "./openai.ts";
import { streamOpenAIResponses } from "./openai-responses.ts";
import type { AssistantMessageEventStream, Context, Model, StreamOptions } from "./types.ts";

/** 流式调用函数签名 */
export type StreamFn = (
  model: Model,
  context: Context,
  options?: StreamOptions,
) => AssistantMessageEventStream;

/**
 * 统一的模型流式调用入口
 *
 * 根据模型配置的 api 字段路由到对应的提供商实现。
 */
export function streamModel(
  model: Model,
  context: Context,
  options?: StreamOptions,
): AssistantMessageEventStream {
  if (model.api === "anthropic-messages") {
    return streamAnthropic(model, context, options);
  }
  if (model.api === "openai-responses") {
    return streamOpenAIResponses(model, context, options);
  }
  return streamOpenAI(model, context, options);
}
