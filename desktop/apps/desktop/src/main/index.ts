/**
 * Aluka Desktop 主进程（Phase 4）
 *
 * - 无边框窗口 + 托盘（关闭按钮隐藏到托盘，托盘「退出」才 quit）
 * - registerRPC 不 await Promise：异步用 fire-and-forget + win.emit
 */
import { app, createWindow, createTray, setAssetDir, globalShortcut } from "aluka:gui";
import { createDesktopHost, type DesktopHost } from "../host/index.ts";
import { PROTOCOL_VERSION } from "../shared/contracts.ts";
import { VERSION } from "../../../../../aluka_pi/src/config.ts";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "../..");
const uiDir = path.resolve(appRoot, "dist/ui");
const iconPath = path.resolve(appRoot, "assets/icon.ico");
const alukaPiRoot = path.resolve(appRoot, "../../../aluka_pi");
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
    { label: "Show Aluka Desktop", click: () => win.show() },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ],
};
if (fs.existsSync(iconPath)) {
  trayOpts.icon = iconPath;
}

const tray = createTray(trayOpts);
tray.on("click", () => win.show());

try {
  globalShortcut.register("Ctrl+Alt+A", () => win.show());
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
app.registerRPC("createSession", () => requireHost().createSession());
app.registerRPC("openSession", (params: { id?: string }) => {
  if (!params?.id) throw new Error("openSession requires id");
  return requireHost().openSession(params.id);
});
app.registerRPC("getTimeline", () => requireHost().getTimeline());
app.registerRPC("getActiveSessionId", () => ({ id: requireHost().getActiveSessionId() }));
app.registerRPC("isBusy", () => ({ busy: requireHost().isBusy() }));
app.registerRPC("listExtensions", () => requireHost().listExtensions());
app.registerRPC("listSkills", () => requireHost().listSkills());
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
  void requireHost().sendPrompt(text).then((result) => {
    win.emit("prompt.result", result);
  });
  return { started: true };
});
app.registerRPC("abortPrompt", () => requireHost().abortPrompt());
app.registerRPC("hideToTray", () => {
  win.hide();
  return { ok: true };
});
app.registerRPC("showWindow", () => {
  win.show();
  return { ok: true };
});
app.registerRPC("quitApp", () => {
  app.quit();
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
app.registerRPC("getModelsJsonConfig", () => requireHost().getModelsJsonConfig());
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
  previousProvider?: string;
  previousModelId?: string;
}) => {
  const api = params?.api === "anthropic-messages" ? "anthropic-messages" : "openai-completions";
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
    previousProvider: params?.previousProvider,
    previousModelId: params?.previousModelId,
  });
});
app.registerRPC("removeCustomProvider", (params: { provider?: string }) => {
  if (!params?.provider?.trim()) throw new Error("removeCustomProvider requires provider");
  return requireHost().removeCustomProvider(params.provider.trim());
});
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
