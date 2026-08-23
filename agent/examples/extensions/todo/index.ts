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

  // ── 命令：/todo add|list|done|clear ──
  pi.registerCommand("todo", {
    description: "待办管理：/todo add <文本> | list | done <编号> | clear",
    handler: async (args, ctx) => {
      const parts = (args ?? "").trim().split(/\s+/);
      const op = parts[0] ?? "list";

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
    description: "向 TODO 列表添加任务（用户表达需要记录/跟进事项时使用）",
    parameters: Type.Object({
      text: Type.String({ description: "任务内容" }),
    }),
    async execute(_id, params) {
      const item: Todo = { id: nextId(items), text: params.text, done: false, createdAt: Date.now() };
      items.push(item);
      saveItems(items);
      pushTodoItem(item);
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
      const removed = items.length - openCount();
      items = items.filter((item) => !item.done);
      saveItems(items);
      return {
        content: [{ type: "text", text: removed ? `已清理 ${removed} 个已完成任务` : "没有已完成的任务可清理" }],
        details: { removed },
      };
    },
  });
}
