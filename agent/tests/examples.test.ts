import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadExtensions } from "../src/extensions/loader.ts";
import { ExtensionRunner } from "../src/extensions/runner.ts";

describe("example pi plugins", () => {
  it("loads examples/extensions/greet.ts written against pi ExtensionAPI", async () => {
    const file = path.resolve("examples/extensions/greet.ts");
    const loaded = await loadExtensions({
      cwd: process.cwd(),
      extraPaths: [file],
    });
    expect(loaded.errors, JSON.stringify(loaded.errors)).toEqual([]);
    const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, process.cwd(), "print");
    runner.bind();
    expect(runner.getActiveToolNames()).toContain("greet");
    const ctx = runner.createContext();
    const tool = runner.wrapTool(runner.getRegisteredTools().find((item) => item.definition.name === "greet")!.definition, ctx);
    const result = await tool.execute("1", { name: "Ada" }, undefined, undefined);
    expect(result.content[0]).toMatchObject({ type: "text", text: "Hello, Ada!" });
  });
});
