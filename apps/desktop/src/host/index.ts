import type { PingResult, RuntimeInfo } from "../shared/contracts.ts";
import { PROTOCOL_VERSION } from "../shared/contracts.ts";
import {
  createDesktopRuntime,
  type DesktopRuntime,
  type DesktopRuntimeEvent,
  type DesktopSettings,
  type ExtensionUiResponse,
  type ModelsJsonPreview,
  type ModelsJsonConfigView,
  type ModelOptionView,
  type UpsertCustomProviderInput,
  type InstallNpmPackageOutcome,
  type SessionExportFormat,
  type SessionExportOutcome,
  type SessionShareOutcome,
  type SessionUsageView,
} from "../../../../../aluka_pi/src/desktop/index.ts";
import { VERSION } from "../../../../../aluka_pi/src/config.ts";
import {
  PROVIDER_PRESETS,
  inferProviderPreset,
  type ProviderPresetId,
} from "../../../../../aluka_pi/src/models.ts";
import { checkForDesktopUpdate, type UpdateCheckResult } from "./update-check.ts";
export type HostEventEmitter = (name: string, data: unknown) => void;

export interface DesktopHost {
  ping(): PingResult;
  getRuntimeInfo(): RuntimeInfo;
  getSettings(): ReturnType<DesktopRuntime["getSettings"]> & { providerPreset: ProviderPresetId };
  patchSettings(patch: DesktopSettings): ReturnType<DesktopRuntime["getSettings"]> & { providerPreset: ProviderPresetId };
  listProviderPresets(): typeof PROVIDER_PRESETS;
  listSessions(): ReturnType<DesktopRuntime["listSessions"]>;
  createSession(): ReturnType<DesktopRuntime["createSession"]>;
  openSession(id: string): ReturnType<DesktopRuntime["openSession"]>;
  getTimeline(): ReturnType<DesktopRuntime["getTimeline"]>;
  getActiveSessionId(): string | undefined;
  isBusy(): boolean;
  sendPrompt(text: string): Promise<{ ok: true } | { ok: false; error: string }>;
  abortPrompt(): { ok: true };
  listExtensions(): ReturnType<DesktopRuntime["listExtensions"]>;
  listSkills(): ReturnType<DesktopRuntime["listSkills"]>;
  listLocalPackages(): string[];
  addLocalPackage(pkgPath: string): ReturnType<DesktopHost["getSettings"]>;
  removeLocalPackage(pkgPath: string): ReturnType<DesktopHost["getSettings"]>;
  respondExtensionUi(response: ExtensionUiResponse): { ok: true };
  getModelsJsonPreview(): ModelsJsonPreview;
  getModelsJsonConfig(): ModelsJsonConfigView;
  upsertCustomProvider(input: UpsertCustomProviderInput): ModelsJsonConfigView;
  removeCustomProvider(provider: string): ModelsJsonConfigView;
  removeCustomModel(provider: string, modelId: string): ModelsJsonConfigView;
  setProviderApiKey(provider: string, apiKey: string): ModelsJsonConfigView;
  clearProviderApiKey(provider: string): ModelsJsonConfigView;
  listModelOptions(): ModelOptionView[];
  selectModel(provider: string, modelId: string): ReturnType<DesktopHost["getSettings"]>;
  checkForUpdates(): Promise<UpdateCheckResult>;
  installNpmPackage(spec: string): Promise<InstallNpmPackageOutcome>;
  exportSession(format?: SessionExportFormat, sessionId?: string): SessionExportOutcome;
  shareSession(sessionId?: string): Promise<SessionShareOutcome>;
  getSessionUsage(sessionId?: string): SessionUsageView;
}

function withPreset(view: ReturnType<DesktopRuntime["getSettings"]>) {
  return {
    ...view,
    providerPreset: inferProviderPreset(view.provider, view.baseUrl),
  };
}

export async function createDesktopHost(opts: {
  emit: HostEventEmitter;
  /** 可选：启动时额外加载的扩展路径（如 demo greet/guard） */
  extraExtensionPaths?: string[];
}): Promise<DesktopHost> {
  const runtime = await createDesktopRuntime({
    onEvent: async (event: DesktopRuntimeEvent) => {
      opts.emit("runtime.event", event);
    },
    cwd: process.cwd(),
    extraExtensionPaths: opts.extraExtensionPaths,
  });

  return {
    ping() {
      return { ok: true, ts: Date.now(), protocolVersion: PROTOCOL_VERSION };
    },
    getRuntimeInfo() {
      return {
        protocolVersion: PROTOCOL_VERSION,
        product: "aluka-desktop",
        productVersion: VERSION,
        platform: process.platform,
        arch: process.arch,
        agentDirHint: runtime.agentDir,
        phase: "5",
      };
    },
    getSettings: () => withPreset(runtime.getSettings()),
    patchSettings: (patch) => withPreset(runtime.patchSettings(patch)),
    listProviderPresets: () => PROVIDER_PRESETS,
    listSessions: () => runtime.listSessions(),
    createSession: () => runtime.createSession(),
    openSession: (id) => runtime.openSession(id),
    getTimeline: () => runtime.getTimeline(),
    getActiveSessionId: () => runtime.getActiveSessionId(),
    isBusy: () => runtime.isBusy(),
    async sendPrompt(text) {
      try {
        await runtime.prompt(text);
        return { ok: true as const };
      } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
      }
    },
    abortPrompt() {
      runtime.abort();
      return { ok: true as const };
    },
    listExtensions: () => runtime.listExtensions(),
    listSkills: () => runtime.listSkills(),
    listLocalPackages: () => runtime.listLocalPackages(),
    addLocalPackage: (pkgPath) => withPreset(runtime.addLocalPackage(pkgPath)),
    removeLocalPackage: (pkgPath) => withPreset(runtime.removeLocalPackage(pkgPath)),
    respondExtensionUi(response) {
      runtime.respondExtensionUi(response);
      return { ok: true as const };
    },
    getModelsJsonPreview: () => runtime.getModelsJsonPreview(),
    getModelsJsonConfig: () => runtime.getModelsJsonConfig(),
    upsertCustomProvider: (input) => runtime.upsertCustomProvider(input),
    removeCustomProvider: (provider) => runtime.removeCustomProvider(provider),
    removeCustomModel: (provider, modelId) => runtime.removeCustomModel(provider, modelId),
    setProviderApiKey: (provider, apiKey) => runtime.setProviderApiKey(provider, apiKey),
    clearProviderApiKey: (provider) => runtime.clearProviderApiKey(provider),
    listModelOptions: () => runtime.listModelOptions(),
    selectModel: (provider, modelId) => withPreset(runtime.selectModel(provider, modelId)),
    checkForUpdates: () => checkForDesktopUpdate({ currentVersion: VERSION }),
    installNpmPackage: (spec) => runtime.installNpmPackage(spec),
    exportSession: (format, sessionId) => runtime.exportSession(format, sessionId),
    shareSession: (sessionId) => runtime.shareSession(sessionId),
    getSessionUsage: (sessionId) => runtime.getSessionUsage(sessionId),
  };
}
