import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  createDesktopRuntime,
  createDesktopUI,
  packageNameFromSpec,
  parseGhGistStdout,
  resolveExtensionEntry,
  shareSessionViaGh,
  isTemporaryWorkspace,
  samePath,
} from "../src/desktop/index.ts";
import { SessionManager } from "../src/session/manager.ts";
import type { AssistantMessageEventStream, Context, Model, StreamOptions } from "../src/ai/types.ts";
import { runAgentLoop } from "../src/agent/loop.ts";
import type { AgentTool } from "../src/agent/types.ts";
import type { ExtensionUiRequest } from "../src/desktop/ui-bridge.ts";
describe("session list/open", () => {
  it("lists and opens sessions by id", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-sess-"));
    const a = SessionManager.create(dir, "a.jsonl");
    a.append({ type: "user", text: "hello from a" });
    const b = SessionManager.create(dir, "b.jsonl");
    b.append({ type: "user", text: "hello from b" });
    const listed = SessionManager.list(dir);
    assert.ok(listed.length >= 2);
    const opened = SessionManager.open(dir, "a");
    assert.equal(opened.id, "a");
    assert.ok(opened.getEntries().some((e) => e.type === "user"));
    assert.equal(SessionManager.remove(dir, "a"), true);
    assert.equal(fs.existsSync(path.join(dir, "a.jsonl")), false);
    assert.equal(SessionManager.remove(dir, "a"), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("desktop runtime settings", () => {
  it("persists settings without leaking apiKey in view", async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-agent-"));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-cwd-"));
    const rt = await createDesktopRuntime({ agentDir, cwd });
    const view = rt.patchSettings({ model: "gpt-test", apiKey: "secret-key" });
    assert.equal(view.model, "gpt-test");
    assert.equal(view.hasApiKey, true);
    assert.equal("apiKey" in view, false);
    const again = await createDesktopRuntime({ agentDir, cwd });
    assert.equal(again.getSettings().model, "gpt-test");
    assert.equal(again.getSettings().hasApiKey, true);
    fs.rmSync(agentDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});

describe("desktop UI bridge", () => {
  it("resolves confirm/select/input via respond", async () => {
    const requests: ExtensionUiRequest[] = [];
    const ui = createDesktopUI((request) => {
      requests.push(request);
    });
    const confirmP = ui.confirm("t", "m");
    assert.equal(requests.at(-1)?.kind, "confirm");
    ui.respond({ id: (requests.at(-1) as { id: string }).id, kind: "confirm", value: true });
    assert.equal(await confirmP, true);

    const selectP = ui.select("pick", ["a", "b"]);
    ui.respond({ id: (requests.at(-1) as { id: string }).id, kind: "select", value: "b" });
    assert.equal(await selectP, "b");

    const inputP = ui.input("name");
    ui.respond({ id: (requests.at(-1) as { id: string }).id, kind: "input", value: "Ada" });
    assert.equal(await inputP, "Ada");

    ui.notify("hello", "info");
    assert.equal(requests.at(-1)?.kind, "notify");
  });
});

describe("desktop runtime extensions inventory", () => {
  it("lists extra extension paths and surfaces load errors", async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-agent-"));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-cwd-"));
    // Aluka 下 fileURLToPath(new URL(...)) 路径不可靠，用 cwd 相对路径
    const greetPath = path.join(process.cwd(), "examples", "extensions", "greet.ts");
    const broken = path.join(cwd, "broken-ext.ts");
    fs.writeFileSync(broken, "throw new Error('boom-ext');\n");
    const events: Array<{ type: string }> = [];
    const rt = await createDesktopRuntime({
      agentDir,
      cwd,
      extraExtensionPaths: [greetPath, broken],
      onEvent: (event) => {
        events.push(event);
      },
    });
    const inv = rt.listExtensions();
    assert.ok(inv.extensions.some((ext) => ext.path === greetPath && ext.tools.includes("greet")));
    assert.ok(
      inv.errors.some((err) => err.path === broken || /broken-ext/.test(err.path)),
      `expected broken ext error, got ${JSON.stringify(inv.errors)}`,
    );
    assert.ok(events.some((e) => e.type === "extension_ui"), `expected extension_ui, got ${JSON.stringify(events)}`);
    const skills = rt.listSkills();
    assert.ok(Array.isArray(skills));
    fs.rmSync(agentDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});

describe("desktop packages & theme", () => {
  it("persists local packages as extensions[] and theme", async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-agent-"));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-cwd-"));
    const greetPath = path.join(process.cwd(), "examples", "extensions", "greet.ts");
    const rt = await createDesktopRuntime({ agentDir, cwd });
    rt.addLocalPackage(greetPath);
    assert.deepEqual(rt.listLocalPackages(), [path.normalize(greetPath)]);
    const view = rt.patchSettings({ theme: "light", provider: "openai", baseUrl: "http://127.0.0.1:11434/v1" });
    assert.equal(view.theme, "light");
    const raw = JSON.parse(fs.readFileSync(path.join(agentDir, "settings.json"), "utf8")) as {
      extensions?: string[];
      extraExtensions?: string[];
      theme?: string;
    };
    assert.ok(raw.extensions?.some((p) => p.toLowerCase() === path.normalize(greetPath).toLowerCase()));
    assert.equal(raw.theme, "light");
    rt.removeLocalPackage(greetPath);
    assert.equal(rt.listLocalPackages().length, 0);
    const again = await createDesktopRuntime({ agentDir, cwd });
    assert.equal(again.getSettings().theme, "light");
    assert.equal(again.listLocalPackages().length, 0);
    fs.rmSync(agentDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});

describe("models.json preview", () => {
  it("projects providers without leaking apiKey", async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-agent-"));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-cwd-"));
    fs.writeFileSync(
      path.join(agentDir, "models.json"),
      JSON.stringify({
        providers: {
          local: {
            baseUrl: "http://127.0.0.1:11434/v1",
            api: "openai-completions",
            apiKey: "super-secret",
            models: [{ id: "llama3", name: "Llama 3" }],
          },
        },
      }),
    );
    const rt = await createDesktopRuntime({ agentDir, cwd });
    const preview = rt.getModelsJsonPreview();
    const alukaSource = preview.sources.find((s) => s.path.includes(agentDir.replace(/\\/g, "\\")) || s.path.startsWith(agentDir));
    assert.ok(alukaSource?.exists);
    assert.equal(alukaSource?.providers[0]?.provider, "local");
    assert.equal(alukaSource?.providers[0]?.hasApiKeyField, true);
    assert.equal(alukaSource?.providers[0]?.models[0]?.id, "llama3");
    const dumped = JSON.stringify(preview);
    assert.equal(dumped.includes("super-secret"), false);
    fs.rmSync(agentDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("upserts / selects / removes providers without leaking secrets", async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-agent-"));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-cwd-"));
    const rt = await createDesktopRuntime({ agentDir, cwd });
    const saved = rt.upsertCustomProvider({
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      api: "openai-completions",
      modelId: "llama3.1",
      modelName: "Llama 3.1",
      apiKey: "secret-ollama-key",
    });
    assert.equal(saved.providers.length, 1);
    assert.equal(saved.providers[0]?.provider, "ollama");
    assert.equal(saved.providers[0]?.baseUrl, "http://127.0.0.1:11434/v1");
    assert.equal(saved.providers[0]?.hasApiKeyField, true);
    assert.equal(JSON.stringify(saved).includes("secret-ollama-key"), false);

    const options = rt.listModelOptions();
    assert.equal(options.length, 1);
    assert.equal(options[0]?.configured, true);

    const settings = rt.selectModel("ollama", "llama3.1");
    assert.equal(settings.provider, "ollama");
    assert.equal(settings.model, "llama3.1");
    assert.equal(settings.baseUrl, "http://127.0.0.1:11434/v1");
    assert.equal(settings.hasApiKey, true);
    assert.equal(JSON.stringify(settings).includes("secret-ollama-key"), false);

    rt.upsertCustomProvider({
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      api: "openai-completions",
      modelId: "qwen2.5",
      modelName: "Qwen",
    });
    assert.equal(rt.getModelsJsonConfig().providers[0]?.models.length, 2);

    rt.removeCustomModel("ollama", "qwen2.5");
    assert.equal(rt.getModelsJsonConfig().providers[0]?.models.length, 1);

    rt.clearProviderApiKey("ollama");
    assert.equal(rt.getModelsJsonConfig().providers[0]?.hasApiKeyField, false);

    rt.removeCustomProvider("ollama");
    assert.equal(rt.getModelsJsonConfig().providers.length, 0);

    fs.rmSync(agentDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});

describe("npm package helpers", () => {
  it("parses specs and resolves extension entry", () => {
    assert.equal(packageNameFromSpec("@scope/pkg@1.2.3"), "@scope/pkg");
    assert.equal(packageNameFromSpec("lodash@4"), "lodash");
    const fixture = path.join(process.cwd(), "scripts", "fixtures", "tiny-ext");
    const entry = resolveExtensionEntry(fixture);
    assert.ok(entry && entry.endsWith("index.js"));
  });

  it("installs file: fixture via npm and registers package", async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-agent-"));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-cwd-"));
    const fixture = path.join(process.cwd(), "scripts", "fixtures", "tiny-ext");
    const spec = `file:${fixture}`;
    const rt = await createDesktopRuntime({ agentDir, cwd });
    const outcome = await rt.installNpmPackage(spec);
    if (!outcome.ok) {
      // 无 npm / 环境受限时跳过集成断言，保留单元覆盖
      assert.ok(/npm|aluka|install/i.test(outcome.error), outcome.error);
      fs.rmSync(agentDir, { recursive: true, force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
      return;
    }
    assert.ok(outcome.entryPath.includes("node_modules"));
    assert.ok(rt.listLocalPackages().some((p) => p === outcome.entryPath));
    fs.rmSync(agentDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});

describe("session export", () => {
  it("writes markdown/json/jsonl under agentDir/exports", async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-agent-"));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-cwd-"));
    const rt = await createDesktopRuntime({ agentDir, cwd });
    const created = rt.createSession();
    assert.ok(created.file);
    fs.appendFileSync(
      created.file,
      `${JSON.stringify({ id: "u1", type: "user", role: "user", text: "hello export", timestamp: Date.now() })}\n`,
    );
    const md = rt.exportSession("markdown", created.id);
    assert.equal(md.ok, true, md.ok === false ? md.error : "");
    if (md.ok) {
      assert.ok(md.path.toLowerCase().includes("exports"));
      assert.ok(fs.readFileSync(md.path, "utf8").includes("hello export"));
    }
    assert.equal(rt.exportSession("json", created.id).ok, true);
    assert.equal(rt.exportSession("jsonl", created.id).ok, true);
    fs.rmSync(agentDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});

describe("session share", () => {
  it("parses gh gist stdout", () => {
    const parsed = parseGhGistStdout("https://gist.github.com/user/abcdef123456\n");
    assert.equal(parsed?.gistId, "abcdef123456");
    assert.ok(parsed?.gistUrl.includes("gist.github.com"));
  });

  it("shares via injected gh runner", async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-agent-"));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-cwd-"));
    const rt = await createDesktopRuntime({ agentDir, cwd });
    const created = rt.createSession();
    fs.appendFileSync(
      created.file,
      `${JSON.stringify({ id: "u1", type: "user", role: "user", text: "share me", timestamp: Date.now() })}\n`,
    );
    const sessionsDir = path.dirname(created.file);
    const outcome = await shareSessionViaGh({
      sessionsDir,
      sessionId: created.id,
      run: async () => ({
        code: 0,
        stdout: "https://gist.github.com/denisse/deadbeefcafe\n",
        stderr: "",
      }),
    });
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.gistId, "deadbeefcafe");
    }
    // empty session should fail
    const empty = rt.createSession();
    const emptyOut = await shareSessionViaGh({
      sessionsDir: path.dirname(empty.file),
      sessionId: empty.id,
      run: async () => ({ code: 0, stdout: "https://gist.github.com/x/y", stderr: "" }),
    });
    assert.equal(emptyOut.ok, false);
    fs.rmSync(agentDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});

describe("session usage", () => {
  it("sums assistant usage and exposes oauth boundary", async () => {
    const { sumUsageFromMessages, buildSessionUsageView } = await import("../src/desktop/session-usage.ts");
    const totals = sumUsageFromMessages([
      {
        role: "assistant",
        content: [{ type: "text", text: "a" }],
        usage: { input: 10, output: 5, cacheRead: 2, totalTokens: 17 },
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "b" }],
        usage: { input: 3, output: 4 },
      },
      { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
    ]);
    assert.equal(totals.input, 13);
    assert.equal(totals.output, 9);
    assert.equal(totals.cacheRead, 2);
    assert.equal(totals.calls, 2);
    assert.equal(totals.totalTokens, 24);

    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-agent-"));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-cwd-"));
    const rt = await createDesktopRuntime({ agentDir, cwd });
    const view = rt.getSessionUsage();
    assert.equal(view.oauthSupported, false);
    assert.equal(view.authMode, "api_key");
    assert.ok(/API key/i.test(view.note));
    assert.equal(view.totals.calls, 0);

    // seed history via session file + reopen
    const created = rt.createSession();
    fs.appendFileSync(
      created.file,
      `${JSON.stringify({
        id: "t1",
        type: "turn",
        timestamp: Date.now(),
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "ok" }],
            usage: { input: 11, output: 7, totalTokens: 18 },
          },
        ],
      })}\n`,
    );
    const opened = rt.openSession(created.id);
    const again = rt.getSessionUsage(opened.id);
    assert.equal(again.totals.input, 11);
    assert.equal(again.totals.output, 7);
    assert.equal(again.totals.calls, 1);
    assert.equal(buildSessionUsageView({ sessionId: "x", messages: [] }).oauthSupported, false);
    fs.rmSync(agentDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});

describe("desktop workspaces", () => {
  it("defaults to a generated temp workspace when cwd is not set", async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-agent-"));
    const rt = await createDesktopRuntime({ agentDir });
    assert.equal(isTemporaryWorkspace(rt.cwd), true);
    const tree = rt.listWorkspaces();
    assert.ok(tree.some((ws) => samePath(ws.path, rt.cwd) && ws.temporary));
    fs.rmSync(agentDir, { recursive: true, force: true });
    fs.rmSync(rt.cwd, { recursive: true, force: true });
  });

  it("groups sessions by workspace and opens across cwd", async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-agent-"));
    const wsA = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-wsA-"));
    const wsB = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-wsB-"));
    const rt = await createDesktopRuntime({ agentDir, cwd: wsA });
    const createdA = rt.createSession();
    fs.appendFileSync(
      createdA.file,
      `${JSON.stringify({ id: "u1", type: "user", role: "user", text: "hello from A", timestamp: Date.now() })}\n`,
    );
    const openedB = rt.selectWorkspace(wsB, "new");
    assert.ok(samePath(openedB.cwd, wsB));
    const createdB = rt.createSession();
    fs.appendFileSync(
      createdB.file,
      `${JSON.stringify({ id: "u2", type: "user", role: "user", text: "hello from B", timestamp: Date.now() })}\n`,
    );

    const tree = rt.listWorkspaces();
    const groupA = tree.find((ws) => samePath(ws.path, wsA));
    const groupB = tree.find((ws) => samePath(ws.path, wsB));
    assert.ok(groupA && groupA.sessions.some((s) => s.id === createdA.id));
    assert.ok(groupB && groupB.sessions.some((s) => s.id === createdB.id));

    const back = rt.openSession(createdA.id, wsA);
    assert.ok(samePath(back.cwd, wsA));
    assert.ok(back.timeline.some((item) => item.text.includes("hello from A")));

    const afterDelete = rt.deleteSession(createdA.id, wsA);
    assert.notEqual(afterDelete.id, createdA.id);
    const treeAfter = rt.listWorkspaces();
    const groupAAfter = treeAfter.find((ws) => samePath(ws.path, wsA));
    assert.ok(groupAAfter && !groupAAfter.sessions.some((s) => s.id === createdA.id));

    const temp = rt.createTempWorkspace("new");
    assert.equal(isTemporaryWorkspace(temp.cwd), true);
    assert.equal(temp.timeline.length, 0);

    fs.rmSync(agentDir, { recursive: true, force: true });
    fs.rmSync(wsA, { recursive: true, force: true });
    fs.rmSync(wsB, { recursive: true, force: true });
    fs.rmSync(temp.cwd, { recursive: true, force: true });
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

describe("runAgentLoop mock still works for desktop projection basis", () => {
  it("runs tool then finishes", async () => {
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
    const produced = await runAgentLoop(
      [{ role: "user", content: [{ type: "text", text: "say hi" }] }],
      { systemPrompt: "test", messages: [], tools: [echo] },
      { model },
      async () => {},
      undefined,
      streamFn,
    );
    assert.equal(calls, 2);
    assert.ok(produced.some((message) => message.role === "toolResult"));
  });
});
