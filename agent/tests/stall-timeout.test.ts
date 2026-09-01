import { describe, expect, it } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { providerFetch, ProviderStallError, providerStallTimeoutMs, raceStall } from "../src/ai/provider-fetch.ts";
import { readSseEvents } from "../src/ai/sse.ts";
import { createDesktopRuntime } from "../src/desktop/index.ts";

/** 起一个可切换行为的本地 mock 网关 */
async function listen(mode: "hang" | "partial-sse"): Promise<string> {
  const server = http.createServer((req, res) => {
    if (mode === "hang") return; // 接受连接后既不响应也不关闭
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write('data: {"choices":[{"delta":{"content":"par"}}]}\n\n');
    // 之后不再写、不 end：模拟 SSE 断流
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return `http://127.0.0.1:${port}`;
}

describe("provider stall timeout", () => {
  it("providerStallTimeoutMs reads env with 120s default", () => {
    const saved = process.env.ALUKA_STALL_TIMEOUT_MS;
    delete process.env.ALUKA_STALL_TIMEOUT_MS;
    expect(providerStallTimeoutMs()).toBe(120_000);
    process.env.ALUKA_STALL_TIMEOUT_MS = "5000";
    expect(providerStallTimeoutMs()).toBe(5000);
    process.env.ALUKA_STALL_TIMEOUT_MS = "0"; // <=0 视为禁用
    expect(providerStallTimeoutMs()).toBe(0);
    if (saved === undefined) delete process.env.ALUKA_STALL_TIMEOUT_MS;
    else process.env.ALUKA_STALL_TIMEOUT_MS = saved;
  });

  it("providerFetch throws ProviderStallError when headers never arrive", async () => {
    const base = await listen("hang");
    const started = Date.now();
    await expect(
      providerFetch(`${base}/v1/chat/completions`, { method: "POST" }, undefined, 300),
    ).rejects.toBeInstanceOf(ProviderStallError);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("providerFetch keeps user abort precedence over stall timeout", async () => {
    const base = await listen("hang");
    const controller = new AbortController();
    const pending = providerFetch(`${base}/v1/chat/completions`, {
      method: "POST",
      signal: controller.signal,
    }, undefined, 60_000);
    setTimeout(() => controller.abort(), 50);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("readSseEvents times out when the stream stalls mid-frame", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"a":1}\n\n'));
        // 之后不再 enqueue（保持打开）
      },
    });
    const frames: string[] = [];
    await expect(async () => {
      for await (const frame of readSseEvents(stream, undefined, 200)) {
        frames.push(frame.data);
      }
    }).rejects.toBeInstanceOf(ProviderStallError);
    expect(frames).toEqual(['{"a":1}']);
  });

  it("raceStall rejects with ProviderStallError and triggers onCancel", async () => {
    let cancelled = false;
    await expect(
      raceStall(new Promise<never>(() => {}), 100, "body", () => {
        cancelled = true;
      }),
    ).rejects.toMatchObject({ phase: "body" });
    expect(cancelled).toBe(true);
  });
});

describe("desktop session recovers from a hung provider", () => {
  it("prompt() settles with a timeout error and the session stays usable", async () => {
    process.env.ALUKA_STALL_TIMEOUT_MS = "1000";
    const base = await listen("hang");
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-agent-"));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-cwd-"));
    fs.writeFileSync(
      path.join(agentDir, "models.json"),
      JSON.stringify({
        providers: {
          mockgw: { baseUrl: `${base}/v1`, api: "openai-completions", apiKey: "k", models: [{ id: "m1", name: "M1" }] },
        },
      }),
    );
    const errors: string[] = [];
    const rt = await createDesktopRuntime({
      agentDir,
      cwd,
      onEvent: (event) => {
        if (event.type === "error") errors.push(event.message);
      },
    });
    rt.selectModel("mockgw", "m1");
    rt.patchSettings({ apiKey: "k" });

    // 第一次请求挂起：应在超时后结算（此前会永远停留在「处理中」）
    await expect(rt.prompt("first")).rejects.toBeInstanceOf(ProviderStallError);
    expect(rt.isBusy()).toBe(false);
    expect(errors.some((message) => message.includes("timed out"))).toBe(true);

    // 会话未被锁死：第二次 prompt 可以正常发起（本例再次超时，但不再报「正在处理中」）
    await expect(rt.prompt("second")).rejects.toBeInstanceOf(ProviderStallError);
    expect(rt.isBusy()).toBe(false);

    delete process.env.ALUKA_STALL_TIMEOUT_MS;
    fs.rmSync(agentDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }, 20_000);
});
