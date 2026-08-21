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
  type PromptImage,
  type ExtensionUiResponse,
  type ModelsJsonPreview,
  type ModelsJsonConfigView,
  type ModelOptionView,
  type UpsertCustomProviderInput,
  type AddProviderModelsInput,
  type RemoteModelView,
  type InstallNpmPackageOutcome,
  type SessionExportFormat,
  type SessionExportOutcome,
  type SessionShareOutcome,
  type SessionUsageView,
  type UsageStatsView,
  type ExtensionInventory,
  type PromptListItem,
  type OpenedSession,
  type SessionHandle,
  type WorkspaceView,
  type SelectWorkspaceMode,
} from "../../../../../agent/src/desktop/index.ts";
import { VERSION } from "../../../../../agent/src/config.ts";
import {
  PROVIDER_PRESETS,
  inferProviderPreset,
  type ProviderPresetId,
} from "../../../../../agent/src/models.ts";
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
  /** 列出所有会话摘要（当前工作区） */
  listSessions(): ReturnType<DesktopRuntime["listSessions"]>;
  /** 按工作区分组的会话树 */
  listWorkspaces(): WorkspaceView[];
  /** 切换到指定工作区（latest 打开最近会话，new 建空会话） */
  selectWorkspace(dir: string, mode?: SelectWorkspaceMode): OpenedSession;
  /** 添加并切换到工作区 */
  addWorkspace(dir: string, mode?: SelectWorkspaceMode): OpenedSession;
  /** 生成临时工作区并切换 */
  createTempWorkspace(mode?: SelectWorkspaceMode): OpenedSession;
  /** 从列表移除工作区（不删磁盘文件） */
  removeWorkspace(dir: string): { cwd: string; workspaces: WorkspaceView[] };
  /** 创建新会话 */
  createSession(cwd?: string): SessionHandle;
  /** 打开指定会话并加载时间线 */
  openSession(id: string, cwd?: string): OpenedSession;
  /** 删除会话；若删当前会话则切到最近一条或新建 */
  deleteSession(id: string, cwd?: string): OpenedSession;
  /** 获取当前活跃会话的时间线 */
  getTimeline(): { items: ReturnType<DesktopRuntime["getTimeline"]> };
  /** 获取当前活跃会话 ID */
  getActiveSessionId(): string | undefined;
  /** 是否正在处理 Prompt */
  isBusy(): boolean;
  /** 发送 Prompt 到 Agent（可附带图片附件；异步执行，结果通过事件推送） */
  sendPrompt(text: string, images?: PromptImage[]): Promise<{ ok: true } | { ok: false; error: string }>;
  /** 中止当前正在进行的 Prompt */
  abortPrompt(): { ok: true };
  /** 退出前中止任务并清理子进程 */
  dispose(): void;
  /** 列出已加载的扩展及其提供的工具和命令 */
  listExtensions(): ReturnType<DesktopRuntime["listExtensions"]>;
  /** 手动热重载扩展（重扫目录 + 重建工具）并返回最新清单 */
  reloadExtensions(): Promise<ExtensionInventory>;
  /** 列出可用技能 */
  listSkills(): ReturnType<DesktopRuntime["listSkills"]>;
  /** 提示词片段清单（.aluka/prompts 下的 Markdown，供插入输入框） */
  listPrompts(): PromptListItem[];
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
  /** 内置厂商目录（含精编模型列表，不含密钥） */
  listBuiltinProviders(): ReturnType<DesktopRuntime["listBuiltinProviders"]>;
  /** 调用扩展的 refreshModels 动态发现模型 */
  refreshProviderModels(provider: string): Promise<ReturnType<DesktopRuntime["refreshProviderModels"]>>;
  /** 探测供应商连通性（GET models，不消耗 token） */
  testProviderConnection(input: {
    provider?: string;
    baseUrl?: string;
    api?: string;
    apiKey?: string;
    proxy?: string;
  }): Promise<ReturnType<DesktopRuntime["testProviderConnection"]>>;
  /** 创建或更新自定义供应商与模型 */
  upsertCustomProvider(input: UpsertCustomProviderInput): ModelsJsonConfigView;
  /** 向已有供应商批量追加模型 */
  addProviderModels(input: AddProviderModelsInput): ModelsJsonConfigView;
  /** 通过 OpenAI 兼容 GET /models 拉取远程模型列表 */
  fetchRemoteModels(opts: {
    provider?: string;
    baseUrl?: string;
    apiKey?: string;
    proxy?: string;
  }): Promise<{ provider?: string; baseUrl: string; models: RemoteModelView[] }>;
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
  /** 查询 pi 生态插件市场（分页，带已安装标记） */
  searchPackages(params: { query?: string; limit?: number; from?: number }): Promise<
    ReturnType<DesktopRuntime["searchPackages"]>
  >;
  /** 列出 npm-packages 下已安装的插件 */
  listInstalledPackages(): ReturnType<DesktopRuntime["listInstalledPackages"]>;
  /** 卸载 npm-packages 中的包并清理扩展记录 */
  removeNpmPackage(packageName: string): Promise<ReturnType<DesktopRuntime["removeNpmPackage"]>>;
  /** 导出会话为指定格式（markdown/json/jsonl） */
  exportSession(format?: SessionExportFormat, sessionId?: string): SessionExportOutcome;
  /** 通过 GitHub Gist 分享会话 */
  shareSession(sessionId?: string): Promise<SessionShareOutcome>;
  /** 获取指定会话的 token 用量统计 */
  getSessionUsage(sessionId?: string): SessionUsageView;
  /** 获取全局（跨会话）用量统计：按供应商/模型聚合输入/输出 token */
  getUsageStats(): UsageStatsView;
  setSessionName(name: string): { id: string; name?: string };
  forkSession(leafId?: string): OpenedSession;
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
    listWorkspaces: () => runtime.listWorkspaces(),
    selectWorkspace: (dir, mode) => runtime.selectWorkspace(dir, mode),
    addWorkspace: (dir, mode) => runtime.addWorkspace(dir, mode),
    createTempWorkspace: (mode) => runtime.createTempWorkspace(mode),
    removeWorkspace: (dir) => runtime.removeWorkspace(dir),
    createSession: (cwd) => runtime.createSession(cwd ? { cwd } : undefined),
    openSession: (id, cwd) => runtime.openSession(id, cwd),
    deleteSession: (id, cwd) => runtime.deleteSession(id, cwd),
    getTimeline: () => ({ items: runtime.getTimeline() }),
    getActiveSessionId: () => runtime.getActiveSessionId(),
    isBusy: () => runtime.isBusy(),
    async sendPrompt(text, images) {
      try {
        await runtime.prompt(text, images);
        return { ok: true as const };
      } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
      }
    },
    abortPrompt() {
      runtime.abort();
      return { ok: true as const };
    },
    dispose() {
      runtime.dispose();
    },
    listExtensions: () => runtime.listExtensions(),
    reloadExtensions: () => runtime.reloadExtensions(),
    listSkills: () => runtime.listSkills(),
    listPrompts: () => runtime.listPrompts(),
    listLocalPackages: () => runtime.listLocalPackages(),
    addLocalPackage: (pkgPath) => withPreset(runtime.addLocalPackage(pkgPath)),
    removeLocalPackage: (pkgPath) => withPreset(runtime.removeLocalPackage(pkgPath)),
    respondExtensionUi(response) {
      runtime.respondExtensionUi(response);
      return { ok: true as const };
    },
    getModelsJsonPreview: () => runtime.getModelsJsonPreview(),
    getModelsJsonConfig: () => runtime.getModelsJsonConfig(),
    listBuiltinProviders: () => runtime.listBuiltinProviders(),
    refreshProviderModels: (provider) => runtime.refreshProviderModels(provider),
    testProviderConnection: (input) => runtime.testProviderConnection(input),
    upsertCustomProvider: (input) => runtime.upsertCustomProvider(input),
    addProviderModels: (input) => runtime.addProviderModels(input),
    fetchRemoteModels: (opts) => runtime.fetchRemoteModels(opts),
    removeCustomProvider: (provider) => runtime.removeCustomProvider(provider),
    removeCustomModel: (provider, modelId) => runtime.removeCustomModel(provider, modelId),
    setProviderApiKey: (provider, apiKey) => runtime.setProviderApiKey(provider, apiKey),
    clearProviderApiKey: (provider) => runtime.clearProviderApiKey(provider),
    listModelOptions: () => runtime.listModelOptions(),
    selectModel: (provider, modelId) => withPreset(runtime.selectModel(provider, modelId)),
    checkForUpdates: () => checkForDesktopUpdate({ currentVersion: VERSION }),
    installNpmPackage: (spec) => runtime.installNpmPackage(spec),
    searchPackages: (params) => runtime.searchPackages(params),
    listInstalledPackages: () => runtime.listInstalledPackages(),
    removeNpmPackage: (packageName) => runtime.removeNpmPackage(packageName),
    exportSession: (format, sessionId) => runtime.exportSession(format, sessionId),
    shareSession: (sessionId) => runtime.shareSession(sessionId),
    getSessionUsage: (sessionId) => runtime.getSessionUsage(sessionId),
    getUsageStats: () => runtime.getUsageStats(),
    setSessionName: (name) => runtime.setSessionName(name),
    forkSession: (leafId) => runtime.forkSession(leafId),
  };
}
