/**
 * Desktop Host 模块
 *
 * 作为主进程与 aluka_pi 运行时之间的桥梁，封装所有业务逻辑：
 * - 会话管理（创建/打开/列表/时间线）
 * - 设置读写（供应商、模型、主题等）
 * - 扩展与技能管理
 * - Prompt 发送与中止
 * - NPM 包安装、会话导出/分享、更新检查等
 */
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

/** Host 事件发射器类型：用于向 UI 层推送运行时事件 */
export type HostEventEmitter = (name: string, data: unknown) => void;

/**
 * DesktopHost 接口：定义桌面壳暴露给主进程的所有 RPC 方法。
 * 每个方法对应主进程中注册的一个 RPC 端点。
 */
export interface DesktopHost {
  /** 健康检查，返回协议版本和时间戳 */
  ping(): PingResult;
  /** 获取运行时信息（平台、架构、阶段等） */
  getRuntimeInfo(): RuntimeInfo;
  /** 获取当前设置（含供应商预设推断结果） */
  getSettings(): ReturnType<DesktopRuntime["getSettings"]> & { providerPreset: ProviderPresetId };
  /** 局部更新设置并返回最新设置 */
  patchSettings(patch: DesktopSettings): ReturnType<DesktopRuntime["getSettings"]> & { providerPreset: ProviderPresetId };
  /** 列出所有内置供应商预设 */
  listProviderPresets(): typeof PROVIDER_PRESETS;
  /** 列出所有会话摘要 */
  listSessions(): ReturnType<DesktopRuntime["listSessions"]>;
  /** 创建新会话 */
  createSession(): ReturnType<DesktopRuntime["createSession"]>;
  /** 打开指定会话并加载时间线 */
  openSession(id: string): ReturnType<DesktopRuntime["openSession"]>;
  /** 获取当前活跃会话的时间线 */
  getTimeline(): ReturnType<DesktopRuntime["getTimeline"]>;
  /** 获取当前活跃会话 ID */
  getActiveSessionId(): string | undefined;
  /** 是否正在处理 Prompt */
  isBusy(): boolean;
  /** 发送 Prompt 到 Agent（异步执行，结果通过事件推送） */
  sendPrompt(text: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** 中止当前正在进行的 Prompt */
  abortPrompt(): { ok: true };
  /** 列出已加载的扩展及其提供的工具和命令 */
  listExtensions(): ReturnType<DesktopRuntime["listExtensions"]>;
  /** 列出可用技能 */
  listSkills(): ReturnType<DesktopRuntime["listSkills"]>;
  /** 列出已注册的本地扩展包路径 */
  listLocalPackages(): string[];
  /** 添加本地扩展包路径 */
  addLocalPackage(pkgPath: string): ReturnType<DesktopHost["getSettings"]>;
  /** 移除本地扩展包路径 */
  removeLocalPackage(pkgPath: string): ReturnType<DesktopHost["getSettings"]>;
  /** 响应扩展 UI 请求（确认、选择、输入等） */
  respondExtensionUi(response: ExtensionUiResponse): { ok: true };
  /** 获取 models.json 的只读预览（含各源文件信息） */
  getModelsJsonPreview(): ModelsJsonPreview;
  /** 获取 models.json 的完整配置视图 */
  getModelsJsonConfig(): ModelsJsonConfigView;
  /** 创建或更新自定义供应商与模型 */
  upsertCustomProvider(input: UpsertCustomProviderInput): ModelsJsonConfigView;
  /** 删除指定供应商及其全部模型 */
  removeCustomProvider(provider: string): ModelsJsonConfigView;
  /** 删除指定模型 */
  removeCustomModel(provider: string, modelId: string): ModelsJsonConfigView;
  /** 设置指定供应商的 API 密钥 */
  setProviderApiKey(provider: string, apiKey: string): ModelsJsonConfigView;
  /** 清除指定供应商的 API 密钥 */
  clearProviderApiKey(provider: string): ModelsJsonConfigView;
  /** 列出所有可用模型选项（含配置状态） */
  listModelOptions(): ModelOptionView[];
  /** 选择并激活指定模型 */
  selectModel(provider: string, modelId: string): ReturnType<DesktopHost["getSettings"]>;
  /** 检查桌面壳是否有新版本 */
  checkForUpdates(): Promise<UpdateCheckResult>;
  /** 通过 npm 或 aluka install 安装扩展包 */
  installNpmPackage(spec: string): Promise<InstallNpmPackageOutcome>;
  /** 导出会话为指定格式（markdown/json/jsonl） */
  exportSession(format?: SessionExportFormat, sessionId?: string): SessionExportOutcome;
  /** 通过 GitHub Gist 分享会话 */
  shareSession(sessionId?: string): Promise<SessionShareOutcome>;
  /** 获取指定会话的 token 用量统计 */
  getSessionUsage(sessionId?: string): SessionUsageView;
}

/**
 * 为设置视图注入供应商预设 ID（如 openai / anthropic / openai-compatible）
 * 根据 provider 和 baseUrl 自动推断当前使用的预设类型
 */
function withPreset(view: ReturnType<DesktopRuntime["getSettings"]>) {
  return {
    ...view,
    providerPreset: inferProviderPreset(view.provider, view.baseUrl),
  };
}

/**
 * 创建桌面壳 Host 实例
 *
 * 内部创建 aluka_pi 的 DesktopRuntime，并将所有运行时事件转发给 UI 层。
 * 返回的 DesktopHost 对象封装了所有 RPC 方法，供主进程注册。
 */
export async function createDesktopHost(opts: {
  /** 事件发射器：将运行时事件推送到 UI 窗口 */
  emit: HostEventEmitter;
  /** 可选：启动时额外加载的扩展路径（如 demo greet/guard） */
  extraExtensionPaths?: string[];
}): Promise<DesktopHost> {
  // 创建底层运行时实例，绑定工作目录和事件回调
  const runtime = await createDesktopRuntime({
    onEvent: async (event: DesktopRuntimeEvent) => {
      // 将所有运行时事件（agent_start、text_delta、tool_start 等）转发到 UI
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
