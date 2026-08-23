/**
 * 组件档运行时（主进程）——双形态分发
 *
 * - node 桥（默认）：Node 子进程内 jiti+esbuild+React（零构建、HMR 友好）；
 *   适用于 dev / 源码运行 / 具备 node_modules 的打包环境。
 * - embedded 内核：esbuild 打包的 ESM 单文件（src/main/ssr-embedded.mjs，
 *   react/react-dom 编入）+ 插件组件经 **aluka 原生 import**（虚拟模块提供
 *   react/@aluka/ui）；适用于单文件 exe（无 Node/node_modules）。
 *   强制切换：ALUKA_SSR=embedded；Node 桥启动失败时自动回退 embedded。
 *
 * 主进程侧统一保持「RPC 发起（return started）+ emitToUi 事件回传」接口。
 */
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import * as nodeModule from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** apps/desktop */
const appRoot = path.resolve(__dirname, "../..");
const ssrServerPath = path.resolve(appRoot, "scripts/ssr-server.mjs");

/**
 * 嵌入式 SSR 内核路径：按优先级探测
 * 1. 源码目录（dev / aluka run）
 * 2. exe 同目录（编译版；build-gui 拷贝 ssr-embedded.mjs 到产物旁）
 * 3. exe 同目录的上层（便携布局：exe 在 bin/ 或 app/ 子目录）
 */
const embeddedCandidates = [
  path.resolve(appRoot, "src/main/ssr-out/ssr-embedded.mjs"),
  path.join(path.dirname(process.execPath || __dirname), "ssr-embedded.mjs"),
  path.resolve(path.dirname(process.execPath || __dirname), "..", "ssr-embedded.mjs"),
];

function findEmbeddedPath(): string {
  for (const candidate of embeddedCandidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* continue */
    }
  }
  return embeddedCandidates[0]; // 回退源码路径（报错时信息更友好）
}

const embeddedPath = findEmbeddedPath();

type RenderOutcome = { ok: boolean; html?: string; error?: string };

/** aluka 虚拟模块注册（同 loader 用法） */
function registerVirtualModule(name: string, value: unknown): void {
  const register =
    (nodeModule as { registerVirtualModule?: (name: string, value: unknown) => void })
      .registerVirtualModule ??
    (nodeModule as { default?: { registerVirtualModule?: (name: string, value: unknown) => void } })
      .default?.registerVirtualModule;
  if (typeof register === "function") register(name, value);
}

// ── Node 桥形态 ──

let child: ChildProcess | undefined;
let ssrPort: number | undefined;
let startPromise: Promise<number> | undefined;

function startNodeBridge(): Promise<number> {
  if (ssrPort !== undefined) return Promise.resolve(ssrPort);
  if (!startPromise) {
    startPromise = new Promise<number>((resolve, reject) => {
      let stderr = "";
      try {
        child = spawn("node", [ssrServerPath], { stdio: ["ignore", "pipe", "pipe"] });
      } catch (error) {
        startPromise = undefined;
        reject(error);
        return;
      }
      const onData = (chunk: Buffer) => {
        const match = /\[ssr\] ready (\d+)/.exec(chunk.toString());
        if (match && ssrPort === undefined) {
          ssrPort = Number(match[1]);
          resolve(ssrPort);
        }
      };
      child!.stdout?.on("data", onData);
      child!.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
        console.warn("[ssr]", chunk.toString().trimEnd());
      });
      child!.on("error", (error) => {
        startPromise = undefined;
        reject(error);
      });
      child!.on("exit", (code) => {
        if (ssrPort === undefined) {
          startPromise = undefined;
          reject(new Error(`ssr server exited before ready (code ${code})：${stderr}`));
        }
        child = undefined;
        ssrPort = undefined;
        startPromise = undefined;
      });
      setTimeout(() => {
        if (ssrPort === undefined && startPromise) child?.kill();
      }, 10000);
    });
  }
  return startPromise;
}

async function forward(route: string, params: unknown): Promise<RenderOutcome> {
  const port = await startNodeBridge();
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params ?? {}),
  });
  return (await res.json()) as RenderOutcome;
}

// ── Embedded 内核形态 ──

let embeddedPromise: Promise<typeof import("./plugin-ui-core.tsx")> | undefined;

function startEmbedded(): Promise<typeof import("./plugin-ui-core.tsx")> {
  if (!embeddedPromise) {
    embeddedPromise = (async () => {
      const core = (await import(pathToFileURL(embeddedPath).href)) as typeof import("./plugin-ui-core.tsx");
      // 虚拟模块：插件组件经 aluka 原生 import 时的裸说明符解析到宿主单例
      registerVirtualModule("react", (core as { reactEnvironment?: unknown }).reactEnvironment);
      registerVirtualModule("@aluka/ui", {
        Action: (core as { Action?: unknown }).Action,
        Badge: (core as { Badge?: unknown }).Badge,
        Button: (core as { Button?: unknown }).Button,
        Card: (core as { Card?: unknown }).Card,
      });
      core.initCore((modulePath: string) => import(pathToFileURL(modulePath).href));
      return core;
    })().catch((error) => {
      embeddedPromise = undefined;
      throw error;
    });
  }
  return embeddedPromise;
}

// ── 分发 ──

type Transport = "node" | "embedded";
let transport: Transport | undefined;
let transportPromise: Promise<Transport> | undefined;

function resolveTransport(): Promise<Transport> {
  if (transport) return Promise.resolve(transport);
  if (!transportPromise) {
    transportPromise = (async () => {
      // 嵌入内核优先：ssr-embedded.mjs 存在即直接用（编译版 & dev 均可用），
      // 避免编译版先等 Node 桥 10s 超时再回退
      if (fs.existsSync(embeddedPath)) {
        await startEmbedded();
        return "embedded";
      }
      if (process.env.ALUKA_SSR === "embedded") {
        await startEmbedded();
        return "embedded";
      }
      try {
        await startNodeBridge();
        return "node";
      } catch (error) {
        console.warn("[plugin-ui] node 桥不可用，回退嵌入内核", error);
        await startEmbedded();
        return "embedded";
      }
    })().catch((error) => {
      transportPromise = undefined;
      throw error;
    });
    transportPromise.then((resolved) => {
      transport = resolved;
    });
  }
  return transportPromise;
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
  const mode = await resolveTransport();
  let result: RenderOutcome;
  if (mode === "embedded") {
    const core = await startEmbedded();
    result = await core.renderContribution({ modulePath, contributionId, restored });
  } else {
    result = await forward("/render", { modulePath, contributionId, restored });
  }
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
  const mode = await resolveTransport();
  if (mode === "embedded") {
    const core = await startEmbedded();
    const result = await core.runAction({ contributionId, name, payload });
    if (result.ok && result.html) {
      const modulePath = resolveModulePath(contributionId);
      if (modulePath) result.html = injectPluginCss(modulePath, result.html);
    }
    return result;
  }
  return forward("/action", { contributionId, name, payload });
}

/** 从 host 解析贡献 id → 插件组件文件路径（用于 CSS 注入） */
function resolveModulePath(contributionId: string): string | undefined {
  try {
    // host 已就绪时经 RPC 查询；简化：组件路径缓存在首次 render 时
    return modulePathCache.get(contributionId);
  } catch {
    return undefined;
  }
}

/** contributionId → modulePath 缓存（render 时填充，action 时复用） */
const modulePathCache = new Map<string, string>();

/** 卸载组件实例（unmount 清理 + 序列化状态回传） */
export async function unloadPluginComponent(contributionId: string): Promise<void> {
  try {
    const mode = await resolveTransport();
    if (mode === "embedded") {
      const core = await startEmbedded();
      core.unloadComponent({ contributionId });
    } else {
      await forward("/unload", { contributionId });
    }
  } catch {
    /* 卸载失败不阻断 */
  }
}

/** 退出前终止 Node 子进程（嵌入形态无外部进程） */
export function stopSsr(): void {
  try {
    child?.kill();
  } catch {
    /* ignore */
  }
  child = undefined;
  ssrPort = undefined;
  startPromise = undefined;
}

/**
 * 启动预热：无条件预载嵌入内核并注册虚拟模块（react / @aluka/ui）。
 * 必须在任何插件代码 import 前完成（扩展启动期加载、组件随时加载）——
 * node 桥形态下内核加载无副作用（扩展走 jiti 不依赖虚拟模块）。
 */
export async function prewarmPluginUi(): Promise<void> {
  try {
    await startEmbedded();
  } catch {
    /* 内核加载失败：组件档按错误回退处理，不影响主流程 */
  }
}
