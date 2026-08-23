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
    const extDir = path.join(cwd, ".aluka", "extensions");
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

    const loaded = await loadExtensions({ cwd, extraPaths: [path.join(extDir, "greet.ts")], runtime: createExtensionRuntime(), extraPathsOnly: true });
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

    const loaded = await loadExtensions({ cwd, extraPaths: [path.join(extDir, "block.ts")], extraPathsOnly: true });
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
    const extDir = path.join(cwd, ".aluka", "extensions");
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
    const loaded = await loadExtensions({ cwd, extraPaths: [path.join(extDir, "typed.ts")], extraPathsOnly: true });
    expect(loaded.errors).toEqual([]);
    expect(loaded.extensions[0].commands.has("ping")).toBe(true);
  });

  it("resolves contributesData and stores slot data provider (statusbar 数据通道)", async () => {
    const cwd = tempDir();
    const extDir = path.join(cwd, ".aluka", "extensions");
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(
      path.join(extDir, "status.ts"),
      `
        export default function (pi) {
          pi.contributes({ id: "st", version: 2, title: "状态", slot: "statusbar" });
          pi.contributesData("st", ({ cwd, id }) => ({ text: "ok:" + (cwd ?? "-") + ":" + id }));
        }
      `,
    );
    const loaded = await loadExtensions({ cwd, extraPaths: [path.join(extDir, "status.ts")], runtime: createExtensionRuntime(), extraPathsOnly: true });
    expect(loaded.errors).toEqual([]);
    const provider = loaded.extensions[0]?.slotData.get("st");
    expect(typeof provider).toBe("function");
    const data = provider!({ slot: "statusbar" as never, id: "st" });
    expect(data?.text).toContain("ok:");
    expect(loaded.extensions[0]?.uiContributions[0]?.version).toBe(2);
  });

  it("reads manifest contributions from aluka-ui.json (manifest 轨)", async () => {
    const cwd = tempDir();
    const extDir = path.join(cwd, ".aluka", "extensions");
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(
      path.join(extDir, "manifested.ts"),
      `export default function (pi) { pi.registerCommand("ping", { description: "p", handler: async () => {} }); }`,
    );
    fs.writeFileSync(
      path.join(extDir, "aluka-ui.json"),
      JSON.stringify({
        version: 2,
        contributes: [
          { id: "manifest-demo", version: 2, title: "清单贡献", slot: "sidebar.top" },
          { id: "manifest-demo", version: 2, title: "重复", slot: "statusbar" },
          { id: "bad-slot", version: 2, title: "坏槽位", slot: "nope" },
        ],
      }),
    );
    const loaded = await loadExtensions({ cwd, extraPaths: [path.join(extDir, "manifested.ts")], runtime: createExtensionRuntime(), extraPathsOnly: true });
    expect(loaded.errors).toEqual([]);
    const contributions = loaded.extensions[0]?.uiContributions ?? [];
    // manifest 轨：有效条目进入；仅 id 重复、非法 slot 被拒
    expect(contributions).toHaveLength(1);
    expect(contributions[0]?.id).toBe("manifest-demo");
    expect(contributions[0]?.slot).toBe("sidebar.top");
  });
});
