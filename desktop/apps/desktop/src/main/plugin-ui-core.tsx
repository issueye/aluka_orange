/**
 * 组件档渲染核心（双载体运行时共用）
 *
 * - Node 子进程版（scripts/ssr-server.mjs）：经 jiti 加载本文件（alias 提供 react/@aluka/ui）；
 * - 嵌入版：aluka 主进程常量动态 import 本文件（dev 走运行时 TSX 加载、打包版编入
 *   payload；ssr-embedded.mjs 预构建产物仅作旧运行时回退）。插件组件由 importer
 *   经 aluka 原生编译加载。
 *
 * 本文件不含 Node/HTTP 依赖：实例缓存 + 渲染 + action + 卸载；
 * 组件导入器由 initCore 注入（jiti 或 aluka 原生 import）。
 */
import { createElement } from "react";
// 浏览器变体引用 stream/crypto 等 Node 内置，aluka 运行时（单文件 exe）无法解析 node 变体；
// server.browser 提供同一 renderToString API，Node 子进程（ssr-server.mjs）下同样可用。
import { renderToString } from "react-dom/server.browser";
import type {
  PluginComponent,
  PluginComponentContext,
} from "../../../../../agent/src/extensions/contracts/shell.ts";

interface ComponentEntry {
  instance: PluginComponent;
  ctx: PluginComponentContext;
  dirty: boolean;
}

const instances = new Map<string, ComponentEntry>();

/** 模块导入器（jiti 或 aluka 原生 import；支持插件 TSX 源码） */
let importer: (modulePath: string) => Promise<unknown> = (modulePath) =>
  Promise.resolve().then(() => import(modulePath));

export function initCore(importFn: (modulePath: string) => Promise<unknown>): void {
  importer = importFn;
}

export interface CoreRenderResult {
  ok: boolean;
  html?: string;
  error?: string;
}

async function loadComponent(modulePath: string, contributionId: string): Promise<ComponentEntry> {
  const existing = instances.get(contributionId);
  if (existing) return existing;
  const loaded = (await importer(modulePath)) as
    | { default?: PluginComponent }
    | PluginComponent;
  const instance = (typeof loaded === "object" && loaded !== null && "default" in loaded
    ? loaded.default
    : loaded) as PluginComponent | undefined;
  if (!instance || typeof instance.render !== "function") {
    throw new Error(`uiModule 未默认导出 PluginComponent（期望 render 函数）：${modulePath}`);
  }
  const ctx: PluginComponentContext = {
    state: {},
    changed: () => undefined,
    notify: () => undefined,
    session: {},
  };
  const entry: ComponentEntry = { instance, ctx, dirty: false };
  ctx.changed = () => {
    entry.dirty = true;
  };
  instances.set(contributionId, entry);
  return entry;
}

function toHtml(element: unknown): string {
  return renderToString(
    createElement("span", { className: "aluka-plugin-component-root" }, [element as never]),
  );
}

async function timeout(promise: Promise<unknown>, ms: number, label: string): Promise<unknown> {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms)),
  ]);
}

export async function renderContribution(params: {
  modulePath: string;
  contributionId: string;
  restored?: unknown;
}): Promise<CoreRenderResult> {
  try {
    const entry = (await timeout(
      loadComponent(params.modulePath, params.contributionId),
      1200,
      "组件加载",
    )) as ComponentEntry;
    if (params.restored !== undefined && entry.instance.restore) {
      entry.instance.restore(entry.ctx, params.restored);
    }
    entry.dirty = false;
    const element = await timeout(
      Promise.resolve(entry.instance.render(entry.ctx)),
      100,
      "组件渲染",
    );
    return { ok: true, html: toHtml(element) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function runAction(params: {
  contributionId: string;
  name: string;
  payload?: unknown;
}): Promise<CoreRenderResult> {
  const entry = instances.get(params.contributionId);
  if (!entry) return { ok: false, error: "组件未初始化（先 render）" };
  const handler = entry.instance.actions?.[params.name];
  if (!handler) return { ok: false, error: `action 不存在：${params.name}` };
  try {
    entry.dirty = false;
    await timeout(Promise.resolve(handler(entry.ctx, params.payload)), 2000, "action");
    if (!entry.dirty) return { ok: true };
    const element = entry.instance.render(entry.ctx);
    return { ok: true, html: toHtml(element) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 卸载组件实例：unmount 清理 + 返回序列化状态（重建恢复通道） */
export function unloadComponent(params: {
  contributionId: string;
}): { ok: boolean; state?: unknown } {
  const entry = instances.get(params.contributionId);
  if (!entry) return { ok: true };
  let state: unknown;
  try {
    state = entry.instance.serialize?.(entry.ctx);
  } catch {
    /* 序列化失败不阻断卸载 */
  }
  try {
    entry.instance.unmount?.(entry.ctx);
  } catch {
    /* 清理失败不阻断运行 */
  }
  instances.delete(params.contributionId);
  return { ok: true, state };
}

/** 清理所有组件实例（扩展重载时丢弃旧定义） */
export function clearAllComponents(): void {
  for (const params of [...instances.keys()]) {
    try {
      instances.get(params)?.instance.unmount?.(instances.get(params)!.ctx);
    } catch {
      /* ignore */
    }
  }
  instances.clear();
}
