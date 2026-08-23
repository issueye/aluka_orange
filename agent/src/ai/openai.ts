/**
 * OpenAI 兼容 API 流式调用实现
 *
 * 实现了 OpenAI Chat Completions API 的流式调用：
 * 1. 构建请求体并发送 POST 请求
 * 2. 解析 Server-Sent Events (SSE) 流
 * 3. 将 delta 事件转换为统一的 AssistantMessageEvent 流
 * 4. 支持文本和工具调用两种响应类型
 */

import type {
  AssistantMessage,
  AssistantMessageEventStream,
  ContentBlock,
  Context,
  Model,
  StreamOptions,
  TextContent,
  ToolCallContent,
} from "./types.ts";
import { typeboxToJsonSchema } from "./schema.ts";
import { logProviderCall } from "./request-log.ts";
import { StreamImpl, readSse, trimSlash } from "./sse.ts";
import { providerFetch } from "./provider-fetch.ts";

/** OpenAI 工具调用增量数据结构 */
interface OpenAIToolCallDelta {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

/** OpenAI SSE chunk 数据结构 */
interface OpenAIChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: OpenAIToolCallDelta[];
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * 启动 OpenAI 兼容 API 的流式调用
 *
 * @returns 异步可迭代的事件流
 */
export function streamOpenAI(
  model: Model,
  context: Context,
  options: StreamOptions = {},
): AssistantMessageEventStream {
  const stream = new StreamImpl();
  // 后台执行请求，错误通过事件流传播
  void run(model, context, options, stream).catch((error: unknown) => {
    const err = error instanceof Error ? error : new Error(String(error));
    stream.push({ type: "error", error: err });
    stream.end();
  });
  return stream;
}

/**
 * 执行 OpenAI 兼容 API 请求
 *
 * 主要流程：
 * 1. 构建请求体（messages、tools、参数等）
 * 2. 发送 HTTP POST 请求
 * 3. 解析 SSE 流中的增量数据
 * 4. 转换为统一的事件流
 */
async function run(
  model: Model,
  context: Context,
  options: StreamOptions,
  stream: StreamImpl,
): Promise<void> {
  // 解析 API Key
  const apiKey = options.apiKey ?? process.env.ALUKA_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing API key. Set ALUKA_API_KEY or OPENAI_API_KEY.");

  // 解析 API 基础 URL
  const baseUrl = (options as { baseUrl?: string }).baseUrl
    ?? model.baseUrl
    ?? process.env.ALUKA_BASE_URL
    ?? process.env.OPENAI_BASE_URL
    ?? "https://api.openai.com/v1";

  // 构建请求体
  const payload: Record<string, unknown> = {
    model: model.id,
    stream: true,
    stream_options: { include_usage: true },
    messages: toOpenAIMessages(context),
    max_tokens: options.maxTokens ?? model.maxTokens,
  };
  if (options.temperature !== undefined) payload.temperature = options.temperature;

  // 添加工具定义
  if (context.tools?.length) {
    payload.tools = context.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: typeboxToJsonSchema(tool.parameters),
      },
    }));
  }

  // 允许扩展修改请求体（支持 async onPayload；未 await 时 JSON.stringify(Promise) 会变成 {}）
  const maybeReplaced = options.onPayload ? options.onPayload(payload) : payload;
  const replaced = await Promise.resolve(maybeReplaced);
  const body = replaced ?? payload;

  // 发送请求
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
    ...(model.headers ?? {}),
  };

  const url = `${trimSlash(baseUrl)}/chat/completions`;
  const requestBody = JSON.stringify(body);
  const response = await providerFetch(url, {
    method: "POST",
    headers,
    body: requestBody,
    signal: options.signal,
  }, model.proxy);

  // 收集响应头
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  options.onResponse?.(response.status, responseHeaders);

  if (!response.ok) {
    const text = await response.text();
    logProviderCall({
      api: "openai-completions",
      url,
      model: model.id,
      provider: model.provider,
      requestBody,
      status: response.status,
      responseBody: text,
    });
    throw new Error(`OpenAI-compatible request failed (${response.status}): ${text.slice(0, 2000)}`);
  }
  logProviderCall({
    api: "openai-completions",
    url,
    model: model.id,
    provider: model.provider,
    requestBody,
    status: response.status,
  });
  if (!response.body) throw new Error("Provider returned an empty body");

  stream.push({ type: "start" });

  // 内容块累积器
  const content: ContentBlock[] = [];
  // 工具调用缓冲区（按 index 缓存增量数据）
  const toolBuffers = new Map<number, { id: string; name: string; args: string }>();
  let usage = { input: 0, output: 0, totalTokens: 0 };
  let stopReason: AssistantMessage["stopReason"] = "stop";

  // 解析 SSE 数据流（signal 中止时读取立即结束，停止对话无需等下一个 chunk）
  for await (const line of readSse(response.body, options.signal)) {
    if (line === "[DONE]") break;
    let chunk: OpenAIChunk;
    try {
      chunk = JSON.parse(line) as OpenAIChunk;
    } catch {
      continue;
    }

    // 提取 usage 信息
    if (chunk.usage) {
      usage = {
        input: chunk.usage.prompt_tokens ?? 0,
        output: chunk.usage.completion_tokens ?? 0,
        totalTokens: chunk.usage.total_tokens ?? 0,
      };
    }

    const choice = chunk.choices?.[0];
    if (!choice) continue;

    // 更新停止原因
    if (choice.finish_reason === "tool_calls") stopReason = "toolUse";
    if (choice.finish_reason === "length") stopReason = "length";

    const delta = choice.delta;

    // 处理文本增量
    if (delta?.content) {
      const last = content[content.length - 1];
      if (last?.type === "text") {
        last.text += delta.content;
        stream.push({ type: "text", delta: delta.content, content: last });
      } else {
        const block: TextContent = { type: "text", text: delta.content };
        content.push(block);
        stream.push({ type: "text", delta: delta.content, content: block });
      }
    }

    // 处理工具调用增量
    for (const call of delta?.tool_calls ?? []) {
      let buffer = toolBuffers.get(call.index);
      if (!buffer) {
        buffer = { id: call.id ?? `tool_${call.index}`, name: call.function?.name ?? "", args: "" };
        toolBuffers.set(call.index, buffer);
        stream.push({ type: "toolcall_start", id: buffer.id, name: buffer.name });
      }
      if (call.id) buffer.id = call.id;
      if (call.function?.name) buffer.name = call.function.name;
      if (call.function?.arguments) {
        buffer.args += call.function.arguments;
        stream.push({ type: "toolcall_delta", id: buffer.id, delta: call.function.arguments });
      }
    }
  }

  // 完成所有工具调用的解析
  for (const buffer of toolBuffers.values()) {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = buffer.args ? (JSON.parse(buffer.args) as Record<string, unknown>) : {};
    } catch {
      // JSON 解析失败时保存原始字符串
      parsed = { _raw: buffer.args };
    }
    const block: ToolCallContent = {
      type: "toolCall",
      id: buffer.id,
      name: buffer.name,
      arguments: parsed,
      argumentsComplete: true,
    };
    content.push(block);
    stream.push({ type: "toolcall_end", content: block });
  }

  // 构建最终的助手消息
  const message: AssistantMessage = {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: model.provider,
    model: model.id,
    usage,
    stopReason: toolBuffers.size > 0 ? "toolUse" : stopReason,
  };
  stream.push({ type: "done", message });
  stream.end();
}

/**
 * 将内部消息格式转换为 OpenAI API 格式
 *
 * 转换规则：
 * - 系统消息 → { role: "system" }
 * - 用户消息 → { role: "user", content: [...] }
 * - 助手消息 → { role: "assistant", content, tool_calls }
 * - 工具结果 → { role: "tool", tool_call_id, content }
 */
function toOpenAIMessages(context: Context): unknown[] {
  const messages: unknown[] = [];
  if (context.system) {
    messages.push({ role: "system", content: context.system });
  }
  for (const message of context.messages) {
    if (message.role === "user") {
      messages.push({
        role: "user",
        content: message.content.map((part) =>
          part.type === "text"
            ? { type: "text", text: part.text }
            : { type: "image_url", image_url: { url: `data:${part.mimeType};base64,${part.data}` } },
        ),
      });
    } else if (message.role === "assistant") {
      const toolCalls = message.content.filter((part): part is ToolCallContent => part.type === "toolCall");
      const text = message.content
        .filter((part): part is TextContent => part.type === "text")
        .map((part) => part.text)
        .join("");
      messages.push({
        role: "assistant",
        content: text || null,
        tool_calls: toolCalls.length
          ? toolCalls.map((call) => ({
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
            }))
          : undefined,
      });
    } else {
      // 工具结果消息
      messages.push({
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.content
          .filter((part): part is TextContent => part.type === "text")
          .map((part) => part.text)
          .join("\n"),
      });
    }
  }
  return messages;
}
