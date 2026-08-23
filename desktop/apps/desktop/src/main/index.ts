/**
 * Aluka Desktop 主进程（Phase 4）
 *
 * - 无边框窗口 + 托盘（关闭按钮退出；托盘可再开窗口）
 * - 退出前中止任务、杀掉子进程，避免残留
 * - registerRPC 不 await Promise：异步用 fire-and-forget + win.emit
 */
import { app, createWindow, createTray, setAssetDir, globalShortcut, shell } from "aluka:gui";
import { createDesktopHost, type DesktopHost } from "../host/index.ts";
import { pickFolder } from "../host/choose-folder.ts";
import { startHttpServer, type RpcHandler } from "./http-server.ts";
import { PROTOCOL_VERSION } from "../shared/contracts.ts";
import { VERSION } from "../../../../../agent/src/config.ts";
import { coerceApi } from "../../../../../agent/src/ai/types.ts";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "../..");
const uiDir = path.resolve(appRoot, "dist/ui");
const iconPath = path.resolve(appRoot, "assets/icon.ico");
const alukaPiRoot = path.resolve(appRoot, "../../../agent");
const demoExts = [
  path.join(alukaPiRoot, "examples", "extensions", "greet.ts"),
  path.join(alukaPiRoot, "examples", "extensions", "guard.ts"),
].filter((p) => fs.existsSync(p));

setAssetDir(uiDir);

// —— M2 HTTP 服务：静态页面 + RPC/事件通道 ——
// 磁盘 dist/ui 存在（开发态 / aluka run）时 GUI 改走 URL 并开放浏览器访问；
// 打包 exe 资产内嵌于 aluka:// 虚拟协议，回落原方案（见 docs/http-and-plugin-roadmap.md）。
// 开发态环境变量：ALUKA_HTTP_PORT / ALUKA_HTTP_TOKEN 固定端口与 token（配合 vite 代理）；
// ALUKA_HEADLESS=1 无窗口运行（纯浏览器 / HMR 开发流，scripts/dev.mjs）。
const rpcHandlers = new Map<string, RpcHandler>();
const hasDiskUi = fs.existsSync(path.join(uiDir, "index.html"));
const headless = process.env.ALUKA_HEADLESS === "1";
const httpPort = Number.parseInt(process.env.ALUKA_HTTP_PORT ?? "", 10) || undefined;
const httpToken = process.env.ALUKA_HTTP_TOKEN?.trim() || undefined;
const httpServer = startHttpServer({
  staticDir: hasDiskUi ? uiDir : undefined,
  rpcHandlers,
  port: httpPort,
  token: httpToken,
});
if (httpServer.servingStatic) {
  // 开发态：GUI 走该地址；同地址可在浏览器打开（含 token）
  console.log(`[aluka-desktop] http page: ${httpServer.pageUrl}`);
}

const win = headless ? undefined : createWindow({
  title: "Aluka Desktop",
  width: 1200,
  height: 780,
  minWidth: 900,
  minHeight: 560,
  center: true,
  frame: false,
  // 打包产物可关；开发期保持便于调试
  devTools: !process.env.ALUKA_DESKTOP_PACKAGED,
  url: httpServer.servingStatic ? httpServer.pageUrl : "aluka://app/index.html",
});

/** RPC 双注册：GUI 桥接（app.registerRPC）与 HTTP 通道共用同一 handler */
function registerRPC(name: string, handler: (params: any) => unknown) {
  rpcHandlers.set(name, handler as RpcHandler);
  app.registerRPC(name, handler);
}

/** 事件扇出：GUI 桥接（win.emit）与 HTTP 长轮询（httpServer.emit）同发 */
function emitToUi(name: string, data: unknown) {
  if (win) {
    try {
      win.emit(name, data);
    } catch (err) {
      console.warn("[aluka-desktop] win.emit failed", name, err);
    }
  }
  httpServer.emit(name, data);
}

const trayOpts: {
  tooltip: string;
  icon?: string;
  menu: Array<{ label?: string; type?: string; click?: () => void }>;
} = {
  tooltip: "Aluka Desktop",
  menu: [
    { label: "显示主窗口", click: () => win?.show() },
    { type: "separator" },
    { label: "退出", click: () => shutdown() },
  ],
};
if (fs.existsSync(iconPath)) {
  trayOpts.icon = iconPath;
}

const tray = headless ? undefined : createTray(trayOpts);
tray?.on("click", () => win?.show());

try {
  // globalShortcut.register("Ctrl+Alt+A", () => win.show());
} catch (err) {
  console.warn("[aluka-desktop] globalShortcut register failed", err);
}

type SettingsPatch = {
  model?: string;
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  cwd?: string;
  theme?: "dark" | "light";
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  extraExtensions?: string[];
  sidebarWidth?: number;
};

let host: DesktopHost | undefined;

function runtimeInfoFallback() {
  return {
    protocolVersion: PROTOCOL_VERSION,
    product: "aluka-desktop" as const,
    productVersion: VERSION,
    platform: process.platform,
    arch: process.arch,
    agentDirHint: "",
    phase: "5",
    hostReady: false,
  };
}

function requireHost(): DesktopHost {
  if (!host) {
    throw new Error("host not ready");
  }
  return host;
}

registerRPC("ping", () => ({ ok: true, ts: Date.now(), protocolVersion: PROTOCOL_VERSION }));
registerRPC("getRuntimeInfo", () => {
  if (!host) return runtimeInfoFallback();
  return { ...host.getRuntimeInfo(), hostReady: true };
});
registerRPC("getSettings", () => requireHost().getSettings());
registerRPC("patchSettings", (params: SettingsPatch) => requireHost().patchSettings(params ?? {}));
registerRPC("listProviderPresets", () => requireHost().listProviderPresets());
registerRPC("listSessions", () => requireHost().listSessions());
registerRPC("listWorkspaces", () => requireHost().listWorkspaces());
registerRPC("selectWorkspace", (params: { path?: string; mode?: "latest" | "new" }) => {
  if (!params?.path?.trim()) throw new Error("selectWorkspace requires path");
  const mode = params.mode === "new" ? "new" : "latest";
  return requireHost().selectWorkspace(params.path.trim(), mode);
});
registerRPC("addWorkspace", (params: { path?: string; mode?: "latest" | "new" }) => {
  if (!params?.path?.trim()) throw new Error("addWorkspace requires path");
  const mode = params.mode === "new" ? "new" : "latest";
  return requireHost().addWorkspace(params.path.trim(), mode);
});
registerRPC("createTempWorkspace", (params?: { mode?: "latest" | "new" }) => {
  const mode = params?.mode === "latest" ? "latest" : "new";
  return requireHost().createTempWorkspace(mode);
});
registerRPC("removeWorkspace", (params: { path?: string }) => {
  if (!params?.path?.trim()) throw new Error("removeWorkspace requires path");
  return requireHost().removeWorkspace(params.path.trim());
});
registerRPC("revealFolder", (params: { path?: string }) => {
  if (!params?.path?.trim()) throw new Error("revealFolder requires path");
  const resolved = path.resolve(params.path.trim());
  if (!fs.existsSync(resolved)) throw new Error(`文件夹不存在：${params.path}`);
  // 原生 GUI shell：后台在系统文件管理器中打开并定位该文件夹（异步，无需等待）
  void shell.showItemInFolder(resolved);
  return { ok: true };
});
registerRPC("chooseWorkspace", (params?: { mode?: "latest" | "new" }) => {
  const mode = params?.mode === "new" ? "new" : "latest";
  void pickFolder()
    .then((selected) => {
      if (!selected) {
        emitToUi("workspace.choose", { cancelled: true as const });
        return;
      }
      const opened = requireHost().addWorkspace(selected, mode);
      emitToUi("workspace.choose", { cancelled: false as const, ...opened });
    })
    .catch((err) => {
      emitToUi("workspace.choose", {
        cancelled: true as const,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  return { pending: true as const };
});
registerRPC("createSession", (params?: { cwd?: string }) => requireHost().createSession(params?.cwd));
registerRPC("openSession", (params: { id?: string; cwd?: string }) => {
  if (!params?.id) throw new Error("openSession requires id");
  return requireHost().openSession(params.id, params.cwd);
});
registerRPC("deleteSession", (params: { id?: string; cwd?: string }) => {
  if (!params?.id) throw new Error("deleteSession requires id");
  return requireHost().deleteSession(params.id, params.cwd);
});
registerRPC("getTimeline", () => requireHost().getTimeline());
registerRPC("getActiveSessionId", () => ({
  id: requireHost().getActiveSessionId(),
  cwd: requireHost().getSettings().cwd,
}));
registerRPC("isBusy", () => ({ busy: requireHost().isBusy() }));
registerRPC("listExtensions", () => requireHost().listExtensions());
registerRPC("listUiContributions", () => requireHost().listUiContributions());
registerRPC("reloadExtensions", () => requireHost().reloadExtensions());
registerRPC("listSkills", () => requireHost().listSkills());
registerRPC("listPrompts", () => requireHost().listPrompts());
registerRPC("listLocalPackages", () => requireHost().listLocalPackages());
registerRPC("addLocalPackage", (params: { path?: string }) => {
  if (!params?.path?.trim()) throw new Error("addLocalPackage requires path");
  return requireHost().addLocalPackage(params.path.trim());
});
registerRPC("removeLocalPackage", (params: { path?: string }) => {
  if (!params?.path?.trim()) throw new Error("removeLocalPackage requires path");
  return requireHost().removeLocalPackage(params.path.trim());
});
registerRPC("respondExtensionUi", (params: Parameters<DesktopHost["respondExtensionUi"]>[0]) =>
  requireHost().respondExtensionUi(params),
);
registerRPC("sendPrompt", (params: { text?: string; images?: Array<{ data?: string; mimeType?: string }> }) => {
  const text = String(params?.text ?? "");
  // 图片附件：Base64 数据 + MIME 类型（在 UI 侧完成压缩与尺寸约束）
  const images = (params?.images ?? [])
    .filter((img): img is { data: string; mimeType: string } =>
      Boolean(typeof img?.data === "string" && img.data.trim()) && typeof img?.mimeType === "string")
    .map((img) => ({ data: img.data, mimeType: img.mimeType as string }));
  // 记录发起时的活跃会话，结果事件据此路由（多会话并行时互不干扰）
  const sessionId = (() => {
    try {
      return requireHost().getActiveSessionId();
    } catch {
      return undefined;
    }
  })();
  void requireHost()
    .sendPrompt(text, images)
    .then((result) => {
      emitToUi("prompt.result", { ...result, sessionId });
    })
    .catch((err) => {
      emitToUi("prompt.result", {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        sessionId,
      });
    });
  return { started: true };
});
registerRPC("abortPrompt", () => requireHost().abortPrompt());
function shutdown(): void {
  try {
    host?.dispose();
  } catch (err) {
    console.warn("[aluka-desktop] dispose failed", err);
  }
  try {
    globalShortcut.unregisterAll();
  } catch (err) {
    console.warn("[aluka-desktop] unregister shortcuts failed", err);
  }
  try {
    tray?.destroy();
  } catch (err) {
    console.warn("[aluka-desktop] destroy tray failed", err);
  }
  try {
    app.quit();
  } catch (err) {
    console.warn("[aluka-desktop] app.quit failed", err);
  }
  setTimeout(() => {
    try {
      process.exit(0);
    } catch {
      /* ignore */
    }
  }, 400);
}

const guiApp = app as typeof app & { on?: (event: string, handler: () => void) => void };
guiApp.on?.("before-quit", () => {
  try {
    host?.dispose();
  } catch {
    /* ignore */
  }
  try {
    globalShortcut.unregisterAll();
  } catch {
    /* ignore */
  }
});

registerRPC("hideToTray", () => {
  win?.hide();
  return { ok: true };
});
registerRPC("showWindow", () => {
  win?.show();
  return { ok: true };
});
registerRPC("quitApp", () => {
  shutdown();
  return { ok: true };
});
registerRPC("getModelsJsonPreview", () => requireHost().getModelsJsonPreview());
registerRPC("checkForUpdates", () => {
  void requireHost().checkForUpdates().then((result) => {
    emitToUi("update.check", result);
  });
  return { started: true };
});
registerRPC("exportSession", (params: { format?: string; id?: string }) => {
  const format = (params?.format === "json" || params?.format === "jsonl" ? params.format : "markdown") as
    | "json"
    | "jsonl"
    | "markdown";
  return requireHost().exportSession(format, params?.id);
});
registerRPC("shareSession", (params: { id?: string }) => {
  void requireHost().shareSession(params?.id).then((result) => {
    emitToUi("session.share", result);
  });
  return { started: true };
});
registerRPC("getSessionUsage", (params: { id?: string }) => requireHost().getSessionUsage(params?.id));
registerRPC("getUsageStats", () => requireHost().getUsageStats());
registerRPC("setSessionName", (params: { name?: string }) => requireHost().setSessionName(String(params?.name ?? "")));
registerRPC("forkSession", (params: { leafId?: string }) => requireHost().forkSession(params?.leafId));
registerRPC("getModelsJsonConfig", () => requireHost().getModelsJsonConfig());
registerRPC("listBuiltinProviders", () => requireHost().listBuiltinProviders());
registerRPC("refreshProviderModels", (params: { provider?: string }) => {
  if (!params?.provider?.trim()) throw new Error("refreshProviderModels requires provider");
  return requireHost().refreshProviderModels(params.provider.trim());
});
registerRPC("testProviderConnection", (params: {
  provider?: string;
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  proxy?: string;
}) =>
  requireHost().testProviderConnection({
    provider: params?.provider,
    baseUrl: params?.baseUrl,
    api: params?.api,
    apiKey: params?.apiKey,
    proxy: params?.proxy,
  }),
);
registerRPC("listModelOptions", () => requireHost().listModelOptions());
registerRPC("upsertCustomProvider", (params: {
  provider?: string;
  baseUrl?: string;
  api?: string;
  modelId?: string;
  modelName?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  apiKey?: string;
  proxy?: string;
  previousProvider?: string;
  previousModelId?: string;
}) => {
  const api = coerceApi(params?.api);
  return requireHost().upsertCustomProvider({
    provider: String(params?.provider ?? ""),
    baseUrl: String(params?.baseUrl ?? ""),
    api,
    modelId: String(params?.modelId ?? ""),
    modelName: params?.modelName,
    reasoning: params?.reasoning,
    contextWindow: params?.contextWindow,
    maxTokens: params?.maxTokens,
    apiKey: params?.apiKey,
    proxy: params?.proxy,
    previousProvider: params?.previousProvider,
    previousModelId: params?.previousModelId,
  });
});
registerRPC("removeCustomProvider", (params: { provider?: string }) => {
  if (!params?.provider?.trim()) throw new Error("removeCustomProvider requires provider");
  return requireHost().removeCustomProvider(params.provider.trim());
});
registerRPC("addProviderModels", (params: {
  provider?: string;
  models?: Array<{ id?: string; name?: string; reasoning?: boolean; contextWindow?: number; maxTokens?: number }>;
}) => {
  if (!params?.provider?.trim()) throw new Error("addProviderModels requires provider");
  const models = (params.models ?? [])
    .map((item) => ({
      id: String(item?.id ?? "").trim(),
      name: item?.name,
      reasoning: item?.reasoning,
      contextWindow: typeof item?.contextWindow === "number" ? item.contextWindow : undefined,
      maxTokens: typeof item?.maxTokens === "number" ? item.maxTokens : undefined,
    }))
    .filter((item) => item.id);
  return requireHost().addProviderModels({ provider: params.provider.trim(), models });
});
registerRPC("fetchRemoteModels", (params: { provider?: string; baseUrl?: string; apiKey?: string; proxy?: string }) =>
  requireHost().fetchRemoteModels({
    provider: params?.provider,
    baseUrl: params?.baseUrl,
    apiKey: params?.apiKey,
    proxy: params?.proxy,
  }),
);
registerRPC("removeCustomModel", (params: { provider?: string; modelId?: string }) => {
  if (!params?.provider?.trim() || !params?.modelId?.trim()) {
    throw new Error("removeCustomModel requires provider and modelId");
  }
  return requireHost().removeCustomModel(params.provider.trim(), params.modelId.trim());
});
registerRPC("setProviderApiKey", (params: { provider?: string; apiKey?: string }) => {
  if (!params?.provider?.trim() || !params?.apiKey?.trim()) {
    throw new Error("setProviderApiKey requires provider and apiKey");
  }
  return requireHost().setProviderApiKey(params.provider.trim(), params.apiKey.trim());
});
registerRPC("clearProviderApiKey", (params: { provider?: string }) => {
  if (!params?.provider?.trim()) throw new Error("clearProviderApiKey requires provider");
  return requireHost().clearProviderApiKey(params.provider.trim());
});
registerRPC("selectModel", (params: { provider?: string; modelId?: string }) => {
  if (!params?.provider?.trim() || !params?.modelId?.trim()) {
    throw new Error("selectModel requires provider and modelId");
  }
  return requireHost().selectModel(params.provider.trim(), params.modelId.trim());
});

createDesktopHost({
  emit: (name, data) => {
    try {
      emitToUi(name, data);
    } catch (err) {
      console.error("[aluka-desktop] emit failed", name, err);
    }
  },
  extraExtensionPaths: demoExts,
})
  .then((created) => {
    host = created;
    emitToUi("host.ready", { ok: true });
    console.log("[aluka-desktop] host ready (phase 5)", { demoExts: demoExts.length });
  })
  .catch((err) => {
    console.error("[aluka-desktop] host init failed", err);
    emitToUi("host.ready", { ok: false, error: err instanceof Error ? err.message : String(err) });
  });
win?.on("ui-ready", (data: unknown) => {
  console.log("[aluka-desktop] ui-ready", JSON.stringify(data));
});

app.run();
