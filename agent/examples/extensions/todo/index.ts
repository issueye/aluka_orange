import type { ExtensionAPI } from "@aluka/coding-agent";
import { Type } from "typebox";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * TODO 演示插件（测试壳层插件体系，见 desktop/docs/shell-plugin-design.md）
 *
 * 覆盖能力：
 * - v2 槽位贡献：statusbar（计数徽章）+ chat.composer.before（数据驱动 TODO 组件卡）
 * - contributesData 数据提供者：badge 形态（状态栏）与列表形态（composer 组件卡）
 * - appendEntry 时间线自定义条目（customType: todo-app/item、todo-app/list）
 * - 命令 /todo + 工具集 todo_add / todo_list / todo_done / todo_clear（agent 可自主管理）
 *
 * 数据：~/.aluka/agent/data/todo.json（热重载后从磁盘恢复；ALUKA_TODO_DATA_FILE 可覆盖）
 */

type Todo = { id: number; text: string; done: boolean; createdAt: number };

const DATA_FILE =
  process.env.ALUKA_TODO_DATA_FILE ??
  path.join(process.env.ALUKA_HOME ?? os.homedir(), ".aluka", "agent", "data", "todo.json");
const DATA_DIR = path.dirname(DATA_FILE);

function loadItems(): Todo[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as Todo[]) : [];
  } catch {
    return [];
  }
}

function saveItems(items: Todo[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(items, null, 2), "utf8");
}

function nextId(items: Todo[]): number {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}

/** 列表数据（composer 组件卡形态）：待办在前、已完成在后 */
function boardData(items: Todo[]) {
  const open = items.filter((item) => !item.done);
  const done = items.filter((item) => item.done);
  return {
    items: [
      ...open.map((item) => ({
        title: `#${item.id} ${item.text}`,
        state: "pending" as const,
        desc: "待办",
      })),
      ...done.map((item) => ({
        title: `#${item.id} ${item.text}`,
        state: "done" as const,
        desc: "已完成",
      })),
    ],
    summary: items.length ? `待办 ${open.length}/${items.length}` : undefined,
    empty: "暂无待办 · 输入 /todo add 添加，或直接让 Agent 用 todo_add 记录",
  };
}

export default function (pi: ExtensionAPI) {
  let items = loadItems();
  const openCount = () => items.filter((item) => !item.done).length;

  /** 时间线自定义条目（appendEntry 链路，UI 按 customType 摘要渲染） */
  const pushTodoItem = (item: Todo) =>
    pi.appendEntry("todo-app/item", { id: item.id, text: item.text, done: item.done });

  // ── v2 槽位：状态栏（badge 形态计数）──
  pi.contributes({
    id: "todo-app/status",
    version: 2,
    title: "待办",
    icon: "wrench",
    slot: "statusbar",
    when: "aluka.workspaceOpen",
  });
  pi.contributesData("todo-app/status", () => {
    const current = loadItems(); // 实时读盘：组件档 action 直接写盘，badge 轮询同步
    const open = current.filter((item) => !item.done).length;
    return {
      text: current.length ? `待办 ${open}/${current.length}` : "无待办",
      kind: open > 0 ? "warning" : "success",
    };
  });

  // ── v2 槽位：输入框上方 TODO 组件卡（列表形态数据）──
  pi.contributes({
    id: "todo-app/board",
    version: 2,
    title: "TODO",
    icon: "wrench",
    slot: "chat.composer.before",
    when: "aluka.workspaceOpen",
    description: "待办列表：输入 /todo add 添加，或让 Agent 用 todo_add 记录",
    uiModule: "ui/Component.tsx",
  });
  pi.contributesData("todo-app/board", () => boardData(items));

  // ── v2 槽位：设置贡献（settings.section → 宿主设置页自动渲染表单）──
  pi.contributes({
    id: "todo-app/settings",
    version: 2,
    title: "TODO 插件设置",
    slot: "settings.section",
    settings: {
      "todo-app.showDoneInCard": {
        type: "boolean",
        label: "组件卡显示已完成",
        description: "输入框上方 TODO 组件是否展示已完成条目（默认展示）",
        default: true,
      },
      "todo-app.maxItems": {
        type: "number",
        label: "组件卡最多显示条数",
        default: 8,
        min: 1,
        max: 20,
      },
    },
  });

  // ── 系统提示词注入：任务工作流（需求分析 → 制定 TODO → 逐项执行 → 总结）──
  // 动态片段：每次组装系统提示词时求值，顺带携带当前待办数作为上下文。
  pi.registerSystemPrompt(() => {
    const open = loadItems().filter((item) => !item.done).length;
    return [
      "## 任务执行流程（必须遵守）",
      "",
      "接到用户任务时，按以下顺序工作：",
      "1. **需求分析**：先输出一段「需求分析」，用几句话说明任务目标、约束与边界；",
      "2. **制定计划**：紧接着**调用 todo_add 工具**（每步一条、可独立验证）——用文字描述计划不算完成此步骤；调用执行类工具（read/bash/write/edit 等）前必须先建计划；",
      "3. **逐项执行**：严格按计划顺序，每完成一项立刻用 todo_done 标记对应编号；",
      "4. **收尾总结**：全部完成后用 todo_list 确认无未完成项，再向用户汇报结果。",
      "",
      `当前待办：${open} 项未完成。`,
      "例外：纯问答、闲聊或一步能完成且无副作用的小改动，可不建计划直接回答。",
      "计划中途有变或任务较大时，随时补加 TODO 条目，保持计划与执行同步。",
    ].join("\n");
  });

  // ── 计划门控：任务开始后未建计划时，拦截首个执行类工具调用（每任务最多拦一次，防死循环）──
  // 提示词是建议，门控是强制：轻量模型跳过 todo_add 直接干活时，第一次会被
  // 拦下并收到明确指令；「继续」场景（已有未完成计划）不拦。
  let planReady = true;
  let gatedThisTask = false;
  pi.on("agent_start", () => {
    planReady = loadItems().some((item) => !item.done); // 有未完成计划视为任务进行中
    gatedThisTask = false;
  });
  pi.on("tool_call", (event) => {
    if (event.toolName.startsWith("todo_")) {
      if (event.toolName === "todo_add") planReady = true;
      return;
    }
    if (planReady || gatedThisTask) return;
    gatedThisTask = true;
    return {
      block: true,
      reason:
        "任务执行流程：请先用 todo_add 制定计划（每步一条，说明目标后逐条添加），然后再执行任务步骤。",
    };
  });

  // ── 命令：/todo add|list|done|clear ──
  pi.registerCommand("todo", {
    description: "待办管理：/todo add <文本> | list | done <编号> | clear",
    handler: async (args, ctx) => {
      const parts = (args ?? "").trim().split(/\s+/);
      const op = parts[0] ?? "list";
      items = loadItems(); // 以盘为准：组件档 action 等其他写方可能已修改

      if (op === "add") {
        const text = parts.slice(1).join(" ").trim();
        if (!text) {
          ctx.ui.notify("用法：/todo add 任务内容", "warning");
          return;
        }
        const item: Todo = { id: nextId(items), text, done: false, createdAt: Date.now() };
        items.push(item);
        saveItems(items);
        pushTodoItem(item);
        ctx.ui.notify(`已添加 #${item.id}：${text}`, "success");
        return;
      }

      if (op === "done") {
        const id = Number(parts[1]);
        const item = items.find((candidate) => candidate.id === id);
        if (!item) {
          ctx.ui.notify(`未找到 #${parts[1] ?? ""}，用 /todo list 查看`, "warning");
          return;
        }
        item.done = true;
        saveItems(items);
        pushTodoItem(item);
        ctx.ui.notify(`已完成 #${item.id}：${item.text}`, "success");
        return;
      }

      if (op === "clear") {
        const removed = items.length - openCount();
        items = items.filter((item) => !item.done);
        saveItems(items);
        ctx.ui.notify(`已清理 ${removed} 个已完成任务`, "info");
        return;
      }

      // list（默认）
      if (!items.length) {
        ctx.ui.notify("暂无待办：/todo add 任务内容 添加", "info");
        return;
      }
      pi.appendEntry("todo-app/list", {
        open: items.filter((item) => !item.done).map((item) => ({ id: item.id, text: item.text })),
        done: items.filter((item) => item.done).length,
      });
      ctx.ui.notify(`待办 ${openCount()} 项，已完成 ${items.length - openCount()} 项（详见时间线）`, "info");
    },
  });

  // ── 工具集：agent 自主管理 TODO ──

  pi.registerTool({
    name: "todo_add",
    label: "Todo Add",
    description:
      "向 TODO 列表添加任务条目。任务工作流的计划入口：接到任务必须先做需求分析，再用本工具制定计划，之后才能开始执行",
    promptSnippet: "添加/更新 TODO 计划（任务工作流：需求分析 → 制定计划 → 逐项执行 → 总结）",
    parameters: Type.Object({
      text: Type.String({ description: "任务内容" }),
    }),
    async execute(_id, params) {
      items = loadItems(); // 以盘为准：组件档 action 等其他写方可能已修改
      const item: Todo = { id: nextId(items), text: params.text, done: false, createdAt: Date.now() };
      items.push(item);
      saveItems(items);
      pushTodoItem(item);
      pi.refreshData("todo-app/board");
      return {
        content: [{ type: "text", text: `已添加任务 #${item.id}：${item.text}（当前待办 ${openCount()} 项）` }],
        details: { id: item.id },
      };
    },
  });

  pi.registerTool({
    name: "todo_list",
    label: "Todo List",
    description: "列出当前 TODO 列表（未完成在前、已完成在后），返回文本列表",
    parameters: Type.Object({}),
    async execute() {
      items = loadItems(); // 以盘为准
      if (!items.length) {
        return { content: [{ type: "text", text: "暂无待办任务" }], details: {} };
      }
      const open = items.filter((item) => !item.done);
      const done = items.filter((item) => item.done);
      const text = [
        ...open.map((item) => `#${item.id} ${item.text}`),
        ...(done.length ? ["", `已完成：${done.map((item) => `#${item.id} ${item.text}`).join("；")}`] : []),
      ].join("\n");
      return {
        content: [{ type: "text", text }],
        details: { open: open.length, done: done.length },
      };
    },
  });

  pi.registerTool({
    name: "todo_done",
    label: "Todo Done",
    description: "把指定编号的 TODO 任务标记为已完成（带编号，用 todo_list 查看）",
    parameters: Type.Object({
      id: Type.Number({ description: "任务编号（todo_list 中的 #ID）" }),
    }),
    async execute(_id, params) {
      items = loadItems(); // 以盘为准：组件档 action 等其他写方可能已修改
      const item = items.find((candidate) => candidate.id === params.id);
      if (!item) {
        return {
          content: [{ type: "text", text: `未找到任务 #${String(params.id)}，用 todo_list 查看最新列表` }],
          details: { found: false },
        };
      }
      item.done = true;
      saveItems(items);
      pushTodoItem(item);
      pi.refreshData("todo-app/board");
      return {
        content: [{ type: "text", text: `已完成 #${item.id}：${item.text}（剩余待办 ${openCount()} 项）` }],
        details: { id: item.id, found: true },
      };
    },
  });

  pi.registerTool({
    name: "todo_clear",
    label: "Todo Clear",
    description: "清理所有已完成的 TODO 任务",
    parameters: Type.Object({}),
    async execute() {
      items = loadItems(); // 以盘为准
      const removed = items.length - openCount();
      items = items.filter((item) => !item.done);
      saveItems(items);
      pi.refreshData("todo-app/board");
      return {
        content: [{ type: "text", text: removed ? `已清理 ${removed} 个已完成任务` : "没有已完成的任务可清理" }],
        details: { removed },
      };
    },
  });
}
