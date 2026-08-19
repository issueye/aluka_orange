import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createConsoleUI } from "../src/extensions/ui.ts";
import type { ExtensionContext } from "../src/extensions/types.ts";
import { readTool, writeTool, editTool } from "../src/tools/files.ts";

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
    expect(read.content[0].type).toBe("text");
    expect((read.content[0] as { text: string }).text).toContain("hello world");
    await editTool.execute(
      "3",
      { path: "a.txt", oldText: "world", newText: "aluka" },
      undefined,
      undefined,
      environment,
    );
    const again = await readTool.execute("4", { path: "a.txt" }, undefined, undefined, environment);
    expect((again.content[0] as { text: string }).text).toContain("hello aluka");
  });
});
