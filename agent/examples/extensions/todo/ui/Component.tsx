import * as React from "react";
import { Action, Button, Card } from "@aluka/ui";
import type { PluginComponent } from "@aluka/coding-agent";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";

type Todo = { id: number; text: string; done: boolean; createdAt: number };
const DATA_FILE = path.join(os.homedir(), ".aluka", "agent", "data", "todo.json");
function loadItems(): Todo[] {
  try { const p = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); return Array.isArray(p) ? p : []; } catch { return []; }
}
function saveItems(items: Todo[]): void {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(items, null, 2), "utf8");
}
function readPluginSetting<T>(key: string, fallback: T): T {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".aluka", "agent", "settings.json"), "utf8"));
    const v = (raw?.pluginSettings ?? {})[key]; return (v as T) ?? fallback;
  } catch { return fallback; }
}

const component: PluginComponent = {
  render: (ctx) => {
    const showDone = readPluginSetting("todo-app.showDoneInCard", true);
    const maxItems = readPluginSetting("todo-app.maxItems", 8);
    const all = loadItems();
    const items = showDone ? all : all.filter((i) => !i.done);
    const open = all.filter((i) => !i.done).length;
    // 折叠状态存 ctx.state（默认折叠：避免占高；恢复/卸载后状态经 serialize/restore 保留）
    const collapsed = ctx.state.collapsed !== false;
    const hasItems = items.length > 0;
    return (
      <Card className={"aluka-plugin-todo" + (collapsed ? " is-collapsed" : " is-expanded")}>
        <div className="aluka-plugin-todo__head">
          <button
            type="button"
            className="aluka-plugin-todo__toggle"
            data-aluka-action="toggle"
            aria-label={collapsed ? "展开待办列表" : "收起待办列表"}
          >
            {hasItems ? (collapsed ? "▾ 展开" : "▴ 收起") : null}
          </button>
          <span className="aluka-plugin-todo__title">待办 {open}/{all.length}</span>
          <Button action="clear" className="aluka-plugin-todo__action">清理已完成</Button>
        </div>
        {!hasItems && !collapsed ? (
          <div className="aluka-plugin-todo__empty">暂无待办 · 输入 /todo add 添加</div>
        ) : null}
        {hasItems && !collapsed ? (
          <ul className="aluka-plugin-todo__list">
            {items.slice(0, maxItems).map((item) => (
              <li key={item.id} className={"aluka-plugin-todo__item is-" + (item.done ? "done" : "pending")}>
                <Action name="done" payload={{ id: item.id }} className="aluka-plugin-todo__state">
                  {item.done ? "✓" : "○"}
                </Action>
                <span className="aluka-plugin-todo__text">{"#" + item.id + " " + item.text}</span>
                <small className="aluka-plugin-todo__desc">{item.done ? "已完成" : "待办"}</small>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    );
  },
  actions: {
    toggle: async (ctx) => {
      ctx.state.collapsed = ctx.state.collapsed !== false ? false : true;
      ctx.changed();
    },
    done: async (ctx, payload) => {
      const id = Number((payload as { id?: unknown })?.id);
      const items = loadItems(); const item = items.find((c) => c.id === id);
      if (!item) return; item.done = true; saveItems(items); ctx.changed();
    },
    clear: async (ctx) => { saveItems(loadItems().filter((i) => !i.done)); ctx.changed(); },
  },
  serialize: (ctx) => ctx.state,
  restore: (ctx, state) => { ctx.state = state ?? {}; },
};
export default component;