import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createExtensionRuntime, loadExtensions } from "../src/extensions/loader.ts";
import { ExtensionRunner } from "../src/extensions/runner.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-ext-"));
  dirs.push(dir);
  return dir;
}

describe("pi-compatible extensions", () => {
  it("loads a default factory, registers a tool and command, and fires session_start", async () => {
    const cwd = tempDir();
    const extDir = path.join(cwd, ".pi", "extensions");
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(
      path.join(extDir, "greet.ts"),
      `
        export default function (pi) {
          pi.on("session_start", (_event, ctx) => {
            ctx.ui.notify("loaded", "info");
          });
          pi.registerTool({
            name: "greet",
            label: "Greet",
            description: "Greet",
            parameters: { type: "object", properties: { name: { type: "string" } } },
            async execute(_id, params) {
              return { content: [{ type: "text", text: "Hello " + params.name }], details: {} };
            },
          });
          pi.registerCommand("hello", {
            description: "hi",
            handler: async () => {},
          });
        }
      `,
    );

    const loaded = await loadExtensions({ cwd, runtime: createExtensionRuntime() });
    expect(loaded.errors).toEqual([]);
    expect(loaded.extensions).toHaveLength(1);

    const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, cwd, "print");
    runner.bind();
    await runner.emitEvent({ type: "session_start", reason: "startup" });

    expect(runner.getActiveToolNames()).toContain("greet");
    expect(runner.getCommands().map((command) => command.name)).toContain("hello");
  });

  it("blocks a tool call when a handler returns { block: true }", async () => {
    const cwd = tempDir();
    const extDir = path.join(cwd, ".aluka", "extensions");
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(
      path.join(extDir, "block.ts"),
      `
        export default function (pi) {
          pi.on("tool_call", async (event) => {
            if (event.toolName === "greet") return { block: true, reason: "nope" };
          });
          pi.registerTool({
            name: "greet",
            label: "Greet",
            description: "Greet",
            parameters: { type: "object", properties: { name: { type: "string" } } },
            async execute() {
              return { content: [{ type: "text", text: "should not run" }] };
            },
          });
        }
      `,
    );

    const loaded = await loadExtensions({ cwd });
    expect(loaded.errors).toEqual([]);
    const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, cwd, "print");
    runner.bind();
    const ctx = runner.createContext();
    const tool = runner.wrapTool(runner.getRegisteredTools()[0].definition, ctx);
    const result = await tool.execute("1", { name: "Ada" }, undefined, undefined);
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text", text: "nope" });
  });

  it("resolves type-only imports from @earendil-works/pi-coding-agent via jiti alias", async () => {
    const cwd = tempDir();
    const extDir = path.join(cwd, ".pi", "extensions");
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(
      path.join(extDir, "typed.ts"),
      `
        import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
        export default function (pi: ExtensionAPI) {
          pi.registerCommand("ping", {
            description: "ping",
            handler: async () => {},
          });
        }
      `,
    );
    const loaded = await loadExtensions({ cwd });
    expect(loaded.errors).toEqual([]);
    expect(loaded.extensions[0].commands.has("ping")).toBe(true);
  });
});
