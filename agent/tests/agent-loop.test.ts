import { describe, expect, it } from "vitest";
import { runAgentLoop } from "../src/agent/loop.ts";
import type { AgentMessage, AgentTool } from "../src/agent/types.ts";
import type { AssistantMessageEventStream, Context, Model, StreamOptions } from "../src/ai/types.ts";

const model: Model = {
  id: "mock",
  name: "mock",
  provider: "mock",
  api: "openai-completions",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8000,
  maxTokens: 256,
};

function mockStream(message: {
  text?: string;
  tools?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
}): AssistantMessageEventStream {
  const assistant = {
    role: "assistant" as const,
    content: [
      ...(message.text ? [{ type: "text" as const, text: message.text }] : []),
      ...(message.tools ?? []).map((tool) => ({
        type: "toolCall" as const,
        id: tool.id,
        name: tool.name,
        arguments: tool.arguments,
      })),
    ],
    stopReason: message.tools?.length ? ("toolUse" as const) : ("stop" as const),
  };
  return {
    async result() {
      return assistant;
    },
    async *[Symbol.asyncIterator]() {
      yield { type: "start" as const };
      if (message.text) {
        yield { type: "text" as const, delta: message.text, content: { type: "text", text: message.text } };
      }
      for (const tool of message.tools ?? []) {
        yield { type: "toolcall_start" as const, id: tool.id, name: tool.name };
        yield {
          type: "toolcall_end" as const,
          content: { type: "toolCall" as const, id: tool.id, name: tool.name, arguments: tool.arguments },
        };
      }
      yield { type: "done" as const, message: assistant };
    },
  };
}

describe("agent loop", () => {
  it("executes a tool then finishes", async () => {
    const echo: AgentTool = {
      name: "echo",
      description: "echo",
      parameters: { type: "object", properties: { text: { type: "string" } } },
      async execute(_id, params) {
        return { content: [{ type: "text", text: String((params as { text: string }).text) }] };
      },
    };

    let calls = 0;
    const streamFn = (_model: Model, context: Context, _options?: StreamOptions) => {
      calls += 1;
      if (calls === 1) {
        return mockStream({ tools: [{ id: "t1", name: "echo", arguments: { text: "hi" } }] });
      }
      expect(context.messages.some((message) => message.role === "toolResult")).toBe(true);
      return mockStream({ text: "done" });
    };

    const events: string[] = [];
    const produced = await runAgentLoop(
      [{ role: "user", content: [{ type: "text", text: "say hi" }] }],
      { systemPrompt: "test", messages: [], tools: [echo] },
      { model },
      async (event) => {
        events.push(event.type);
      },
      undefined,
      streamFn,
    );

    expect(calls).toBe(2);
    expect(produced.some((message) => message.role === "toolResult")).toBe(true);
    expect((produced.at(-1) as AgentMessage & { role: "assistant" }).content[0]).toMatchObject({
      type: "text",
      text: "done",
    });
    expect(events).toContain("agent_start");
    expect(events).toContain("tool_execution_end");
    expect(events).toContain("agent_end");
  });

  it("emits agent_end when the provider stream errors", async () => {
    const streamFn = (): AssistantMessageEventStream => ({
      async result() {
        throw new Error("OpenAI-compatible request failed (403): denied");
      },
      async *[Symbol.asyncIterator]() {
        yield { type: "error" as const, error: new Error("OpenAI-compatible request failed (403): denied") };
      },
    });
    const events: string[] = [];
    await expect(
      runAgentLoop(
        [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        { systemPrompt: "test", messages: [], tools: [] },
        { model },
        async (event) => {
          events.push(event.type);
        },
        undefined,
        streamFn,
      ),
    ).rejects.toThrow(/403/);
    expect(events).toContain("agent_start");
    expect(events).toContain("agent_end");
  });
});
