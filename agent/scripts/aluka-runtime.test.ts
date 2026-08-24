import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VERSION, parseArgs } from "../src/config.ts";
import { createConsoleUI } from "../src/extensions/ui.ts";
import type { ExtensionContext } from "../src/extensions/types.ts";
import { readTool, writeTool, editTool } from "../src/tools/files.ts";
import { runAgentLoop } from "../src/agent/loop.ts";
import type { AgentMessage, AgentTool } from "../src/agent/types.ts";
import type { AssistantMessageEventStream, Context, Model, StreamOptions } from "../src/ai/types.ts";
import { Type } from "typebox";

describe("config", () => {
  it("exposes version and parses --help", () => {
    assert.equal(VERSION, "0.1.0");
    const args = parseArgs(["-h"]);
    assert.equal(args.help, true);
    const printed = parseArgs(["-p", "hello"]);
    assert.equal(printed.print, true);
    assert.equal(printed.prompt, "hello");
  });
});

describe("typebox", () => {
  it("builds an object schema", () => {
    const schema = Type.Object({ name: Type.String() });
    assert.equal(schema.type, "object");
    assert.ok(schema.properties.name);
  });
});

function ctx(cwd: string): ExtensionContext {
  return {
    ui: createConsoleUI(),
    mode: "print",
    hasUI: false,
    cwd,
    sessionManager: { file: "", getEntries: () => [], append: () => undefined },
    modelRegistry: { getModels: () => [], resolveApiKey: () => undefined },
    model: undefined,
    scopedModels: [],
    isIdle: () => true,
    isProjectTrusted: () => true,
    signal: undefined,
    abort() {},
    hasPendingMessages: () => false,
    shutdown() {},
    getContextUsage: () => undefined,
    compact() {},
    getSystemPrompt: () => "",
  };
}

describe("file tools", () => {
  it("writes, reads, and edits a file", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-tools-"));
    const environment = ctx(cwd);
    await writeTool.execute("1", { path: "a.txt", content: "hello world" }, undefined, undefined, environment);
    const read = await readTool.execute("2", { path: "a.txt" }, undefined, undefined, environment);
    assert.equal(read.content[0].type, "text");
    assert.ok((read.content[0] as { text: string }).text.includes("hello world"));
    await editTool.execute(
      "3",
      { path: "a.txt", oldText: "world", newText: "aluka" },
      undefined,
      undefined,
      environment,
    );
    const again = await readTool.execute("4", { path: "a.txt" }, undefined, undefined, environment);
    assert.ok((again.content[0] as { text: string }).text.includes("hello aluka"));
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});

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
      assert.ok(context.messages.some((message) => message.role === "toolResult"));
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

    assert.equal(calls, 2);
    assert.ok(produced.some((message) => message.role === "toolResult"));
    const last = produced.at(-1) as AgentMessage & { role: "assistant" };
    assert.equal(last.content[0].type, "text");
    assert.equal((last.content[0] as { text: string }).text, "done");
    assert.ok(events.includes("agent_start"));
    assert.ok(events.includes("tool_execution_end"));
    assert.ok(events.includes("agent_end"));
  });
});

describe("native ts extension factory", () => {
  it("loads examples/extensions/greet.ts as a default export", async () => {
    const mod = await import("../examples/extensions/greet.ts");
    assert.equal(typeof mod.default, "function");
    const names: string[] = [];
    mod.default({
      on() {},
      contributes() {},
      contributesData() {},
      registerTool(tool: { name: string }) {
        names.push(tool.name);
      },
      registerCommand() {},
    });
    assert.ok(names.includes("greet"));
  });
});
