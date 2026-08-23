import { describe, expect, it } from "vitest";
import { readSseEvents } from "../src/ai/sse.ts";

describe("SSE abort behavior", () => {
  it("ends iteration promptly when signal is aborted mid-stream", async () => {
    // 构造一个永不结束的流（模拟 provider 不返回 ++ 的情况）
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"a":1}\n'));
        // 之后不再 enqueue（保持打开）
      },
    });
    const controller = new AbortController();

    const frames: string[] = [];
    const iterator = readSseEvents(stream, controller.signal);
    const pump = (async () => {
      for await (const frame of iterator) {
        frames.push(frame.data);
      }
    })();

    // 让第一帧被消费后再中止
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();

    const result = await Promise.race([
      pump.then(() => "ended"),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 2000)),
    ]);
    expect(frames).toEqual(['{"a":1}']);
    expect(result).toBe("ended");
  });

  it("ends immediately when signal already aborted", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: x\n'));
      },
    });
    const controller = new AbortController();
    controller.abort();

    const frames: string[] = [];
    for await (const frame of readSseEvents(stream, controller.signal)) {
      frames.push(frame.data);
    }
    expect(frames).toEqual([]);
  });
});
