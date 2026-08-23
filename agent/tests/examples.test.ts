import fs from "node:fs";
import os from "node:os";
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
      extraPathsOnly: true,
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

  it("loads examples/extensions/todo.ts with v2 slots, slot data and custom entries", async () => {
    const prev = process.env.ALUKA_TODO_DATA_FILE;
    process.env.ALUKA_TODO_DATA_FILE = path.join(
      process.env.TEMP ?? process.env.TMP ?? os.tmpdir(),
      `aluka-todo-test-${Date.now()}.json`,
    );
    try {
      const file = path.resolve("examples/extensions/todo/index.ts");
      const loaded = await loadExtensions({
        cwd: process.cwd(),
        extraPaths: [file],
        extraPathsOnly: true,
      });
      expect(loaded.errors, JSON.stringify(loaded.errors)).toEqual([]);
      const extension = loaded.extensions[0];
      expect(extension).toBeDefined();

      // v2 槽位贡献：statusbar + chat.composer.before
      const slots = (extension!.uiContributions ?? []).map((c) => (c.version === 2 ? c.slot : "v1"));
      expect(slots).toContain("statusbar");
      expect(slots).toContain("chat.composer.before");

      // 数据提供者：待办计数（badge 形态）+ board（列表形态）
      const provider = extension!.slotData.get("todo-app/status");
      expect(typeof provider).toBe("function");
      const data = provider!({ slot: "statusbar" as never, id: "todo-app/status", cwd: process.cwd() });
      expect(data?.text).toContain("待办");
      const boardProvider = extension!.slotData.get("todo-app/board");
      expect(typeof boardProvider).toBe("function");
      const board = boardProvider!({ slot: "chat.composer.before" as never, id: "todo-app/board", cwd: process.cwd() });
      expect(board).toHaveProperty("items");
      expect(Array.isArray((board as { items?: unknown[] }).items)).toBe(true);

      // 设置贡献：settings.section + 前缀约束（坏前缀会导致 loader 校验拒绝，errors 为空即通过）
      const settingsContribution = extension!.uiContributions.find((c) => c.id === "todo-app/settings");
      expect(settingsContribution?.version).toBe(2);
      expect(
        Object.keys((settingsContribution as { settings?: Record<string, unknown> }).settings ?? {}),
      ).toEqual(["todo-app.showDoneInCard", "todo-app.maxItems"]);

      // 工具集：add/list/done/clear 全部可执行（经 ALUKA_TODO_DATA_FILE 隔离到临时文件）
      const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, process.cwd(), "print");
      runner.bind();
      const toolNames = runner.getActiveToolNames();
      expect(toolNames).toContain("todo_add");
      expect(toolNames).toContain("todo_list");
      expect(toolNames).toContain("todo_done");
      expect(toolNames).toContain("todo_clear");
      const ctx = runner.createContext();
      const runTool = async (name: string, params: unknown) => {
        const def = runner.getRegisteredTools().find((item) => item.definition.name === name)!;
        const wrapped = runner.wrapTool(def.definition, ctx);
        return wrapped.execute("1", params, undefined, undefined);
      };
      const addResult = await runTool("todo_add", { text: "测试任务" });
      expect(String(addResult.content[0]?.text ?? "")).toContain("已添加任务");
      const listResult = await runTool("todo_list", {});
      expect(String(listResult.content[0]?.text ?? "")).toContain("#1");
      const doneResult = await runTool("todo_done", { id: 1 });
      expect(String(doneResult.content[0]?.text ?? "")).toContain("已完成");
      const clearResult = await runTool("todo_clear", {});
      expect(String(clearResult.content[0]?.text ?? "")).toContain("已清理");
    } finally {
      if (prev === undefined) delete process.env.ALUKA_TODO_DATA_FILE;
      else process.env.ALUKA_TODO_DATA_FILE = prev;
      try {
        fs.rmSync(process.env.ALUKA_TODO_DATA_FILE ?? "", { force: true });
      } catch {
        /* ignore */
      }
    }
  });
});
