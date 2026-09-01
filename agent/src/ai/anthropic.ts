/**
 * Anthropic Messages API 流式调用实现
 *
 * 实现了 Anthropic 原生 Messages API 的调用。
 * 当检测到配置的端点是 OpenAI 兼容网关时，自动回退到 OpenAI 实现。
 *
 * 注意：当前实现使用非流式请求（stream: false），然后模拟流式事件。
 */

import type {
  AssistantMessage,
  AssistantMessageEventStream,
  ContentBlock,
  Context,
  Model,
  StreamOptions,
  TextContent,
} from "./types.ts";
import { typeboxToJsonSchema } from "./schema.ts";
import { logProviderCall } from "./request-log.ts";
import { streamOpenAI } from "./openai.ts";
import { providerFetch, providerStallTimeoutMs, raceStall } from "./provider-fetch.ts";

/**
 * Anthropic 流式调用入口
 *
 * 如果 baseUrl 看起来是 OpenAI 兼容网关（包含 /v1 但不是 anthropic.com），
 * 则回退到 OpenAI 兼容实现。
 */
export function streamAnthropic(
  model: Model,
  context: Context,
  options: StreamOptions = {},
): AssistantMessageEventStream {
  const baseUrl = model.baseUrl ?? process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
  if (baseUrl.includes("/v1") && !baseUrl.includes("anthropic.com")) {
    return streamOpenAI(model, context, options);
  }
  return streamAnthropicNative(model, context, options, baseUrl);
}

/**
 * Anthropic 原生 API 调用实现
 *
 * 使用非流式请求获取完整响应，然后将结果包装为异步迭代器接口。
 * 这样可以保持与 OpenAI 流式接口一致的使用方式。
 */
function streamAnthropicNative(
  model: Model,
  context: Context,
  options: StreamOptions,
  baseUrl: string,
): AssistantMessageEventStream {
  const events: AssistantMessageEventStream = {
    /** 发送请求并获取完整响应 */
    async result() {
      const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY ?? process.env.ALUKA_API_KEY;
      if (!apiKey) throw new Error("Missing Anthropic API key. Set ANTHROPIC_API_KEY.");

      // 构建请求体
      const payload: Record<string, unknown> = {
        model: model.id,
        max_tokens: options.maxTokens ?? model.maxTokens,
        system: context.system,
        messages: toAnthropicMessages(context),
        stream: false,
      };

      // 添加工具定义
      if (context.tools?.length) {
        payload.tools = context.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: typeboxToJsonSchema(tool.parameters),
        }));
      }

      // 允许扩展修改请求体（支持 async onPayload）
      const maybeReplaced = options.onPayload ? options.onPayload(payload) : payload;
      const replaced = await Promise.resolve(maybeReplaced);
      const body = replaced ?? payload;

      const url = `${trimSlash(baseUrl)}/v1/messages`;
      const requestBody = JSON.stringify(body);
      const response = await providerFetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          ...(model.headers ?? {}),
        },
        body: requestBody,
        signal: options.signal,
      }, model.proxy, providerStallTimeoutMs());

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      options.onResponse?.(response.status, responseHeaders);

      if (!response.ok) {
        const text = await response.text();
        logProviderCall({
          api: "anthropic-messages",
          url,
          model: model.id,
          provider: model.provider,
          requestBody,
          status: response.status,
          responseBody: text,
        });
        throw new Error(`Anthropic request failed (${response.status}): ${text.slice(0, 2000)}`);
      }
      logProviderCall({
        api: "anthropic-messages",
        url,
        model: model.id,
        provider: model.provider,
        requestBody,
        status: response.status,
      });

      // 解析 JSON 响应（空闲超时：响应体迟迟不完成时掐断，避免会话无限等待）
      const json = (await raceStall(
        response.json() as Promise<{
          content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
          stop_reason?: string;
          usage?: { input_tokens?: number; output_tokens?: number };
        }>,
        providerStallTimeoutMs(),
        "body",
        () => void response.body?.cancel().catch(() => {}),
      )) as {
        content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
        stop_reason?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
      };

      // 将 Anthropic 内容块转换为统一格式
      const content: ContentBlock[] = [];
      for (const block of json.content ?? []) {
        if (block.type === "text" && block.text) {
          content.push({ type: "text", text: block.text });
        } else if (block.type === "tool_use") {
          content.push({
            type: "toolCall",
            id: block.id ?? "",
            name: block.name ?? "",
            arguments: block.input ?? {},
            argumentsComplete: true,
          });
        }
      }

      return {
        role: "assistant",
        content,
        api: "anthropic-messages",
        provider: model.provider,
        model: model.id,
        usage: {
          input: json.usage?.input_tokens ?? 0,
          output: json.usage?.output_tokens ?? 0,
        },
        stopReason: json.stop_reason === "tool_use" ? "toolUse" : "stop",
      };
    },

    /** 模拟异步迭代器：将完整结果逐块产出（signal 中止时提前结束） */
    async *[Symbol.asyncIterator]() {
      const message = await this.result();
      if (options.signal?.aborted) return;
      yield { type: "start" as const };
      for (const block of message.content) {
        if (block.type === "text") {
          yield { type: "text" as const, delta: block.text, content: block };
        } else if (block.type === "toolCall") {
          yield { type: "toolcall_start" as const, id: block.id, name: block.name };
          yield { type: "toolcall_end" as const, content: block };
        }
      }
      yield { type: "done" as const, message };
    },
  };
  return events;
}

/**
 * 将内部消息格式转换为 Anthropic Messages API 格式
 *
 * 转换规则：
 * - 用户消息 → { role: "user", content: [...] }
 * - 助手消息 → { role: "assistant", content: [...] }
 * - 工具结果 → { role: "user", content: [{ type: "tool_result", ... }] }
 *   注意：Anthropic API 要求工具结果放在 user 角色下
 */
function toAnthropicMessages(context: Context): unknown[] {
  const messages: unknown[] = [];
  for (const message of context.messages) {
    if (message.role === "user") {
      messages.push({
        role: "user",
        content: message.content.map((part) =>
          part.type === "text"
            ? { type: "text", text: part.text }
            : { type: "image", source: { type: "base64", media_type: part.mimeType, data: part.data } },
        ),
      });
    } else if (message.role === "assistant") {
      messages.push({
        role: "assistant",
        content: message.content.flatMap((part) => {
          if (part.type === "text") return [{ type: "text" as const, text: part.text }];
          if (part.type === "toolCall") {
            return [{ type: "tool_use" as const, id: part.id, name: part.name, input: part.arguments }];
          }
          return [] as Array<Record<string, unknown>>;
        }),
      });
    } else {
      // 工具结果放在 user 角色下
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: message.toolCallId,
            content: message.content
              .filter((part): part is TextContent => part.type === "text")
              .map((part) => part.text)
              .join("\n"),
            is_error: message.isError,
          },
        ],
      });
    }
  }
  return messages;
}

/** 去除 URL 末尾的斜杠 */
function trimSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
