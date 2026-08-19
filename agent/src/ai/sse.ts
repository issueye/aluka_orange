/**
 * SSE 流式事件基础设施
 *
 * StreamImpl：生产者-消费者事件队列
 * readSse / readSseEvents：解析 Server-Sent Events
 */

import type { AssistantMessage, AssistantMessageEvent, AssistantMessageEventStream } from "./types.ts";

/**
 * 流式响应的内部实现
 *
 * 使用生产者-消费者模式：
 * - push() 方法由网络请求线程推送事件
 * - 异步迭代器供 Agent 循环消费事件
 */
export class StreamImpl implements AssistantMessageEventStream {
  /** 已推送的事件队列 */
  private readonly events: AssistantMessageEvent[] = [];
  /** 等待新事件的消费者回调 */
  private readonly waiters: Array<() => void> = [];
  /** 流是否已结束 */
  private finished = false;
  /** 最终的完整助手消息 */
  private final: AssistantMessage | undefined;
  /** 流中的错误 */
  private failure: Error | undefined;

  /** 推送一个事件到流中 */
  push(event: AssistantMessageEvent): void {
    this.events.push(event);
    if (event.type === "done") this.final = event.message;
    if (event.type === "error") this.failure = event.error;
    this.waiters.splice(0).forEach((wake) => wake());
  }

  /** 标记流结束 */
  end(): void {
    this.finished = true;
    this.waiters.splice(0).forEach((wake) => wake());
  }

  /** 消费流并返回最终的完整助手消息 */
  async result(): Promise<AssistantMessage> {
    for await (const event of this) {
      if (event.type === "done") return event.message;
      if (event.type === "error") throw event.error;
    }
    if (this.failure) throw this.failure;
    if (!this.final) throw new Error("Stream ended without an assistant message");
    return this.final;
  }

  /** 异步迭代器：逐个产出事件 */
  async *[Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
    let index = 0;
    while (true) {
      while (index < this.events.length) {
        const event = this.events[index++];
        if (event.type === "error") {
          this.finished = true;
          throw event.error;
        }
        yield event;
      }
      if (this.failure) throw this.failure;
      if (this.finished) return;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }
}

export type SseFrame = { event?: string; data: string };

/**
 * 从 ReadableStream 中读取 SSE 帧（event + data）
 *
 * Responses API 同时发送 `event:` 与 `data:`；Chat Completions 通常只有 `data:`。
 */
export async function* readSseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName: string | undefined;

  const consumeLine = function* (raw: string): Generator<SseFrame> {
    const line = raw.trimEnd();
    if (!line) {
      eventName = undefined;
      return;
    }
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
      return;
    }
    if (line.startsWith("data:")) {
      yield { event: eventName, data: line.slice(5).trim() };
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      yield* consumeLine(line);
    }
  }
  const leftover = buffer.trim();
  if (leftover) yield* consumeLine(leftover);
}

/** 只产出 data 行（Chat Completions 兼容） */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  for await (const frame of readSseEvents(body)) {
    yield frame.data;
  }
}

/** 去除 URL 末尾的斜杠 */
export function trimSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
