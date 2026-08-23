/**
 * 桌面 Host 用 Agent 运行时：会话列表 / 打开 / prompt / abort / 设置 / 扩展 UI。
 * 供 Aluka Desktop 经 RPC 调用，不依赖 Electron。
 */

import fs from "node:fs";
import path from "node:path";
import type { ThinkingLevel } from "../ai/types.ts";
import { runAgentLoop } from "../agent/loop.ts";
import type { AgentEvent, AgentMessage } from "../agent/types.ts";
import { textFrom } from "../agent/types.ts";
import { getAgentDir, getSessionsDir } from "../config.ts";
import { createEventBus } from "../extensions/event-bus.ts";
import { createExtensionRuntime, loadExtensions } from "../extensions/loader.ts";
import { ExtensionRunner } from "../extensions/runner.ts";
import type { ToolDefinition, UiContribution, SlotData } from "../extensions/types.ts";
import type { ShellSlot } from "../extensions/contracts/shell.ts";
import { resolveRuntimeApiKey, resolveRuntimeModel } from "../models.ts";
import { SessionManager, type CustomEntry, type SessionSummary } from "../session/manager.ts";
import { killTrackedChildren } from "../process-children.ts";
import { loadPrompts } from "../prompts/index.ts";
import { loadSkills, type Skill } from "../skills/index.ts";
import { buildSystemPrompt, toolSnippets } from "../system-prompt.ts";
import { builtinTools } from "../tools/index.ts";
import {
  loadSettings,
  normalizePackagePaths,
  saveSettings,
  settingsView,
  type DesktopSettings,
} from "./settings.ts";
import {
  createDesktopUI,
  type ExtensionUiRequest,
  type ExtensionUiResponse,
} from "./ui-bridge.ts";
import {
  previewModelsJson,
  readModelsJsonConfig,
  upsertCustomProviderInModelsJson,
  removeCustomProviderFromModelsJson,
  removeCustomModelFromModelsJson,
  setProviderApiKeyInModelsJson,
  clearProviderApiKeyInModelsJson,
  addModelsToProviderInModelsJson,
  fetchOpenAiModelList,
  fetchProviderRemoteModels,
  listModelOptions,
  lookupProviderModel,
  type ModelsJsonPreview,
  type ModelsJsonConfigView,
  type ModelOptionView,
  type UpsertCustomProviderInput,
  type AddProviderModelsInput,
  type RemoteModelView,
} from "./models-json.ts";
import type { BuiltinProviderView } from "../providers/builtin.ts";
import { probeProviderConnection, type ProviderProbeInput, type ProviderProbeResult } from "../providers/probe.ts";
import {
  findProviderEntry,
  listProviderViews,
  refreshProviderModels,
} from "../providers/registry.ts";
import type { Model } from "../ai/types.ts";
import type { StreamFn } from "../ai/stream.ts";
import {
  exportSessionToDir,
  type SessionExportFormat,
  type SessionExportOutcome,
} from "./session-export.ts";
import {
  shareSessionViaGh,
  type SessionShareOutcome,
} from "./session-share.ts";
import {
  buildSessionUsageView,
  type SessionUsageTotals,
  type SessionUsageView,
} from "./session-usage.ts";
import {
  buildUsageStatsView,
  recordProducedUsage,
  type UsageStatsView,
} from "./usage-store.ts";
import type { Usage } from "../ai/types.ts";
import {
  createTemporaryWorkspace,
  ensureWorkspaceDir,
  forgetWorkspace,
  isTemporaryWorkspace,
  normalizeWorkspaceList,
  rememberWorkspace,
  samePath,
  workspaceDisplayName,
} from "./workspaces.ts";

/** 投影给桌面 UI 的精简事件（可 JSON 序列化） */
export type DesktopRuntimeEvent =
  | { type: "agent_start"; sessionId: string }
  | { type: "agent_end"; sessionId: string; usage?: SessionUsageTotals }
  | { type: "text_delta"; sessionId: string; text: string }
  | {
      type: "message_end";
      sessionId: string;
      role: string;
      text: string;
      usage?: Usage;
      /** 用户消息携带的图片附件（base64 + MIME），供 UI 渲染 */
      images?: PromptImage[];
    }
  | { type: "tool_start"; sessionId: string; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_end"; sessionId: string; toolCallId: string; toolName: string; isError: boolean; resultText: string }
  | { type: "error"; sessionId: string; message: string }
  | { type: "extension_ui"; request: ExtensionUiRequest }
  | { type: "usage"; sessionId: string; usage: SessionUsageView }
  | { type: "entry_added"; sessionId: string; customType: string; data?: unknown };

/** 用户输入携带的图片附件（Base64 数据 + MIME 类型） */
export interface PromptImage {
  data: string;
  mimeType: string;
}

/** 从消息内容块中提取图片附件 */
function imagesFrom(message: AgentMessage): PromptImage[] | undefined {
  const parts = message.role === "user" || message.role === "assistant" || message.role === "custom"
    ? message.content
    : [];
  const images = parts.filter(
    (part): part is { type: "image"; data: string; mimeType: string } => part.type === "image",
  );
  return images.length ? images.map((part) => ({ data: part.data, mimeType: part.mimeType })) : undefined;
}

export type DesktopEventSink = (event: DesktopRuntimeEvent) => void | Promise<void>;

export interface CreateDesktopRuntimeOptions {
  cwd?: string;
  model?: string;
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  extraExtensionPaths?: string[];
  agentDir?: string;
  onEvent?: DesktopEventSink;
}

export interface TimelineItem {
  id: string;
  role: "user" | "assistant" | "tool" | "system" | "custom";
  text: string;
  /** 用户消息携带的图片附件（base64 + MIME） */
  images?: PromptImage[];
  toolName?: string;
  timestamp: number;
  toolCallId?: string;
  args?: unknown;
  resultText?: string;
  isError?: boolean;
  toolStatus?: "running" | "done" | "error";
  /** 自定义时间链条目（appendEntry 链路）：customType 标识 + 数据 */
  customType?: string;
  customData?: unknown;
}

export interface ExtensionListItem {
  path: string;
  tools: string[];
  commands: string[];
}

export interface ExtensionInventory {
  extensions: ExtensionListItem[];
  errors: Array<{ path: string; error: string }>;
}

export interface SkillListItem {
  name: string;
  description: string;
  path: string;
}

/** 提示词条目（listPrompts 投影，含正文供插入输入框） */
export interface PromptListItem {
  name: string;
  description: string;
  path: string;
  body: string;
}

export interface WorkspaceSessionView {
  id: string;
  title: string;
  mtime: number;
}

export interface WorkspaceView {
  path: string;
  name: string;
  temporary: boolean;
  sessions: WorkspaceSessionView[];
}

export type SelectWorkspaceMode = "latest" | "new";

export interface SessionHandle {
  id: string;
  file: string;
  cwd: string;
}

export interface OpenedSession extends SessionHandle {
  timeline: TimelineItem[];
}

export interface DesktopRuntime {
  readonly cwd: string;
  readonly agentDir: string;
  getSettings(): ReturnType<typeof settingsView>;
  patchSettings(patch: DesktopSettings): ReturnType<typeof settingsView>;
  listSessions(): SessionSummary[];
  listWorkspaces(): WorkspaceView[];
  selectWorkspace(dir: string, mode?: SelectWorkspaceMode): OpenedSession;
  addWorkspace(dir: string, mode?: SelectWorkspaceMode): OpenedSession;
  createTempWorkspace(mode?: SelectWorkspaceMode): OpenedSession;
  removeWorkspace(dir: string): { cwd: string; workspaces: WorkspaceView[] };
  createSession(opts?: { cwd?: string }): SessionHandle;
  openSession(id: string, workspacePath?: string): OpenedSession;
  /** 删除会话；若删的是当前会话则切到最近一条，没有则不自动新建 */
  deleteSession(id: string, workspacePath?: string): OpenedSession;
  getActiveSessionId(): string | undefined;
  getTimeline(): TimelineItem[];
  isBusy(): boolean;
  /** 发送 Prompt（可附带图片附件，随用户消息进入上下文并持久化） */
  prompt(text: string, images?: PromptImage[]): Promise<void>;
  abort(): void;
  /** 退出前中止请求并杀掉跟踪的子进程 */
  dispose(): void;
  listExtensions(): ExtensionInventory;
  /** 扩展声明的 UI 贡献（v1/v2 声明式；含加载期告警） */
  listUiContributions(): { contributions: UiContribution[]; warnings: string[] };
  /**
   * 槽位 T0 数据（contributesData 提供者；同步契约，异常回退静态元数据）。
   * 注意：GUI 桥不 await Promise（主进程注释），本类 RPC 必须同步返回。
   */
  getSlotData(slot: string, contributionId: string): {
    ok: boolean;
    data?: SlotData;
    error?: string;
  };
  /**
   * 组件档模块路径（uiModule 相对插件根解析；供主进程 SSR 加载）
   */
  getPluginComponentModule(contributionId: string): {
    ok: boolean;
    path?: string;
    error?: string;
  };
  /** 用户环境变量清单（settings.json envVars 段；已注入 process.env） */
  listEnvVars(): Record<string, string>;
  /** 设置环境变量（持久化 + 注入当前进程 process.env） */
  setEnvVar(key: string, value: string): void;
  /** 删除环境变量（从 settings.json 和 process.env 中移除） */
  removeEnvVar(key: string): void;
  listSkills(): SkillListItem[];
  /** 提示词片段清单（.aluka/prompts 下的 Markdown，供插入输入框） */
  listPrompts(): PromptListItem[];
  respondExtensionUi(response: ExtensionUiResponse): void;
  /** 已持久化的本地扩展路径（不含启动期 demo opts） */
  listLocalPackages(): string[];
  addLocalPackage(pkgPath: string): ReturnType<typeof settingsView>;
  removeLocalPackage(pkgPath: string): ReturnType<typeof settingsView>;
  /** 手动热重载扩展（重扫目录 + 重建工具），返回最新清单；装完插件后由 UI 触发 */
  reloadExtensions(): Promise<ExtensionInventory>;
  /** 只读预览 ~/.aluka|~/.pi/agent/models.json（无密钥） */
  getModelsJsonPreview(): ModelsJsonPreview;
  /** 可编辑的 Aluka agentDir/models.json 配置视图 */
  getModelsJsonConfig(): ModelsJsonConfigView;
  /** 内置厂商目录 + 扩展动态注册的供应商（含精编模型，不含密钥） */
  listBuiltinProviders(): BuiltinProviderView[];
  /** 调用扩展声明的 refreshModels 动态发现模型 */
  refreshProviderModels(provider: string): Promise<Model[]>;
  /** 探测供应商连通性（GET models，不消耗 token） */
  testProviderConnection(input: ProviderProbeInput): Promise<ProviderProbeResult>;
  upsertCustomProvider(input: UpsertCustomProviderInput): ModelsJsonConfigView;
  addProviderModels(input: AddProviderModelsInput): ModelsJsonConfigView;
  fetchRemoteModels(opts: {
    provider?: string;
    baseUrl?: string;
    apiKey?: string;
    proxy?: string;
  }): Promise<{ provider?: string; baseUrl: string; models: RemoteModelView[] }>;
  removeCustomProvider(provider: string): ModelsJsonConfigView;
  removeCustomModel(provider: string, modelId: string): ModelsJsonConfigView;
  setProviderApiKey(provider: string, apiKey: string): ModelsJsonConfigView;
  clearProviderApiKey(provider: string): ModelsJsonConfigView;
  /** Composer 模型下拉选项 */
  listModelOptions(): ModelOptionView[];
  /** 选用 models.json 中的 provider/model，并写入 settings */
  selectModel(provider: string, modelId: string): ReturnType<typeof settingsView>;
  /** 导出当前或指定会话到 agentDir/exports */
  exportSession(format?: SessionExportFormat, sessionId?: string): SessionExportOutcome;
  /** 经 gh gist 分享会话（secret gist）；需本机 gh 已登录 */
  shareSession(sessionId?: string): Promise<SessionShareOutcome>;
  /** 当前会话 token 用量汇总（API key 路径；无 OAuth 配额） */
  getSessionUsage(sessionId?: string): SessionUsageView;
  /** 全局（跨会话）token 用量统计：按 供应商 → 模型 聚合（agentDir/usage.json） */
  getUsageStats(): UsageStatsView;
  /** 写入 session_info，侧栏标题优先用这个名字 */
  setSessionName(name: string): { id: string; name?: string };
  /** 把当前（或指定 leaf）分支抽成新会话文件 */
  forkSession(leafId?: string): OpenedSession;
}

function projectEvent(sessionId: string, event: AgentEvent): DesktopRuntimeEvent | undefined {
  switch (event.type) {
    case "agent_start":
      return { type: "agent_start", sessionId };
    case "agent_end":
      return { type: "agent_end", sessionId };
    case "message_update": {
      const delta = event.assistantMessageEvent;
      if (delta.type === "text" && delta.delta) {
        return { type: "text_delta", sessionId, text: delta.delta };
      }
      return undefined;
    }
    case "message_end": {
      if (event.message.role === "user" || event.message.role === "assistant") {
        const usage =
          event.message.role === "assistant" && event.message.usage ? event.message.usage : undefined;
        return {
          type: "message_end",
          sessionId,
          role: event.message.role,
          text: textFrom(event.message),
          images: event.message.role === "user" ? imagesFrom(event.message) : undefined,
          usage,
        };
      }
      return undefined;
    }
    case "tool_execution_start":
      return {
        type: "tool_start",
        sessionId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
      };
    case "tool_execution_end": {
      const resultText = clipToolText(toolResultText(event.result));
      return {
        type: "tool_end",
        sessionId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        isError: event.isError,
        resultText,
      };
    }
    default:
      return undefined;
  }
}

function clipToolText(text: string, max = 24_000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…`;
}

function toolResultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return String(result ?? "");
  const rec = result as { content?: unknown; text?: unknown };
  if (typeof rec.text === "string" && rec.text) return rec.text;
  if (Array.isArray(rec.content)) {
    const text = rec.content
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const item = part as { type?: string; text?: unknown };
        return typeof item.text === "string" ? item.text : "";
      })
      .filter(Boolean)
      .join("\n");
    if (text) return text;
  }
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function timelineFromHistory(messages: AgentMessage[]): TimelineItem[] {
  const argsById = new Map<string, { name: string; args: unknown }>();
  const items: TimelineItem[] = [];
  messages.forEach((message, index) => {
    if (message.role === "assistant") {
      for (const part of message.content) {
        if (part.type === "toolCall") {
          argsById.set(part.id, { name: part.name, args: part.arguments ?? {} });
        }
      }
    }
    if (message.role === "toolResult") {
      const call = argsById.get(message.toolCallId);
      const resultText = textFrom(message);
      items.push({
        id: `tool-${message.toolCallId || index}`,
        role: "tool",
        text: resultText,
        toolName: message.toolName || call?.name,
        timestamp: Date.now(),
        toolCallId: message.toolCallId,
        args: call?.args,
        resultText,
        isError: Boolean(message.isError),
        toolStatus: message.isError ? "error" : "done",
      });
      return;
    }
    if (message.role === "assistant") {
      const text = textFrom(message);
      if (!text.trim()) return;
      items.push({
        id: `assistant-${index}`,
        role: "assistant",
        text,
        timestamp: Date.now(),
      });
      return;
    }
    const role = message.role === "user" ? ("user" as const) : ("system" as const);
    const ts =
      message.role === "user" && "timestamp" in message && typeof (message as { timestamp?: number }).timestamp === "number"
        ? (message as { timestamp: number }).timestamp
        : Date.now();
    const text = textFrom(message);
    const images = message.role === "user" ? imagesFrom(message) : undefined;
    // 纯图片消息（无文字）也要展示
    if (!text.trim() && !images?.length) return;
    items.push({
      id: `${role}-${index}`,
      role,
      text,
      images,
      timestamp: ts,
    });
  });
  return items;
}

/** custom 会话条目（appendEntry 链路）→ 时间线项 */
function customTimelineItems(session: SessionManager): TimelineItem[] {
  const entries = session
    .getEntries()
    .filter((entry): entry is CustomEntry => entry.type === "custom");
  return entries.map((entry) => ({
    id: `custom-${entry.id}`,
    role: "custom" as const,
    text: "",
    customType: entry.customType,
    customData: entry.data,
    timestamp: entry.timestamp ? Date.parse(entry.timestamp) : Date.now(),
  }));
}

/** 当前时间线 = history 消息 + custom 条目（appendEntry 链路的桌面投影） */
function currentTimeline(session: SessionManager, hist: AgentMessage[]): TimelineItem[] {
  return [...timelineFromHistory(hist), ...customTimelineItems(session)];
}

function historyFromSession(session: SessionManager): AgentMessage[] {
  return [...session.buildSessionContext().messages];
}

function skillItems(skills: Skill[]): SkillListItem[] {
  return skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    path: skill.path,
  }));
}

function pruneEmptyTempWorkspaces(paths: string[], current: string, agentDir: string): string[] {
  return paths.filter((dir) => {
    if (samePath(dir, current)) return true;
    if (!isTemporaryWorkspace(dir)) return true;
    return SessionManager.list(getSessionsDir(dir, agentDir)).length > 0;
  });
}

function resolveExtraPaths(cwd: string, settings: DesktopSettings, opts: CreateDesktopRuntimeOptions): string[] {
  const fromOpts = opts.extraExtensionPaths ?? [];
  const fromSettings = settings.extraExtensions ?? [];
  return [...fromOpts, ...fromSettings].map((p) => (path.isAbsolute(p) ? p : path.resolve(cwd, p)));
}

function coerceThinkingLevel(raw: unknown): ThinkingLevel {
  if (raw === "minimal" || raw === "low" || raw === "medium" || raw === "high" || raw === "xhigh") return raw;
  return "off";
}

export async function createDesktopRuntime(opts: CreateDesktopRuntimeOptions = {}): Promise<DesktopRuntime> {
  const agentDir = opts.agentDir ?? getAgentDir();
  const stored = loadSettings(agentDir);
  const createdTemp = !opts.cwd && !stored.cwd;
  let cwd = ensureWorkspaceDir(opts.cwd ?? stored.cwd ?? createTemporaryWorkspace());
  let workspacePaths = normalizeWorkspaceList(stored.workspaces ?? [], cwd);
  let settings: DesktopSettings = { ...stored, cwd, workspaces: workspacePaths };
  if (opts.model) settings.model = opts.model;
  if (opts.provider) settings.provider = opts.provider;
  if (opts.baseUrl) settings.baseUrl = opts.baseUrl;
  if (opts.apiKey) settings.apiKey = opts.apiKey;
  if (createdTemp || !stored.workspaces?.length) {
    settings = saveSettings(settings, agentDir);
  }

  // 启动时把已持久化到 settings.json 的 envVars 注入当前进程（编译版与 dev 一致）
  if (stored.envVars) {
    for (const [key, value] of Object.entries(stored.envVars)) {
      if (typeof key === "string" && key.trim() && typeof value === "string") {
        process.env[key] = value;
      }
    }
  }

  const initial = resolveRuntimeModel({
    agentDir,
    settings,
    provider: opts.provider,
    model: opts.model,
    baseUrl: opts.baseUrl,
  });
  const model = initial.model;

  let emitDesktop: (event: DesktopRuntimeEvent) => Promise<void> = async () => {};
  const desktopUi = createDesktopUI((request) => {
    void emitDesktop({ type: "extension_ui", request });
  });

  /** 为会话挂接追加钩子：custom 条目实时投影为 entry_added 事件 */
  function wireSession(next: SessionManager): SessionManager {
    next.onAppend = (entry) => {
      if (entry.type !== "custom") return;
      const custom = entry as CustomEntry;
      void emitDesktop({
        type: "entry_added",
        sessionId: next.id,
        customType: custom.customType,
        data: custom.data,
      });
    };
    return next;
  }

  let loaded = await loadExtensions({
    cwd,
    extraPaths: resolveExtraPaths(cwd, settings, opts),
  }).catch((error) => ({
    extensions: [],
    errors: [{ path: "loadExtensions", error: error instanceof Error ? error.message : String(error) }],
    runtime: createExtensionRuntime(),
  }));
  const sessionDir = () => getSessionsDir(cwd, agentDir);

  let session = wireSession(SessionManager.inMemory(cwd));
  let history: AgentMessage[] = [];
  /** 正在运行的会话（sessionId → AbortController），支持多会话并行执行 */
  const activeRuns = new Map<string, AbortController>();
  let systemPrompt = "";

  let runner = new ExtensionRunner(
    loaded.extensions,
    loaded.runtime,
    cwd,
    "print",
    createEventBus(),
    desktopUi,
  );
  runner.setModel(model);
  runner.setThinkingLevel(coerceThinkingLevel(settings.thinkingLevel));

  function settingsForUi() {
    return {
      ...settingsView(settings, agentDir),
      thinkingLevel: runner.getThinkingLevel(),
    };
  }

  function rebuildTools() {
    runner.setSession(session);
    const ctx = runner.createContext();
    const toolDefs: ToolDefinition[] = [...builtinTools];
    const overrideNames = new Set(runner.getRegisteredTools().map((tool) => tool.definition.name));
    const tools = [
      ...toolDefs.filter((tool) => !overrideNames.has(tool.name)).map((tool) => runner.wrapTool(tool, ctx)),
      ...runner.getRegisteredTools().map((tool) => runner.wrapTool(tool.definition, ctx)),
    ];
    const skills = loadSkills(cwd);
    systemPrompt = buildSystemPrompt({
      cwd,
      skills,
      extra: [toolSnippets(tools)],
    });
    runner.setSystemPrompt(systemPrompt);
    runner.bind({
      sendUserMessage() {},
      getActiveTools: () => tools.map((tool) => tool.name),
      getAllTools: () =>
        tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters as never,
          sourceInfo: { path: "builtin", kind: "builtin" },
        })),
      getCommands: () => [
        { name: "help", description: "Show help", source: "builtin" },
        ...runner.getCommands().map((command) => ({
          name: command.name,
          description: command.description,
          source: "extension" as const,
        })),
      ],
    });
    return tools;
  }

  function tryRestoreSession(): SessionManager | undefined {
    if (settings.lastSessionId) {
      try {
        return SessionManager.open(sessionDir(), settings.lastSessionId, cwd);
      } catch {
        /* fall through to latest */
      }
    }
    return SessionManager.latest(sessionDir(), cwd);
  }

  const restored = tryRestoreSession();
  if (restored) {
    session = wireSession(restored);
    history = historyFromSession(session);
  }

  let tools = rebuildTools();

  emitDesktop = async (event) => {
    await opts.onEvent?.(event);
  };

  function persistWorkspaceState(extra: DesktopSettings = {}) {
    const next: DesktopSettings = { ...settings, ...extra, cwd, workspaces: workspacePaths };
    // 会话/工作区切换每次都会经过这里（applyWorkspace + bindSession 各一次）；
    // 内容无变化时跳过磁盘读写，避免高频点击下的同步 IO
    const extraKeys = Object.keys(extra) as (keyof DesktopSettings)[];
    const unchanged =
      next.cwd === settings.cwd &&
      next.lastSessionId === settings.lastSessionId &&
      next.workspaces?.length === settings.workspaces?.length &&
      next.workspaces?.every((item, i) => item === settings.workspaces?.[i]) &&
      extraKeys.every((key) => JSON.stringify(extra[key]) === JSON.stringify(settings[key]));
    if (unchanged) {
      settings = next;
      return;
    }
    settings = saveSettings(next, agentDir);
  }

  function persistSessionPointer() {
    persistWorkspaceState(
      session.isPersisted() && session.getSessionFile()
        ? { lastSessionId: session.id }
        : { lastSessionId: undefined },
    );
  }

  function bindDraftSession(): OpenedSession {
    history = [];
    session = wireSession(SessionManager.inMemory(cwd));
    persistSessionPointer();
    tools = rebuildTools();
    return { id: "", file: "", cwd, timeline: [] };
  }

  function ensurePersistedSession() {
    if (session.isPersisted() && session.getSessionFile()) return;
    session = wireSession(SessionManager.create(sessionDir(), undefined, cwd));
    persistSessionPointer();
    tools = rebuildTools();
  }

  function listWorkspaceViews(): WorkspaceView[] {
    workspacePaths = pruneEmptyTempWorkspaces(workspacePaths, cwd, agentDir);
    const views = workspacePaths.map((dir) => {
      const sessions = SessionManager.list(getSessionsDir(dir, agentDir)).map((item) => ({
        id: item.id,
        title: item.title,
        mtime: item.mtime,
      }));
      return {
        path: dir,
        name: workspaceDisplayName(dir),
        temporary: isTemporaryWorkspace(dir),
        sessions,
      };
    });
    // 保持稳定顺序：按工作区加入顺序展示，不随点击会话 / 切换工作区重排
    return views;
  }

  function applyWorkspace(nextDir: string) {
    const resolved = ensureWorkspaceDir(nextDir);
    const changed = !samePath(resolved, cwd);
    cwd = resolved;
    workspacePaths = rememberWorkspace(workspacePaths, resolved);
    persistWorkspaceState();
    if (changed) {
      void reloadExtensionsForCwd(resolved);
    }
    return changed;
  }

  function bindSession(next: SessionManager) {
    session = wireSession(next);
    history = historyFromSession(session);
    runner.setThinkingLevel(coerceThinkingLevel(session.buildSessionContext().thinkingLevel));
    persistSessionPointer();
    tools = rebuildTools();
    return {
      id: session.id,
      file: session.file,
      cwd,
      timeline: currentTimeline(session, history),
    };
  }

  function openLatestOrNew(): OpenedSession {
    const listed = SessionManager.list(sessionDir());
    if (listed[0]) {
      return bindSession(SessionManager.open(sessionDir(), listed[0].id, cwd));
    }
    return bindDraftSession();
  }

  function switchToWorkspace(dir: string, mode: SelectWorkspaceMode = "latest"): OpenedSession {
    applyWorkspace(dir);
    if (mode === "new") {
      history = [];
      session = wireSession(SessionManager.create(sessionDir(), undefined, cwd));
      persistSessionPointer();
      tools = rebuildTools();
      return { id: session.id, file: session.file, cwd, timeline: [] };
    }
    return openLatestOrNew();
  }

  persistSessionPointer();

  function resolveKey(): string | undefined {
    return resolveRuntimeApiKey({ agentDir, model, apiKey: settings.apiKey });
  }

  function replaceModel(next: typeof model) {
    model.id = next.id;
    model.name = next.name;
    model.provider = next.provider;
    model.api = next.api;
    model.baseUrl = next.baseUrl;
    model.proxy = next.proxy;
    model.reasoning = next.reasoning;
    model.input = next.input;
    model.cost = next.cost;
    model.contextWindow = next.contextWindow;
    model.maxTokens = next.maxTokens;
    runner.setModel(model);
  }

  function applyModelSelection(provider: string, modelId: string) {
    const found = lookupProviderModel(agentDir, provider, modelId);
    if (!found) throw new Error(`Model ${provider}/${modelId} not found in models.json`);
    const resolved = resolveRuntimeModel({
      agentDir,
      provider: found.provider,
      model: found.id,
    });
    replaceModel(resolved.model);
    session.appendModelChange(found.provider, found.id);
    const patch: DesktopSettings = {
      model: found.id,
      provider: found.provider,
      baseUrl: found.baseUrl ?? "",
    };
    if (found.apiKey) patch.apiKey = found.apiKey;
    settings = saveSettings({ ...settings, ...patch, cwd }, agentDir);
    tools = rebuildTools();
    return settingsForUi();
  }

  async function reloadExtensionsForCwd(nextCwd: string) {
    const thinkingLevel = runner.getThinkingLevel();
    cwd = nextCwd;
    loaded = await loadExtensions({
      cwd,
      extraPaths: resolveExtraPaths(cwd, settings, opts),
    });
    runner = new ExtensionRunner(
      loaded.extensions,
      loaded.runtime,
      cwd,
      "print",
      createEventBus(),
      desktopUi,
    );
    runner.setModel(model);
    runner.setThinkingLevel(thinkingLevel);
    tools = rebuildTools();
    await runner.emitEvent({ type: "session_start", reason: "startup" });
  }

  const api: DesktopRuntime = {
    get cwd() {
      return cwd;
    },
    get agentDir() {
      return agentDir;
    },
    getSettings() {
      return settingsForUi();
    },
    patchSettings(patch) {
      const cwdChanged = Boolean(patch.cwd && !samePath(patch.cwd, cwd));
      const mergedExtra =
        patch.extraExtensions !== undefined
          ? normalizePackagePaths(patch.extraExtensions, patch.cwd ? path.resolve(patch.cwd) : cwd)
          : settings.extraExtensions;
      if (patch.cwd) {
        cwd = ensureWorkspaceDir(patch.cwd);
        workspacePaths = rememberWorkspace(workspacePaths, cwd);
      }
      if (patch.workspaces) {
        workspacePaths = normalizeWorkspaceList(patch.workspaces, cwd);
      }
      settings = saveSettings(
        {
          ...settings,
          ...patch,
          cwd,
          workspaces: workspacePaths,
          extraExtensions: mergedExtra,
        },
        agentDir,
      );
      if (
        patch.model !== undefined
        || patch.provider !== undefined
        || patch.baseUrl !== undefined
      ) {
        const resolved = resolveRuntimeModel({ agentDir, settings });
        replaceModel(resolved.model);
      }
      runner.setModel(model);
      if (patch.thinkingLevel !== undefined) {
        const nextLevel = coerceThinkingLevel(patch.thinkingLevel);
        if (nextLevel !== runner.getThinkingLevel()) {
          runner.setThinkingLevel(nextLevel);
          session.appendThinkingLevelChange(nextLevel);
        }
      }
      if (cwdChanged) {
        void reloadExtensionsForCwd(cwd);
      } else if (patch.extraExtensions !== undefined) {
        void reloadExtensionsForCwd(cwd);
      } else {
        tools = rebuildTools();
      }
      return settingsForUi();
    },
    listSessions() {
      return SessionManager.list(sessionDir());
    },
    listWorkspaces() {
      return listWorkspaceViews();
    },
    selectWorkspace(dir, mode = "latest") {
      return switchToWorkspace(dir, mode);
    },
    addWorkspace(dir, mode = "latest") {
      return switchToWorkspace(dir, mode);
    },
    createTempWorkspace(mode = "new") {
      return switchToWorkspace(createTemporaryWorkspace(), mode);
    },
    removeWorkspace(dir) {
      const removingCurrent = samePath(dir, cwd);
      workspacePaths = forgetWorkspace(workspacePaths, dir);
      if (removingCurrent) {
        const fallback = workspacePaths[0] ?? createTemporaryWorkspace();
        applyWorkspace(fallback);
        openLatestOrNew();
      } else {
        persistWorkspaceState();
      }
      return { cwd, workspaces: listWorkspaceViews() };
    },
    createSession(opts) {
      if (opts?.cwd) applyWorkspace(opts.cwd);
      history = [];
      session = wireSession(SessionManager.create(sessionDir(), undefined, cwd));
      persistSessionPointer();
      tools = rebuildTools();
      return { id: session.id, file: session.file, cwd };
    },
    openSession(id, workspacePath) {
      if (workspacePath) applyWorkspace(workspacePath);
      return bindSession(SessionManager.open(sessionDir(), id, cwd));
    },
    deleteSession(id, workspacePath) {
      const targetCwd = workspacePath?.trim() ? ensureWorkspaceDir(workspacePath) : cwd;
      const dir = getSessionsDir(targetCwd, agentDir);
      const deletingActive = samePath(targetCwd, cwd) && session.id === id;
      // 删除正在运行的会话（含后台会话）先中止其请求
      activeRuns.get(id)?.abort();
      if (!SessionManager.remove(dir, id)) {
        throw new Error(`session not found: ${id}`);
      }
      if (deletingActive) return openLatestOrNew();
      return {
        id: session.id,
        file: session.file,
        cwd,
        timeline: currentTimeline(session, history),
      };
    },
    getActiveSessionId() {
      return session.isPersisted() && session.getSessionFile() ? session.id : undefined;
    },
    getTimeline() {
      return currentTimeline(session, history);
    },
    isBusy() {
      return activeRuns.has(session.id);
    },
    abort() {
      activeRuns.get(session.id)?.abort();
      killTrackedChildren();
    },
    dispose() {
      for (const controller of activeRuns.values()) controller.abort();
      killTrackedChildren();
    },
    listExtensions() {
      return {
        extensions: loaded.extensions.map((ext) => ({
          path: ext.path,
          tools: [...ext.tools.keys()],
          commands: [...ext.commands.keys()],
        })),
        errors: loaded.errors,
      };
    },
    listUiContributions() {
      const contributions: UiContribution[] = [];
      const warnings: string[] = [];
      const seen = new Set<string>();
      for (const ext of loaded.extensions) {
        for (const ui of ext.uiContributions ?? []) {
          if (seen.has(ui.id)) {
            warnings.push(`UI 贡献 id 重复，已忽略后者：${ui.id}（${ext.path}）`);
            continue;
          }
          seen.add(ui.id);
          const base = {
            id: ui.id,
            title: ui.title,
            description: ui.description,
            icon: ui.icon,
            command: ui.command,
            url: ui.url,
          };
          contributions.push(
            ui.version === 2
              ? {
                  ...base,
                  version: 2,
                  slot: ui.slot,
                  order: ui.order,
                  when: ui.when,
                  uiModule: ui.uiModule,
                  uiVersion: ui.uiVersion,
                  permissions: ui.permissions,
                  settings: ui.settings,
                }
              : { ...base, version: 1 },
          );
        }
      }
      return { contributions, warnings };
    },
    getSlotData(slot, contributionId) {
      for (const ext of loaded.extensions) {
        const provider = ext.slotData.get(contributionId);
        if (!provider) continue;
        try {
          const data = provider({ slot: slot as ShellSlot, cwd, id: contributionId });
          return { ok: true, data };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      }
      return { ok: false, error: `slot data provider not found: ${contributionId}` };
    },
    getPluginComponentModule(contributionId) {
      for (const ext of loaded.extensions) {
        const ui = ext.uiContributions.find(
          (item) => item.id === contributionId && item.version === 2 && item.uiModule,
        );
        if (!ui || ui.version !== 2) continue;
        const modulePath = path.resolve(path.dirname(ext.path), ui.uiModule!);
        if (!fs.existsSync(modulePath)) {
          return { ok: false, error: `uiModule 不存在：${modulePath}` };
        }
        return { ok: true, path: modulePath };
      }
      return { ok: false, error: `component module not found: ${contributionId}` };
    },
    listEnvVars() {
      return { ...settings.envVars };
    },
    setEnvVar(key: string, value: string) {
      if (!settings.envVars) settings.envVars = {};
      settings.envVars[key] = value;
      process.env[key] = value;
      saveSettings(settings, agentDir);
    },
    removeEnvVar(key: string) {
      if (settings.envVars) {
        delete settings.envVars[key];
        saveSettings(settings, agentDir);
      }
      delete process.env[key];
    },
    listSkills() {
      return skillItems(loadSkills(cwd));
    },
    listPrompts() {
      return loadPrompts(cwd).map((prompt) => ({
        name: prompt.name,
        description: prompt.description,
        path: prompt.path,
        body: prompt.body,
      }));
    },
    respondExtensionUi(response) {
      desktopUi.respond(response);
    },
    listLocalPackages() {
      return [...(settings.extraExtensions ?? [])];
    },
    async reloadExtensions() {
      await reloadExtensionsForCwd(cwd);
      return api.listExtensions();
    },
    addLocalPackage(pkgPath) {
      const next = normalizePackagePaths([...(settings.extraExtensions ?? []), pkgPath], cwd);
      return api.patchSettings({ extraExtensions: next });
    },
    removeLocalPackage(pkgPath) {
      const resolved = path.isAbsolute(pkgPath) ? path.normalize(pkgPath) : path.resolve(cwd, pkgPath);
      const next = (settings.extraExtensions ?? []).filter((p) => p.toLowerCase() !== resolved.toLowerCase());
      return api.patchSettings({ extraExtensions: next });
    },
    getModelsJsonPreview() {
      return previewModelsJson({ agentDir });
    },
    listBuiltinProviders(): BuiltinProviderView[] {
      // 统一注册表：内置目录 + 扩展动态注册（扩展覆盖同 id 的内置条目）
      return listProviderViews();
    },
    async refreshProviderModels(provider: string): Promise<Model[]> {
      return refreshProviderModels(provider);
    },
    async testProviderConnection(input: ProviderProbeInput): Promise<ProviderProbeResult> {
      return probeProviderConnection(input);
    },
    getModelsJsonConfig() {
      return readModelsJsonConfig(agentDir);
    },
    upsertCustomProvider(input) {
      return upsertCustomProviderInModelsJson(agentDir, input);
    },
    addProviderModels(input) {
      return addModelsToProviderInModelsJson(agentDir, input);
    },
    async fetchRemoteModels(opts) {
      if (opts.provider?.trim()) {
        return fetchProviderRemoteModels(agentDir, opts.provider, opts.apiKey, opts.proxy);
      }
      const baseUrl = opts.baseUrl?.trim();
      if (!baseUrl) throw new Error("fetchRemoteModels requires provider or baseUrl");
      const models = await fetchOpenAiModelList({ baseUrl, apiKey: opts.apiKey, proxy: opts.proxy });
      return { baseUrl, models };
    },
    removeCustomProvider(provider) {
      return removeCustomProviderFromModelsJson(agentDir, provider);
    },
    removeCustomModel(provider, modelId) {
      return removeCustomModelFromModelsJson(agentDir, provider, modelId);
    },
    setProviderApiKey(provider, apiKey) {
      return setProviderApiKeyInModelsJson(agentDir, provider, apiKey);
    },
    clearProviderApiKey(provider) {
      return clearProviderApiKeyInModelsJson(agentDir, provider);
    },
    listModelOptions() {
      return listModelOptions(agentDir);
    },
    selectModel(provider, modelId) {
      return applyModelSelection(provider, modelId);
    },
    exportSession(format = "markdown", sessionId) {
      const id = sessionId?.trim() || session.id;
      return exportSessionToDir({
        sessionsDir: sessionDir(),
        exportDir: path.join(agentDir, "exports"),
        sessionId: id,
        format,
      });
    },
    async shareSession(sessionId) {
      const id = sessionId?.trim() || session.id;
      return shareSessionViaGh({
        sessionsDir: sessionDir(),
        sessionId: id,
      });
    },
    getSessionUsage(sessionId) {
      const id = sessionId?.trim();
      if (id && id !== session.id) {
        try {
          const other = SessionManager.open(sessionDir(), id, cwd);
          const msgs = historyFromSession(other);
          return buildSessionUsageView({
            sessionId: other.id,
            messages: msgs,
            cost: model.cost,
            contextWindow: model.contextWindow,
          });
        } catch {
          return buildSessionUsageView({
            sessionId: id,
            messages: [],
            cost: model.cost,
            contextWindow: model.contextWindow,
          });
        }
      }
      return buildSessionUsageView({
        sessionId: session.id,
        messages: history,
        cost: model.cost,
        contextWindow: model.contextWindow,
      });
    },
    getUsageStats() {
      return buildUsageStatsView(agentDir);
    },
    setSessionName(name) {
      session.appendSessionInfo(name);
      persistSessionPointer();
      return { id: session.id, name: session.getSessionName() };
    },
    forkSession(leafId) {
      const target = leafId?.trim() || session.getLeafId();
      if (!target) throw new Error("nothing to fork");
      session.createBranchedSession(target);
      persistSessionPointer();
      history = historyFromSession(session);
      tools = rebuildTools();
      return {
        id: session.id,
        file: session.file,
        cwd,
        timeline: currentTimeline(session, history),
      };
    },
    async prompt(text, images) {
      const trimmed = text.trim();
      const imageBlocks = (images ?? [])
        .filter((img) => typeof img?.data === "string" && img.data.trim() && typeof img?.mimeType === "string")
        .map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
      if (!trimmed && imageBlocks.length === 0) return;
      ensurePersistedSession();
      if (activeRuns.has(session.id)) {
        throw new Error("该会话正在处理中；可切换到其他会话继续工作");
      }
      const apiKey = resolveKey();
      if (!apiKey) {
        throw new Error("Missing API key. Set ALUKA_API_KEY / OPENAI_API_KEY or save apiKey in settings.");
      }

      // 捕获当前会话上下文：请求进行中切换/打开其他会话不影响本请求
      const sessionId = session.id;
      const activeSession = session;
      const activeHistory = history;
      const controller = new AbortController();
      activeRuns.set(sessionId, controller);
      runner.setIdle(false);
      runner.setSignal(controller);

      const releaseBusy = () => {
        activeRuns.delete(sessionId);
        if (activeRuns.size === 0) {
          runner.setIdle(true);
          runner.setSignal(undefined);
        }
      };

      try {
        const input = await runner.emitInput(trimmed);
        if (input?.action === "handled") {
          await emitDesktop({ type: "agent_end", sessionId });
          return;
        }
        const promptText = input?.action === "transform" ? input.text : trimmed;

        const user: AgentMessage = {
          role: "user",
          content: [
            ...(promptText ? [{ type: "text" as const, text: promptText }] : []),
            ...imageBlocks,
          ],
          timestamp: Date.now(),
        };
        activeSession.append({ type: "message", message: user });
        const before = await runner.emitBeforeAgentStart(promptText, systemPrompt);
        if (before?.systemPrompt) {
          systemPrompt = before.systemPrompt;
          runner.setSystemPrompt(systemPrompt);
        }

        activeHistory.push(user);

        const produced = await runAgentLoop(
          [user],
          {
            systemPrompt,
            messages: activeHistory.slice(0, -1),
            tools,
          },
          {
            model,
            apiKey,
            thinkingLevel: runner.getThinkingLevel(),
            transformContext: (messages) => runner.emitContext(messages),
            beforeProviderRequest: async (payload) => {
              const replaced = await runner.emitEvent({ type: "before_provider_request", payload });
              // 扩展应返回新的请求体；若误返回事件对象则取 .payload
              if (
                replaced
                && typeof replaced === "object"
                && "payload" in replaced
                && (replaced as { type?: string }).type === "before_provider_request"
              ) {
                return (replaced as { payload: unknown }).payload ?? payload;
              }
              return replaced ?? payload;
            },
          },
          async (event) => {
            await runner.emitEvent(event as never);
            const projected = projectEvent(sessionId, event);
            if (projected) await emitDesktop(projected);
          },
          controller.signal,
          // 注册表供应商的自定义流式实现优先于默认协议路由
          findProviderEntry(model.provider)?.streamSimple as StreamFn | undefined,
        );

        activeHistory.push(...produced.filter((message) => message !== user));
        activeSession.append({ type: "turn", messages: produced });
        // 全局用量账本：按 供应商/模型 累计本轮各次调用的输入/输出 token
        recordProducedUsage(agentDir, produced);
        await runner.emitEvent({ type: "agent_settled" });
        await emitDesktop({
          type: "usage",
          sessionId,
          usage: buildSessionUsageView({
            sessionId,
            messages: activeHistory,
            cost: model.cost,
            contextWindow: model.contextWindow,
          }),
        });
      } catch (error) {
        releaseBusy();
        const message = error instanceof Error ? error.message : String(error);
        try {
          await emitDesktop({ type: "error", sessionId, message });
        } catch {
          /* 上报失败不能重新锁住 Agent */
        }
        throw error;
      } finally {
        releaseBusy();
      }
    },
  };

  await runner.emitEvent({ type: "session_start", reason: "startup" });
  return api;
}
