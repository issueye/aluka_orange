/**
 * Aluka Desktop 主进程（Phase 4）
 *
 * - 无边框窗口 + 托盘（关闭按钮退出；托盘可再开窗口）
 * - 退出前中止任务、杀掉子进程，避免残留
 * - registerRPC 不 await Promise：异步用 fire-and-forget + win.emit
 */
import { app, createWindow, createTray, setAssetDir, globalShortcut } from "aluka:gui";
import { createDesktopHost, type DesktopHost } from "../host/index.ts";
import { pickFolder } from "../host/choose-folder.ts";
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

const win = createWindow({
  title: "Aluka Desktop",
  width: 1200,
  height: 780,
  minWidth: 900,
  minHeight: 560,
  center: true,
  frame: false,
  // 打包产物可关；开发期保持便于调试
  devTools: !process.env.ALUKA_DESKTOP_PACKAGED,
  url: "aluka://app/index.html",
});

const trayOpts: {
  tooltip: string;
  icon?: string;
  menu: Array<{ label?: string; type?: string; click?: () => void }>;
} = {
  tooltip: "Aluka Desktop",
  menu: [
    { label: "显示主窗口", click: () => win.show() },
    { type: "separator" },
    { label: "退出", click: () => shutdown() },
  ],
};
if (fs.existsSync(iconPath)) {
  trayOpts.icon = iconPath;
}

const tray = createTray(trayOpts);
tray.on("click", () => win.show());

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

app.registerRPC("ping", () => ({ ok: true, ts: Date.now(), protocolVersion: PROTOCOL_VERSION }));
app.registerRPC("getRuntimeInfo", () => {
  if (!host) return runtimeInfoFallback();
  return { ...host.getRuntimeInfo(), hostReady: true };
});
app.registerRPC("getSettings", () => requireHost().getSettings());
app.registerRPC("patchSettings", (params: SettingsPatch) => requireHost().patchSettings(params ?? {}));
app.registerRPC("listProviderPresets", () => requireHost().listProviderPresets());
app.registerRPC("listSessions", () => requireHost().listSessions());
app.registerRPC("listWorkspaces", () => requireHost().listWorkspaces());
app.registerRPC("selectWorkspace", (params: { path?: string; mode?: "latest" | "new" }) => {
  if (!params?.path?.trim()) throw new Error("selectWorkspace requires path");
  const mode = params.mode === "new" ? "new" : "latest";
  return requireHost().selectWorkspace(params.path.trim(), mode);
});
app.registerRPC("addWorkspace", (params: { path?: string; mode?: "latest" | "new" }) => {
  if (!params?.path?.trim()) throw new Error("addWorkspace requires path");
  const mode = params.mode === "new" ? "new" : "latest";
  return requireHost().addWorkspace(params.path.trim(), mode);
});
app.registerRPC("createTempWorkspace", (params?: { mode?: "latest" | "new" }) => {
  const mode = params?.mode === "latest" ? "latest" : "new";
  return requireHost().createTempWorkspace(mode);
});
app.registerRPC("removeWorkspace", (params: { path?: string }) => {
  if (!params?.path?.trim()) throw new Error("removeWorkspace requires path");
  return requireHost().removeWorkspace(params.path.trim());
});
app.registerRPC("chooseWorkspace", (params?: { mode?: "latest" | "new" }) => {
  const mode = params?.mode === "new" ? "new" : "latest";
  void pickFolder()
    .then((selected) => {
      if (!selected) {
        win.emit("workspace.choose", { cancelled: true as const });
        return;
      }
      const opened = requireHost().addWorkspace(selected, mode);
      win.emit("workspace.choose", { cancelled: false as const, ...opened });
    })
    .catch((err) => {
      win.emit("workspace.choose", {
        cancelled: true as const,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  return { pending: true as const };
});
app.registerRPC("createSession", (params?: { cwd?: string }) => requireHost().createSession(params?.cwd));
app.registerRPC("openSession", (params: { id?: string; cwd?: string }) => {
  if (!params?.id) throw new Error("openSession requires id");
  return requireHost().openSession(params.id, params.cwd);
});
app.registerRPC("deleteSession", (params: { id?: string; cwd?: string }) => {
  if (!params?.id) throw new Error("deleteSession requires id");
  return requireHost().deleteSession(params.id, params.cwd);
});
app.registerRPC("getTimeline", () => requireHost().getTimeline());
app.registerRPC("getActiveSessionId", () => ({
  id: requireHost().getActiveSessionId(),
  cwd: requireHost().getSettings().cwd,
}));
app.registerRPC("isBusy", () => ({ busy: requireHost().isBusy() }));
app.registerRPC("listExtensions", () => requireHost().listExtensions());
app.registerRPC("reloadExtensions", () => requireHost().reloadExtensions());
app.registerRPC("listSkills", () => requireHost().listSkills());
app.registerRPC("listPrompts", () => requireHost().listPrompts());
app.registerRPC("listLocalPackages", () => requireHost().listLocalPackages());
app.registerRPC("addLocalPackage", (params: { path?: string }) => {
  if (!params?.path?.trim()) throw new Error("addLocalPackage requires path");
  return requireHost().addLocalPackage(params.path.trim());
});
app.registerRPC("removeLocalPackage", (params: { path?: string }) => {
  if (!params?.path?.trim()) throw new Error("removeLocalPackage requires path");
  return requireHost().removeLocalPackage(params.path.trim());
});
app.registerRPC("respondExtensionUi", (params: Parameters<DesktopHost["respondExtensionUi"]>[0]) =>
  requireHost().respondExtensionUi(params),
);
app.registerRPC("sendPrompt", (params: { text?: string }) => {
  const text = String(params?.text ?? "");
  // 记录发起时的活跃会话，结果事件据此路由（多会话并行时互不干扰）
  const sessionId = (() => {
    try {
      return requireHost().getActiveSessionId();
    } catch {
      return undefined;
    }
  })();
  void requireHost()
    .sendPrompt(text)
    .then((result) => {
      win.emit("prompt.result", { ...result, sessionId });
    })
    .catch((err) => {
      win.emit("prompt.result", {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        sessionId,
      });
    });
  return { started: true };
});
app.registerRPC("abortPrompt", () => requireHost().abortPrompt());
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
    tray.destroy();
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

app.registerRPC("hideToTray", () => {
  win.hide();
  return { ok: true };
});
app.registerRPC("showWindow", () => {
  win.show();
  return { ok: true };
});
app.registerRPC("quitApp", () => {
  shutdown();
  return { ok: true };
});
app.registerRPC("getModelsJsonPreview", () => requireHost().getModelsJsonPreview());
app.registerRPC("checkForUpdates", () => {
  void requireHost().checkForUpdates().then((result) => {
    win.emit("update.check", result);
  });
  return { started: true };
});
app.registerRPC("installNpmPackage", (params: { spec?: string }) => {
  const spec = String(params?.spec ?? "").trim();
  void requireHost().installNpmPackage(spec).then((result) => {
    win.emit("package.install", result);
  });
  return { started: true };
});
app.registerRPC("searchPackages", (params: { query?: string; limit?: number; from?: number }) =>
  requireHost().searchPackages({
    query: params?.query,
    limit: typeof params?.limit === "number" ? params.limit : undefined,
    from: typeof params?.from === "number" ? params.from : undefined,
  }),
);
app.registerRPC("listInstalledPackages", () => requireHost().listInstalledPackages());
app.registerRPC("removeNpmPackage", (params: { name?: string }) => {
  if (!params?.name?.trim()) throw new Error("removeNpmPackage requires name");
  return requireHost().removeNpmPackage(params.name.trim());
});
app.registerRPC("exportSession", (params: { format?: string; id?: string }) => {
  const format = (params?.format === "json" || params?.format === "jsonl" ? params.format : "markdown") as
    | "json"
    | "jsonl"
    | "markdown";
  return requireHost().exportSession(format, params?.id);
});
app.registerRPC("shareSession", (params: { id?: string }) => {
  void requireHost().shareSession(params?.id).then((result) => {
    win.emit("session.share", result);
  });
  return { started: true };
});
app.registerRPC("getSessionUsage", (params: { id?: string }) => requireHost().getSessionUsage(params?.id));
app.registerRPC("getUsageStats", () => requireHost().getUsageStats());
app.registerRPC("setSessionName", (params: { name?: string }) => requireHost().setSessionName(String(params?.name ?? "")));
app.registerRPC("forkSession", (params: { leafId?: string }) => requireHost().forkSession(params?.leafId));
app.registerRPC("getModelsJsonConfig", () => requireHost().getModelsJsonConfig());
app.registerRPC("listBuiltinProviders", () => requireHost().listBuiltinProviders());
app.registerRPC("refreshProviderModels", (params: { provider?: string }) => {
  if (!params?.provider?.trim()) throw new Error("refreshProviderModels requires provider");
  return requireHost().refreshProviderModels(params.provider.trim());
});
app.registerRPC("testProviderConnection", (params: {
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
app.registerRPC("listModelOptions", () => requireHost().listModelOptions());
app.registerRPC("upsertCustomProvider", (params: {
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
app.registerRPC("removeCustomProvider", (params: { provider?: string }) => {
  if (!params?.provider?.trim()) throw new Error("removeCustomProvider requires provider");
  return requireHost().removeCustomProvider(params.provider.trim());
});
app.registerRPC("addProviderModels", (params: {
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
app.registerRPC("fetchRemoteModels", (params: { provider?: string; baseUrl?: string; apiKey?: string; proxy?: string }) =>
  requireHost().fetchRemoteModels({
    provider: params?.provider,
    baseUrl: params?.baseUrl,
    apiKey: params?.apiKey,
    proxy: params?.proxy,
  }),
);
app.registerRPC("removeCustomModel", (params: { provider?: string; modelId?: string }) => {
  if (!params?.provider?.trim() || !params?.modelId?.trim()) {
    throw new Error("removeCustomModel requires provider and modelId");
  }
  return requireHost().removeCustomModel(params.provider.trim(), params.modelId.trim());
});
app.registerRPC("setProviderApiKey", (params: { provider?: string; apiKey?: string }) => {
  if (!params?.provider?.trim() || !params?.apiKey?.trim()) {
    throw new Error("setProviderApiKey requires provider and apiKey");
  }
  return requireHost().setProviderApiKey(params.provider.trim(), params.apiKey.trim());
});
app.registerRPC("clearProviderApiKey", (params: { provider?: string }) => {
  if (!params?.provider?.trim()) throw new Error("clearProviderApiKey requires provider");
  return requireHost().clearProviderApiKey(params.provider.trim());
});
app.registerRPC("selectModel", (params: { provider?: string; modelId?: string }) => {
  if (!params?.provider?.trim() || !params?.modelId?.trim()) {
    throw new Error("selectModel requires provider and modelId");
  }
  return requireHost().selectModel(params.provider.trim(), params.modelId.trim());
});

createDesktopHost({
  emit: (name, data) => {
    try {
      win.emit(name, data);
    } catch (err) {
      console.error("[aluka-desktop] emit failed", name, err);
    }
  },
  extraExtensionPaths: demoExts,
})
  .then((created) => {
    host = created;
    win.emit("host.ready", { ok: true });
    console.log("[aluka-desktop] host ready (phase 5)", { demoExts: demoExts.length });
  })
  .catch((err) => {
    console.error("[aluka-desktop] host init failed", err);
    win.emit("host.ready", { ok: false, error: err instanceof Error ? err.message : String(err) });
  });
win.on("ui-ready", (data: unknown) => {
  console.log("[aluka-desktop] ui-ready", JSON.stringify(data));
});

app.run();
