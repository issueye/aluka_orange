import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "vitest";
import {
  buildResponsesPayload,
  resolveResponsesModelId,
  streamOpenAIResponses,
  toResponsesInput,
} from "../src/ai/openai-responses.ts";
import { streamModel } from "../src/ai/stream.ts";
import type { Context, Model } from "../src/ai/types.ts";
import { lookupProviderModel, upsertCustomProviderInModelsJson } from "../src/models-json.ts";

const model: Model = {
  id: "gpt-test",
  name: "gpt-test",
  provider: "openai",
  api: "openai-responses",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8000,
  maxTokens: 256,
};

function context(overrides: Partial<Context> = {}): Context {
  return {
    system: "You are a test assistant.",
    messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    tools: [
      {
        name: "echo",
        description: "echo text",
        parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      },
    ],
    ...overrides,
  };
}

function sse(frames: Array<{ event: string; data: unknown }>): string {
  return frames.map((frame) => `event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`).join("");
}

async function withServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => handler(req, res, Buffer.concat(chunks).toString("utf8")));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  try {
    await run(`http://127.0.0.1:${addr.port}/v1`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

describe("openai responses protocol", () => {
  it("maps history to Responses input items and flat function tools", () => {
    const payload = buildResponsesPayload(
      model,
      context({
        messages: [
          { role: "user", content: [{ type: "text", text: "hi" }] },
          {
            role: "assistant",
            content: [
              { type: "text", text: "calling" },
              { type: "toolCall", id: "call_1", name: "echo", arguments: { text: "x" } },
            ],
          },
          {
            role: "toolResult",
            toolCallId: "call_1",
            toolName: "echo",
            content: [{ type: "text", text: "x" }],
          },
        ],
      }),
    );
    assert.equal(payload.stream, true);
    assert.equal(payload.instructions, "You are a test assistant.");
    assert.equal(payload.max_output_tokens, 256);
    assert.ok(!("messages" in payload));
    const input = payload.input as unknown[];
    assert.deepEqual(input, [
      { role: "user", content: [{ type: "input_text", text: "hi" }] },
      { role: "assistant", content: [{ type: "output_text", text: "calling" }] },
      { type: "function_call", call_id: "call_1", name: "echo", arguments: JSON.stringify({ text: "x" }) },
      { type: "function_call_output", call_id: "call_1", output: "x" },
    ]);
    assert.deepEqual(payload.tools, [
      {
        type: "function",
        name: "echo",
        description: "echo text",
        parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      },
    ]);
    assert.equal(toResponsesInput({ messages: [] }).length, 0);
  });

  it("POSTs /responses and streams text deltas", async () => {
    await withServer((req, res, raw) => {
      assert.equal(req.method, "POST");
      assert.equal(req.url, "/v1/responses");
      const body = JSON.parse(raw) as { model: string; input: unknown[] };
      assert.equal(body.model, "gpt-test");
      assert.ok(Array.isArray(body.input));
      res.setHeader("content-type", "text/event-stream");
      res.end(sse([
        { event: "response.output_text.delta", data: { type: "response.output_text.delta", delta: "Hel" } },
        { event: "response.output_text.delta", data: { type: "response.output_text.delta", delta: "lo" } },
        {
          event: "response.completed",
          data: {
            type: "response.completed",
            response: { usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 } },
          },
        },
      ]));
    }, async (baseUrl) => {
      const events: string[] = [];
      const stream = streamOpenAIResponses(
        { ...model, baseUrl },
        context({ tools: undefined }),
        { apiKey: "sk-test" },
      );
      for await (const event of stream) events.push(event.type);
      const message = await stream.result();
      assert.deepEqual(events, ["start", "text", "text", "done"]);
      assert.equal(message.api, "openai-responses");
      assert.equal(message.content[0]?.type, "text");
      assert.equal((message.content[0] as { text: string }).text, "Hello");
      assert.equal(message.usage?.input, 4);
      assert.equal(message.stopReason, "stop");
    });
  });

  it("streams function_call items as tool calls", async () => {
    await withServer((_req, res) => {
      res.setHeader("content-type", "text/event-stream");
      res.end(sse([
        {
          event: "response.output_item.added",
          data: {
            type: "response.output_item.added",
            output_index: 0,
            item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "echo", arguments: "" },
          },
        },
        {
          event: "response.function_call_arguments.delta",
          data: { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: "{\"text\":\"hi\"}" },
        },
        { event: "response.completed", data: { type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1 } } } },
      ]));
    }, async (baseUrl) => {
      const stream = streamOpenAIResponses({ ...model, baseUrl }, context(), { apiKey: "sk-test" });
      const types: string[] = [];
      for await (const event of stream) types.push(event.type);
      const message = await stream.result();
      assert.ok(types.includes("toolcall_start"));
      assert.ok(types.includes("toolcall_delta"));
      assert.ok(types.includes("toolcall_end"));
      const tool = message.content.find((part) => part.type === "toolCall") as { id: string; name: string; arguments: { text: string } };
      assert.equal(tool.id, "call_1");
      assert.equal(tool.name, "echo");
      assert.equal(tool.arguments.text, "hi");
      assert.equal(message.stopReason, "toolUse");
    });
  });

  it("routes openai-responses through streamModel", async () => {
    await withServer((_req, res) => {
      res.setHeader("content-type", "text/event-stream");
      res.end(sse([
        { event: "response.output_text.delta", data: { type: "response.output_text.delta", delta: "ok" } },
        { event: "response.completed", data: { type: "response.completed", response: {} } },
      ]));
    }, async (baseUrl) => {
      const message = await streamModel(
        { ...model, baseUrl },
        context({ tools: undefined }),
        { apiKey: "sk-test" },
      ).result();
      assert.equal(message.api, "openai-responses");
      assert.equal((message.content[0] as { text: string }).text, "ok");
    });
  });

  it("maps Zen Muse Spark to Go contributor id on zen/go endpoints", () => {
    assert.equal(
      resolveResponsesModelId("muse-spark-1.2", "https://opencode.ai/zen/go/v1"),
      "muse-spark-1.2-contributor",
    );
    assert.equal(
      resolveResponsesModelId("muse-spark-1.2", "https://opencode.ai/zen/v1"),
      "muse-spark-1.2",
    );
    const payload = buildResponsesPayload(
      { ...model, id: "muse-spark-1.2", baseUrl: "https://opencode.ai/zen/go/v1" },
      context({ tools: undefined, system: undefined }),
    );
    assert.equal(payload.model, "muse-spark-1.2-contributor");
  });

  it("persists openai-responses in models.json lookup", () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-responses-"));
    try {
      upsertCustomProviderInModelsJson(agentDir, {
        provider: "opencode",
        baseUrl: "http://127.0.0.1:4096/v1",
        api: "openai-responses",
        modelId: "deepseek-v4-flash",
        apiKey: "sk-test",
      });
      const found = lookupProviderModel(agentDir, "opencode", "deepseek-v4-flash");
      assert.equal(found?.api, "openai-responses");
      assert.equal(found?.baseUrl, "http://127.0.0.1:4096/v1");
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  });
});
