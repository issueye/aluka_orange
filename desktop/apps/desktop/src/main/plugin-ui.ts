/**
 * 组件档运行时（主进程）——单一嵌入式形态
 *
 * 主进程直接 import 本目录 plugin-ui-core.tsx（常量动态 import：dev 走运行时
 * TSX 加载、打包版编入 payload），渲染核心在模块图内，无预构建产物、无 node
 * 子进程。插件组件经 **aluka 原生 import**（虚拟模块提供 react/@aluka/ui 宿主
 * 单例）。
 *
 * 主进程侧统一保持「RPC 发起（return started）+ emitToUi 事件回传」接口。
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as nodeModule from "node:module";
// react 单例与 @aluka/ui 基元直接静态导入——插件组件经虚拟模块解析到同一实例
// （Redux 单例语义）。不经 plugin-ui-core 中转：aluka build 的 tree-shake 会剪掉
// 「运行时才被动态访问」的导出，静态导入+使用可被保留，dev 与产物行为一致。
import * as React from "react";
import { Action, Badge, Button, Card } from "./plugin-ui-kit.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type RenderOutcome = { ok: boolean; html?: string; error?: string };

/** aluka 虚拟模块注册（插件组件 import "react" / "@aluka/ui" 时命中） */
function registerVirtualModule(name: string, value: unknown): void {
  const register =
    (nodeModule as { registerVirtualModule?: (name: string, value: unknown) => void })
      .registerVirtualModule ??
    (nodeModule as { default?: { registerVirtualModule?: (name: string, value: unknown) => void } })
      .default?.registerVirtualModule;
  if (typeof register === "function") register(name, value);
}

let embeddedPromise: Promise<typeof import("./plugin-ui-core.tsx")> | undefined;

function startEmbedded(): Promise<typeof import("./plugin-ui-core.tsx")> {
  if (!embeddedPromise) {
    embeddedPromise = (async () => {
      // 常量说明符动态 import：编译期即入依赖图（dev 从磁盘加载 TSX，打包版从 payload 加载）
      const core = await import("./plugin-ui-core.tsx");
      console.log("[plugin-ui] core loaded from module graph");
      // 虚拟模块：插件组件经 aluka 原生 import 时的裸说明符解析到宿主单例
      registerVirtualModule("react", React);
      registerVirtualModule("@aluka/ui", { Action, Badge, Button, Card });
      core.initCore((modulePath: string) => import(pathToFileURL(modulePath).href));
      return core;
    })().catch((error) => {
      embeddedPromise = undefined;
      throw error;
    });
  }
  return embeddedPromise;
}

/**
 * 插件组件样式注入：读取 modulePath 同目录的 component.css，
 * 以 <style> 前缀注入到渲染出的 HTML 片段（每次渲染重新读取，支持热更新）。
 */
function injectPluginCss(modulePath: string, html: string): string {
  try {
    const cssPath = path.join(path.dirname(modulePath), "component.css");
    if (fs.existsSync(cssPath)) {
      const css = fs.readFileSync(cssPath, "utf8");
      return `<style data-aluka-plugin-css>${css}</style>${html}`;
    }
  } catch {
    /* 样式读取失败不阻断渲染 */
  }
  return html;
}

/** 渲染组件片段（restored 可选：重建时恢复状态）；自动注入同目录 component.css */
export async function renderPluginComponent(
  modulePath: string,
  contributionId: string,
  restored?: unknown,
): Promise<RenderOutcome> {
  const core = await startEmbedded();
  const result = await core.renderContribution({ modulePath, contributionId, restored });
  // 缓存 modulePath（action 时 CSS 注入用）
  modulePathCache.set(contributionId, modulePath);
  if (result.ok && result.html) {
    result.html = injectPluginCss(modulePath, result.html);
  }
  return result;
}

/** 执行交互动作 → 处理器 → 重渲染片段（同 render 注入 component.css） */
export async function runPluginComponentAction(
  contributionId: string,
  name: string,
  payload?: unknown,
): Promise<RenderOutcome> {
  const core = await startEmbedded();
  const result = await core.runAction({ contributionId, name, payload });
  if (result.ok && result.html) {
    const modulePath = resolveModulePath(contributionId);
    if (modulePath) result.html = injectPluginCss(modulePath, result.html);
  }
  return result;
}

/** contributionId → modulePath 缓存（render 时填充，action 时复用） */
const modulePathCache = new Map<string, string>();

/** 从 host 解析贡献 id → 插件组件文件路径（用于 CSS 注入） */
function resolveModulePath(contributionId: string): string | undefined {
  try {
    // host 已就绪时经 RPC 查询；简化：组件路径缓存在首次 render 时
    return modulePathCache.get(contributionId);
  } catch {
    return undefined;
  }
}

/** 卸载组件实例（unmount 清理 + 序列化状态回传） */
export async function unloadPluginComponent(contributionId: string): Promise<void> {
  try {
    const core = await startEmbedded();
    core.unloadComponent({ contributionId });
  } catch {
    /* 卸载失败不阻断 */
  }
}

/**
 * 刷新已渲染的组件档（数据变化触发；slot_data_changed 消费方）。
 * 卸载拿回序列化状态再重渲染恢复（折叠等 UI 状态不丢）；
 * 未渲染过的组件档不主动拉起，返回 undefined。
 */
export async function refreshPluginComponent(contributionId: string): Promise<RenderOutcome | undefined> {
  const modulePath = modulePathCache.get(contributionId);
  if (!modulePath) return undefined;
  const core = await startEmbedded();
  const { state } = core.unloadComponent({ contributionId });
  const result = await core.renderContribution({ modulePath, contributionId, restored: state });
  if (result.ok && result.html) {
    result.html = injectPluginCss(modulePath, result.html);
  }
  return result;
}

/**
 * 启动预热：无条件预载嵌入内核并注册虚拟模块（react / @aluka/ui）。
 * 必须在任何插件代码 import 前完成（扩展启动期加载、组件随时加载）。
 */
export async function prewarmPluginUi(): Promise<void> {
  try {
    await startEmbedded();
  } catch {
    /* 内核加载失败：组件档按错误回退处理，不影响主流程 */
  }
}