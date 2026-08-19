/**
 * OpenAI Responses API 流式调用实现
 *
 * POST {baseUrl}/responses
 * 将内部消息转为 input items，解析 SSE：
 * - response.output_text.delta
 * - response.output_item.added (function_call)
 * - response.function_call_arguments.delta
 * - response.completed / response.failed
 */

import type {
  AssistantMessage,
  AssistantMessageEventStream,
  ContentBlock,
  Context,
  Model,
  StreamOptions,
  TextContent,
  ThinkingContent,
  ToolCallContent,
} from "./types.ts";
import { typeboxToJsonSchema } from "./schema.ts";
import { logProviderCall } from "./request-log.ts";
import { StreamImpl, readSseEvents, trimSlash } from "./sse.ts";
import { providerFetch } from "./provider-fetch.ts";

interface ResponsesUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
}

interface ResponsesItem {
  type?: string;
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  role?: string;
  content?: unknown;
  status?: string;
  error?: { message?: string } | string;
}

interface ResponsesEvent {
  type?: string;
  delta?: unknown;
  text?: string;
  item_id?: string;
  output_index?: number;
  item?: ResponsesItem;
  response?: {
    status?: string;
    error?: { message?: string } | string;
    usage?: ResponsesUsage;
    output?: ResponsesItem[];
  };
  error?: { message?: string } | string;
}

interface ToolBuffer {
  id: string;
  name: string;
  args: string;
  started: boolean;
}

export function streamOpenAIResponses(
  model: Model,
  context: Context,
  options: StreamOptions = {},
): AssistantMessageEventStream {
  const stream = new StreamImpl();
  void run(model, context, options, stream).catch((error: unknown) => {
    const err = error instanceof Error ? error : new Error(String(error));
    stream.push({ type: "error", error: err });
    stream.end();
  });
  return stream;
}

/**
 * OpenCode Go 与 Zen 的模型目录不同。
 * Go 上 Muse Spark 只有 contributor 版；Zen 才是 muse-spark-1.2。
 */
export function resolveResponsesModelId(modelId: string, baseUrl?: string): string {
  if (!baseUrl) return modelId;
  if (/\/zen\/go(?:\/|$)/i.test(baseUrl) && modelId === "muse-spark-1.2") {
    return "muse-spark-1.2-contributor";
  }
  return modelId;
}

function formatResponsesHttpError(status: number, text: string, modelId: string, baseUrl: string): string {
  const body = text.slice(0, 2000);
  if (status === 401 && /not supported/i.test(text) && /\/zen\/go/i.test(baseUrl)) {
    return (
      `OpenAI Responses request failed (${status}): ${body}`
      + ` OpenCode Go 不提供 ${modelId}。Muse Spark 请用 muse-spark-1.2-contributor；`
      + ` 完整版 muse-spark-1.2 需要 Base URL https://opencode.ai/zen/v1。`
    );
  }
  return `OpenAI Responses request failed (${status}): ${body}`;
}

/** 将内部上下文转为 Responses API 请求体（供测试与 onPayload 前构建） */
export function buildResponsesPayload(
  model: Model,
  context: Context,
  options: StreamOptions = {},
): Record<string, unknown> {
  const baseUrl = (options as { baseUrl?: string }).baseUrl ?? model.baseUrl;
  const payload: Record<string, unknown> = {
    model: resolveResponsesModelId(model.id, baseUrl),
    stream: true,
    input: toResponsesInput(context),
    max_output_tokens: options.maxTokens ?? model.maxTokens,
  };
  if (context.system) payload.instructions = context.system;
  if (options.temperature !== undefined) payload.temperature = options.temperature;
  if (context.tools?.length) {
    payload.tools = context.tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: typeboxToJsonSchema(tool.parameters),
    }));
  }
  const effort = reasoningEffort(model, options);
  if (effort) payload.reasoning = { effort };
  return payload;
}

/** 内部消息 → Responses input items */
export function toResponsesInput(context: Context): unknown[] {
  const items: unknown[] = [];
  for (const message of context.messages) {
    if (message.role === "user") {
      items.push({
        role: "user",
        content: message.content.map((part) =>
          part.type === "text"
            ? { type: "input_text", text: part.text }
            : { type: "input_image", image_url: `data:${part.mimeType};base64,${part.data}` },
        ),
      });
    } else if (message.role === "assistant") {
      const texts = message.content.filter((part): part is TextContent => part.type === "text");
      const tools = message.content.filter((part): part is ToolCallContent => part.type === "toolCall");
      if (texts.length) {
        items.push({
          role: "assistant",
          content: texts.map((part) => ({ type: "output_text", text: part.text })),
        });
      }
      for (const call of tools) {
        items.push({
          type: "function_call",
          call_id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.arguments ?? {}),
        });
      }
    } else {
      items.push({
        type: "function_call_output",
        call_id: message.toolCallId,
        output: message.content
          .filter((part): part is TextContent => part.type === "text")
          .map((part) => part.text)
          .join("\n"),
      });
    }
  }
  return items;
}

function reasoningEffort(model: Model, options: StreamOptions): string | undefined {
  const level = options.thinkingLevel;
  if (level && level !== "off") return level === "minimal" ? "low" : level;
  if (model.reasoning) return "medium";
  return undefined;
}

async function run(
  model: Model,
  context: Context,
  options: StreamOptions,
  stream: StreamImpl,
): Promise<void> {
  const apiKey = options.apiKey ?? process.env.ALUKA_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing API key. Set ALUKA_API_KEY or OPENAI_API_KEY.");

  const baseUrl = (options as { baseUrl?: string }).baseUrl
    ?? model.baseUrl
    ?? process.env.ALUKA_BASE_URL
    ?? process.env.OPENAI_BASE_URL
    ?? "https://api.openai.com/v1";

  const payload = buildResponsesPayload(model, context, options);
  const maybeReplaced = options.onPayload ? options.onPayload(payload) : payload;
  const replaced = await Promise.resolve(maybeReplaced);
  const body = replaced ?? payload;

  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
    ...(model.headers ?? {}),
  };

  const url = `${trimSlash(baseUrl)}/responses`;
  const requestBody = JSON.stringify(body);
  const response = await providerFetch(url, {
    method: "POST",
    headers,
    body: requestBody,
    signal: options.signal,
  }, model.proxy);

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  options.onResponse?.(response.status, responseHeaders);

  if (!response.ok) {
    const text = await response.text();
    logProviderCall({
      api: "openai-responses",
      url,
      model: model.id,
      provider: model.provider,
      requestBody,
      status: response.status,
      responseBody: text,
    });
    throw new Error(formatResponsesHttpError(response.status, text, model.id, url));
  }
  logProviderCall({
    api: "openai-responses",
    url,
    model: model.id,
    provider: model.provider,
    requestBody,
    status: response.status,
  });
  if (!response.body) throw new Error("Provider returned an empty body");

  stream.push({ type: "start" });

  const content: ContentBlock[] = [];
  const toolBuffers = new Map<string, ToolBuffer>();
  let usage = { input: 0, output: 0, totalTokens: 0 };
  let stopReason: AssistantMessage["stopReason"] = "stop";
  let completedOutput: ResponsesItem[] | undefined;

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") && !contentType.includes("text/event-stream")) {
    const json = (await response.json()) as ResponsesEvent["response"] & ResponsesEvent;
    const envelope = json?.response ?? json;
    if (envelope?.status === "failed" || envelope?.error) {
      throw new Error(errorMessage(envelope.error) || "OpenAI Responses request failed");
    }
    if (envelope?.usage) usage = mapUsage(envelope.usage);
    completedOutput = envelope?.output;
    applyCompletedOutput(completedOutput, content, toolBuffers, stream);
  } else {
    for await (const frame of readSseEvents(response.body)) {
      if (frame.data === "[DONE]") break;
      let event: ResponsesEvent;
      try {
        event = JSON.parse(frame.data) as ResponsesEvent;
      } catch {
        continue;
      }
      const type = event.type ?? frame.event ?? "";
      if (type === "error" || type === "response.failed") {
        throw new Error(
          errorMessage(event.error)
            || errorMessage(event.response?.error)
            || "OpenAI Responses request failed",
        );
      }
      if (event.response?.usage) usage = mapUsage(event.response.usage);
      if (type === "response.completed") {
        if (event.response?.output) completedOutput = event.response.output;
        continue;
      }
      applyStreamEvent(type, event, content, toolBuffers, stream);
    }
    if (content.length === 0 && toolBuffers.size === 0 && completedOutput?.length) {
      applyCompletedOutput(completedOutput, content, toolBuffers, stream);
    } else if (completedOutput?.length) {
      mergeMissingTools(completedOutput, toolBuffers, stream);
    }
  }

  for (const buffer of toolBuffers.values()) {
    if (!buffer.started) {
      stream.push({ type: "toolcall_start", id: buffer.id, name: buffer.name });
    }
    let parsed: Record<string, unknown> = {};
    try {
      parsed = buffer.args ? (JSON.parse(buffer.args) as Record<string, unknown>) : {};
    } catch {
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

  if (toolBuffers.size > 0) stopReason = "toolUse";

  const message: AssistantMessage = {
    role: "assistant",
    content,
    api: "openai-responses",
    provider: model.provider,
    model: model.id,
    usage,
    stopReason,
  };
  stream.push({ type: "done", message });
  stream.end();
}

function applyStreamEvent(
  type: string,
  event: ResponsesEvent,
  content: ContentBlock[],
  toolBuffers: Map<string, ToolBuffer>,
  stream: StreamImpl,
): void {
  if (type === "response.output_text.delta" || type === "response.text.delta") {
    const delta = textDelta(event);
    if (delta) appendText(delta, content, stream);
    return;
  }
  if (type === "response.reasoning_summary_text.delta") {
    const delta = textDelta(event);
    if (delta) appendThinking(delta, content, stream);
    return;
  }
  if (type === "response.output_item.added" || type === "response.output_item.done") {
    const item = event.item;
    if (!item) return;
    if (item.type === "function_call") {
      upsertToolBuffer(toolBuffers, event, item, stream);
    } else if (item.type === "message" && type === "response.output_item.done") {
      const text = messageText(item);
      if (text && !content.some((block) => block.type === "text")) {
        appendText(text, content, stream);
      }
    }
    return;
  }
  if (type === "response.function_call_arguments.delta") {
    const buffer = upsertToolBuffer(toolBuffers, event, event.item, stream);
    const delta = textDelta(event);
    if (buffer && delta) {
      buffer.args += delta;
      stream.push({ type: "toolcall_delta", id: buffer.id, delta });
    }
  }
}

function applyCompletedOutput(
  output: ResponsesItem[] | undefined,
  content: ContentBlock[],
  toolBuffers: Map<string, ToolBuffer>,
  stream: StreamImpl,
): void {
  if (!output?.length) return;
  for (const item of output) {
    if (item.type === "message" || item.role === "assistant") {
      const text = messageText(item);
      if (text) appendText(text, content, stream);
    } else if (item.type === "function_call") {
      const buffer = upsertToolBuffer(toolBuffers, { item }, item, stream);
      if (item.arguments && buffer && !buffer.args) buffer.args = item.arguments;
    }
  }
}

function mergeMissingTools(
  output: ResponsesItem[],
  toolBuffers: Map<string, ToolBuffer>,
  stream: StreamImpl,
): void {
  for (const item of output) {
    if (item.type !== "function_call") continue;
    const existing = findToolBuffer(toolBuffers, item);
    if (existing) {
      if (item.arguments && !existing.args) existing.args = item.arguments;
      if (item.name && !existing.name) existing.name = item.name;
      continue;
    }
    const buffer = upsertToolBuffer(toolBuffers, { item }, item, stream);
    if (item.arguments && buffer) buffer.args = item.arguments;
  }
}

function upsertToolBuffer(
  toolBuffers: Map<string, ToolBuffer>,
  event: Pick<ResponsesEvent, "item_id" | "output_index" | "item">,
  item: ResponsesItem | undefined,
  stream: StreamImpl,
): ToolBuffer | undefined {
  const key = toolKey(event, item);
  let buffer = toolBuffers.get(key);
  if (!buffer) {
    for (const [existingKey, existing] of toolBuffers) {
      if (item?.id && existing.id === item.id) {
        buffer = existing;
        toolBuffers.set(key, existing);
        break;
      }
      if (item?.call_id && existing.id === item.call_id) {
        buffer = existing;
        toolBuffers.set(key, existing);
        break;
      }
      if (existingKey === `idx:${event.output_index}`) {
        buffer = existing;
        toolBuffers.set(key, existing);
        break;
      }
    }
  }
  if (!buffer) {
    buffer = {
      id: item?.call_id || item?.id || event.item_id || `tool_${event.output_index ?? toolBuffers.size}`,
      name: item?.name ?? "",
      args: item?.arguments ?? "",
      started: false,
    };
    toolBuffers.set(key, buffer);
  } else {
    if (item?.call_id) buffer.id = item.call_id;
    else if (item?.id) buffer.id = item.id;
    if (item?.name) buffer.name = item.name;
    if (item?.arguments && item.arguments.length > buffer.args.length) buffer.args = item.arguments;
  }
  if (!buffer.started) {
    buffer.started = true;
    stream.push({ type: "toolcall_start", id: buffer.id, name: buffer.name });
  }
  return buffer;
}

function findToolBuffer(toolBuffers: Map<string, ToolBuffer>, item: ResponsesItem): ToolBuffer | undefined {
  for (const buffer of toolBuffers.values()) {
    if (item.call_id && buffer.id === item.call_id) return buffer;
    if (item.id && buffer.id === item.id) return buffer;
  }
  return undefined;
}

function toolKey(
  event: Pick<ResponsesEvent, "item_id" | "output_index" | "item">,
  item: ResponsesItem | undefined,
): string {
  return item?.id || event.item_id || item?.call_id || `idx:${event.output_index ?? 0}`;
}

function appendText(delta: string, content: ContentBlock[], stream: StreamImpl): void {
  const last = content[content.length - 1];
  if (last?.type === "text") {
    last.text += delta;
    stream.push({ type: "text", delta, content: last });
    return;
  }
  const block: TextContent = { type: "text", text: delta };
  content.push(block);
  stream.push({ type: "text", delta, content: block });
}

function appendThinking(delta: string, content: ContentBlock[], stream: StreamImpl): void {
  const last = content[content.length - 1];
  if (last?.type === "thinking") {
    last.thinking += delta;
    stream.push({ type: "thinking", delta, content: last });
    return;
  }
  const block: ThinkingContent = { type: "thinking", thinking: delta };
  content.push(block);
  stream.push({ type: "thinking", delta, content: block });
}

function textDelta(event: ResponsesEvent): string {
  if (typeof event.delta === "string") return event.delta;
  if (typeof event.text === "string") return event.text;
  if (event.delta && typeof event.delta === "object") {
    const rec = event.delta as Record<string, unknown>;
    if (typeof rec.text === "string") return rec.text;
    if (typeof rec.delta === "string") return rec.delta;
  }
  return "";
}

function messageText(item: ResponsesItem): string {
  if (!Array.isArray(item.content)) return "";
  const parts: string[] = [];
  for (const part of item.content) {
    if (!part || typeof part !== "object") continue;
    const rec = part as Record<string, unknown>;
    if (typeof rec.text === "string") parts.push(rec.text);
  }
  return parts.join("");
}

function mapUsage(usage: ResponsesUsage): { input: number; output: number; totalTokens: number } {
  const input = usage.input_tokens ?? usage.prompt_tokens ?? 0;
  const output = usage.output_tokens ?? usage.completion_tokens ?? 0;
  return { input, output, totalTokens: usage.total_tokens ?? input + output };
}

function errorMessage(error: { message?: string } | string | undefined): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  return error.message ?? "";
}
