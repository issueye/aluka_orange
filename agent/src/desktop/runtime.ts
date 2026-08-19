/**
 * 桌面 Host 用 Agent 运行时：会话列表 / 打开 / prompt / abort / 设置 / 扩展 UI。
 * 供 Aluka Desktop 经 RPC 调用，不依赖 Electron。
 */

import path from "node:path";
import { runAgentLoop } from "../agent/loop.ts";
import type { AgentEvent, AgentMessage } from "../agent/types.ts";
import { textFrom } from "../agent/types.ts";
import { getAgentDir, getSessionsDir } from "../config.ts";
import { createEventBus } from "../extensions/event-bus.ts";
import { createExtensionRuntime, loadExtensions } from "../extensions/loader.ts";
import { ExtensionRunner } from "../extensions/runner.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { resolveRuntimeApiKey, resolveRuntimeModel } from "../models.ts";
import { SessionManager, type SessionSummary } from "../session/manager.ts";
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
  listModelOptions,
  lookupProviderModel,
  type ModelsJsonPreview,
  type ModelsJsonConfigView,
  type ModelOptionView,
  type UpsertCustomProviderInput,
} from "./models-json.ts";
import {
  installNpmPackageToAgent,
  type InstallNpmPackageOutcome,
} from "./packages.ts";
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
import type { Usage } from "../ai/types.ts";

/** 投影给桌面 UI 的精简事件（可 JSON 序列化） */
export type DesktopRuntimeEvent =
  | { type: "agent_start"; sessionId: string }
  | { type: "agent_end"; sessionId: string; usage?: SessionUsageTotals }
  | { type: "text_delta"; sessionId: string; text: string }
  | { type: "message_end"; sessionId: string; role: string; text: string; usage?: Usage }
  | { type: "tool_start"; sessionId: string; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_end"; sessionId: string; toolCallId: string; toolName: string; isError: boolean; resultText: string }
  | { type: "error"; sessionId: string; message: string }
  | { type: "extension_ui"; request: ExtensionUiRequest }
  | { type: "usage"; sessionId: string; usage: SessionUsageView };

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
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  toolName?: string;
  timestamp: number;
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

export interface DesktopRuntime {
  readonly cwd: string;
  readonly agentDir: string;
  getSettings(): ReturnType<typeof settingsView>;
  patchSettings(patch: DesktopSettings): ReturnType<typeof settingsView>;
  listSessions(): SessionSummary[];
  createSession(): { id: string; file: string };
  openSession(id: string): { id: string; file: string; timeline: TimelineItem[] };
  getActiveSessionId(): string | undefined;
  getTimeline(): TimelineItem[];
  isBusy(): boolean;
  prompt(text: string): Promise<void>;
  abort(): void;
  listExtensions(): ExtensionInventory;
  listSkills(): SkillListItem[];
  respondExtensionUi(response: ExtensionUiResponse): void;
  /** 已持久化的本地扩展路径（不含启动期 demo opts） */
  listLocalPackages(): string[];
  addLocalPackage(pkgPath: string): ReturnType<typeof settingsView>;
  removeLocalPackage(pkgPath: string): ReturnType<typeof settingsView>;
  /** 只读预览 ~/.aluka|~/.pi/agent/models.json（无密钥） */
  getModelsJsonPreview(): ModelsJsonPreview;
  /** 可编辑的 Aluka agentDir/models.json 配置视图 */
  getModelsJsonConfig(): ModelsJsonConfigView;
  upsertCustomProvider(input: UpsertCustomProviderInput): ModelsJsonConfigView;
  removeCustomProvider(provider: string): ModelsJsonConfigView;
  removeCustomModel(provider: string, modelId: string): ModelsJsonConfigView;
  setProviderApiKey(provider: string, apiKey: string): ModelsJsonConfigView;
  clearProviderApiKey(provider: string): ModelsJsonConfigView;
  /** Composer 模型下拉选项 */
  listModelOptions(): ModelOptionView[];
  /** 选用 models.json 中的 provider/model，并写入 settings */
  selectModel(provider: string, modelId: string): ReturnType<typeof settingsView>;
  /** 用 aluka/npm install 把包装进 agent/npm-packages，并注册扩展入口 */
  installNpmPackage(spec: string): Promise<InstallNpmPackageOutcome>;
  /** 导出当前或指定会话到 agentDir/exports */
  exportSession(format?: SessionExportFormat, sessionId?: string): SessionExportOutcome;
  /** 经 gh gist 分享会话（secret gist）；需本机 gh 已登录 */
  shareSession(sessionId?: string): Promise<SessionShareOutcome>;
  /** 当前会话 token 用量汇总（API key 路径；无 OAuth 配额） */
  getSessionUsage(sessionId?: string): SessionUsageView;
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
      let resultText = "";
      try {
        resultText = typeof event.result === "string" ? event.result : JSON.stringify(event.result);
      } catch {
        resultText = String(event.result);
      }
      if (resultText.length > 4000) resultText = `${resultText.slice(0, 4000)}…`;
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

function timelineFromHistory(messages: AgentMessage[]): TimelineItem[] {
  return messages.map((message, index) => {
    if (message.role === "toolResult") {
      return {
        id: `tool-${index}`,
        role: "tool" as const,
        text: textFrom(message),
        toolName: message.toolName,
        timestamp: Date.now(),
      };
    }
    const role =
      message.role === "assistant" ? ("assistant" as const) : message.role === "user" ? ("user" as const) : ("system" as const);
    const ts =
      message.role === "user" && "timestamp" in message && typeof (message as { timestamp?: number }).timestamp === "number"
        ? (message as { timestamp: number }).timestamp
        : Date.now();
    return {
      id: `${role}-${index}`,
      role,
      text: textFrom(message),
      timestamp: ts,
    };
  });
}

function historyFromSession(session: SessionManager): AgentMessage[] {
  const out: AgentMessage[] = [];
  for (const entry of session.getEntries()) {
    if (entry.type === "user" && typeof entry.text === "string") {
      out.push({
        role: "user",
        content: [{ type: "text", text: entry.text }],
        timestamp: entry.timestamp,
      });
      continue;
    }
    if (entry.type === "turn" && Array.isArray(entry.messages)) {
      for (const message of entry.messages as AgentMessage[]) {
        if (message.role === "user") continue;
        out.push(message);
      }
    }
  }
  return out;
}

function skillItems(skills: Skill[]): SkillListItem[] {
  return skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    path: skill.path,
  }));
}

function resolveExtraPaths(cwd: string, settings: DesktopSettings, opts: CreateDesktopRuntimeOptions): string[] {
  const fromOpts = opts.extraExtensionPaths ?? [];
  const fromSettings = settings.extraExtensions ?? [];
  return [...fromOpts, ...fromSettings].map((p) => (path.isAbsolute(p) ? p : path.resolve(cwd, p)));
}

export async function createDesktopRuntime(opts: CreateDesktopRuntimeOptions = {}): Promise<DesktopRuntime> {
  const agentDir = opts.agentDir ?? getAgentDir();
  const stored = loadSettings(agentDir);
  let cwd = path.resolve(opts.cwd ?? stored.cwd ?? process.cwd());
  let settings = { ...stored };
  if (opts.model) settings.model = opts.model;
  if (opts.provider) settings.provider = opts.provider;
  if (opts.baseUrl) settings.baseUrl = opts.baseUrl;
  if (opts.apiKey) settings.apiKey = opts.apiKey;

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

  let loaded = await loadExtensions({
    cwd,
    extraPaths: resolveExtraPaths(cwd, settings, opts),
  }).catch((error) => ({
    extensions: [],
    errors: [{ path: "loadExtensions", error: error instanceof Error ? error.message : String(error) }],
    runtime: createExtensionRuntime(),
  }));
  const sessionDir = () => getSessionsDir(cwd, agentDir);

  let session = SessionManager.create(sessionDir());
  let history: AgentMessage[] = [];
  let busy = false;
  let controller: AbortController | undefined;
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

  let tools = rebuildTools();

  if (settings.lastSessionId) {
    try {
      session = SessionManager.open(sessionDir(), settings.lastSessionId);
      history = historyFromSession(session);
      tools = rebuildTools();
    } catch {
      /* keep newly created session */
    }
  }

  emitDesktop = async (event) => {
    await opts.onEvent?.(event);
  };

  function resolveKey(): string | undefined {
    return resolveRuntimeApiKey({ agentDir, model, apiKey: settings.apiKey });
  }

  function replaceModel(next: typeof model) {
    model.id = next.id;
    model.name = next.name;
    model.provider = next.provider;
    model.api = next.api;
    model.baseUrl = next.baseUrl;
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
    const patch: DesktopSettings = {
      model: found.id,
      provider: found.provider,
      baseUrl: found.baseUrl ?? "",
    };
    if (found.apiKey) patch.apiKey = found.apiKey;
    settings = saveSettings({ ...settings, ...patch, cwd }, agentDir);
    tools = rebuildTools();
    return settingsView(settings, agentDir);
  }

  async function reloadExtensionsForCwd(nextCwd: string) {
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
      return settingsView(settings, agentDir);
    },
    patchSettings(patch) {
      const cwdChanged = Boolean(patch.cwd && path.resolve(patch.cwd) !== cwd);
      const mergedExtra =
        patch.extraExtensions !== undefined
          ? normalizePackagePaths(patch.extraExtensions, patch.cwd ? path.resolve(patch.cwd) : cwd)
          : settings.extraExtensions;
      settings = saveSettings(
        {
          ...settings,
          ...patch,
          cwd: patch.cwd ? path.resolve(patch.cwd) : cwd,
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
      if (cwdChanged) {
        void reloadExtensionsForCwd(path.resolve(patch.cwd!));
      } else if (patch.extraExtensions !== undefined) {
        void reloadExtensionsForCwd(cwd);
      } else {
        tools = rebuildTools();
      }
      return settingsView(settings, agentDir);
    },
    listSessions() {
      return SessionManager.list(sessionDir());
    },
    createSession() {
      session = SessionManager.create(sessionDir());
      history = [];
      settings = saveSettings({ ...settings, lastSessionId: session.id, cwd }, agentDir);
      tools = rebuildTools();
      return { id: session.id, file: session.file };
    },
    openSession(id) {
      session = SessionManager.open(sessionDir(), id);
      history = historyFromSession(session);
      settings = saveSettings({ ...settings, lastSessionId: session.id, cwd }, agentDir);
      tools = rebuildTools();
      return { id: session.id, file: session.file, timeline: timelineFromHistory(history) };
    },
    getActiveSessionId() {
      return session.id;
    },
    getTimeline() {
      return timelineFromHistory(history);
    },
    isBusy() {
      return busy;
    },
    abort() {
      controller?.abort();
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
    listSkills() {
      return skillItems(loadSkills(cwd));
    },
    respondExtensionUi(response) {
      desktopUi.respond(response);
    },
    listLocalPackages() {
      return [...(settings.extraExtensions ?? [])];
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
    getModelsJsonConfig() {
      return readModelsJsonConfig(agentDir);
    },
    upsertCustomProvider(input) {
      return upsertCustomProviderInModelsJson(agentDir, input);
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
    async installNpmPackage(spec) {
      const outcome = await installNpmPackageToAgent({ agentDir, spec });
      if (outcome.ok) {
        api.addLocalPackage(outcome.entryPath);
      }
      return outcome;
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
          const other = SessionManager.open(sessionDir(), id);
          const msgs = historyFromSession(other);
          return buildSessionUsageView({
            sessionId: other.id,
            messages: msgs,
            cost: model.cost,
          });
        } catch {
          return buildSessionUsageView({
            sessionId: id,
            messages: [],
            cost: model.cost,
          });
        }
      }
      return buildSessionUsageView({
        sessionId: session.id,
        messages: history,
        cost: model.cost,
      });
    },
    async prompt(text) {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (busy) throw new Error("agent is busy");
      const apiKey = resolveKey();
      if (!apiKey) {
        throw new Error("Missing API key. Set ALUKA_API_KEY / OPENAI_API_KEY or save apiKey in settings.");
      }

      busy = true;
      controller = new AbortController();
      runner.setIdle(false);
      runner.setSignal(controller);
      const sessionId = session.id;

      try {
        const input = await runner.emitInput(trimmed);
        if (input?.action === "handled") return;
        const promptText = input?.action === "transform" ? input.text : trimmed;

        session.append({ type: "user", role: "user", text: promptText });
        const before = await runner.emitBeforeAgentStart(promptText, systemPrompt);
        if (before?.systemPrompt) {
          systemPrompt = before.systemPrompt;
          runner.setSystemPrompt(systemPrompt);
        }

        const user: AgentMessage = {
          role: "user",
          content: [{ type: "text", text: promptText }],
          timestamp: Date.now(),
        };
        history.push(user);

        const produced = await runAgentLoop(
          [user],
          {
            systemPrompt,
            messages: history.slice(0, -1),
            tools,
          },
          {
            model,
            apiKey,
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
        );

        history.push(...produced.filter((message) => message !== user));
        session.append({ type: "turn", messages: produced });
        await runner.emitEvent({ type: "agent_settled" });
        await emitDesktop({
          type: "usage",
          sessionId,
          usage: buildSessionUsageView({
            sessionId,
            messages: history,
            cost: model.cost,
          }),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await emitDesktop({ type: "error", sessionId, message });
        throw error;
      } finally {
        busy = false;
        controller = undefined;
        runner.setIdle(true);
        runner.setSignal(undefined);
      }
    },
  };

  await runner.emitEvent({ type: "session_start", reason: "startup" });
  return api;
}
