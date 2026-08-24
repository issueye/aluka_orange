/**
 * pi-agent 兼容的扩展类型定义
 *
 * 这是扩展系统的核心类型文件，定义了扩展开发所需的全部类型。
 *
 * 扩展模块的导出格式：
 *   export default function (pi: ExtensionAPI) { ... }
 *
 * 主要类型包括：
 * - ExtensionAPI: 扩展 API 接口，提供注册工具、命令、事件监听等能力
 * - ExtensionContext: 扩展运行上下文，包含 UI、模型、会话等信息
 * - ToolDefinition: 工具定义，描述工具的参数、执行逻辑和渲染方式
 * - ExtensionEvent: 扩展事件联合类型，覆盖 Agent 生命周期的各个阶段
 * - ExtensionRunner: 扩展运行器，管理扩展的加载和事件分发
 */

import type { Static, TSchema } from "typebox";
import type {
  Api,
  AssistantMessageEvent,
  ImageContent,
  Model,
  OAuthCredentials,
  OAuthLoginCallbacks,
  Provider,
  ProviderHeaders,
  RefreshModelsContext,
  SimpleStreamOptions,
  TextContent,
  ThinkingLevel,
  ToolExecutionMode,
  Usage,
} from "../ai/types.ts";
import type {
  AgentMessage,
  AgentToolResult,
  AgentToolUpdateCallback,
  CustomMessage,
} from "../agent/types.ts";
import type {
  AutocompleteItem,
  AutocompleteProvider,
  Component,
  EditorComponent,
  EditorTheme,
  KeyId,
  OverlayHandle,
  OverlayOptions,
  TUI,
} from "../tui/index.ts";
import type { EventBus } from "./event-bus.ts";
import type { SourceInfo } from "../source-info.ts";

export type { AgentToolResult, AgentToolUpdateCallback, ToolExecutionMode };
export type { EventBus };

/** 扩展运行模式 */
export type ExtensionMode = "tui" | "rpc" | "json" | "print";
/** Widget 放置位置 */
export type WidgetPlacement = "aboveEditor" | "belowEditor";
/** 输入来源 */
export type InputSource = "interactive" | "rpc" | "extension";
/** 模型切换来源 */
export type ModelSelectSource = "set" | "cycle" | "restore";

export interface ExtensionUIDialogOptions {
  signal?: AbortSignal;
  timeout?: number;
}

export interface ExtensionWidgetOptions {
  placement?: WidgetPlacement;
}

export type TerminalInputHandler = (data: string) => { consume?: boolean; data?: string } | undefined;

export interface WorkingIndicatorOptions {
  frames?: string[];
  intervalMs?: number;
}

export type AutocompleteProviderFactory = (current: AutocompleteProvider) => AutocompleteProvider;
export type EditorFactory = (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent;

export interface Theme {
  name: string;
  [key: string]: unknown;
}

export interface KeybindingsManager {
  handle(data: string): boolean;
}

export interface ReadonlyFooterDataProvider {
  gitBranch?: string;
  statuses: Record<string, string>;
}

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface SlashCommandInfo {
  name: string;
  description?: string;
  source?: SlashCommandSource;
}

export type SlashCommandSource = "builtin" | "extension";

export interface ExtensionUIContext {
  select(title: string, options: string[], opts?: ExtensionUIDialogOptions): Promise<string | undefined>;
  confirm(title: string, message: string, opts?: ExtensionUIDialogOptions): Promise<boolean>;
  input(title: string, placeholder?: string, opts?: ExtensionUIDialogOptions): Promise<string | undefined>;
  notify(message: string, type?: "info" | "warning" | "error"): void;
  onTerminalInput(handler: TerminalInputHandler): () => void;
  setStatus(key: string, text: string | undefined): void;
  setWorkingMessage(message?: string): void;
  setWorkingVisible(visible: boolean): void;
  setWorkingIndicator(options?: WorkingIndicatorOptions): void;
  setHiddenThinkingLabel(label?: string): void;
  setWidget(key: string, content: string[] | undefined, options?: ExtensionWidgetOptions): void;
  setWidget(
    key: string,
    content: ((tui: TUI, theme: Theme) => Component & { dispose?(): void }) | undefined,
    options?: ExtensionWidgetOptions,
  ): void;
  setFooter(
    factory:
      | ((tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider) => Component & { dispose?(): void })
      | undefined,
  ): void;
  setHeader(factory: ((tui: TUI, theme: Theme) => Component & { dispose?(): void }) | undefined): void;
  setTitle(title: string): void;
  custom<T>(
    factory: (
      tui: TUI,
      theme: Theme,
      keybindings: KeybindingsManager,
      done: (result: T) => void,
    ) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
    options?: {
      overlay?: boolean;
      overlayOptions?: OverlayOptions | (() => OverlayOptions);
      onHandle?: (handle: OverlayHandle) => void;
    },
  ): Promise<T>;
  pasteToEditor(text: string): void;
  setEditorText(text: string): void;
  getEditorText(): string;
  editor(title: string, prefill?: string): Promise<string | undefined>;
  addAutocompleteProvider(factory: AutocompleteProviderFactory): void;
  setEditorComponent(factory: EditorFactory | undefined): void;
  getEditorComponent(): EditorFactory | undefined;
  readonly theme: Theme;
  getAllThemes(): { name: string; path: string | undefined }[];
  getTheme(name: string): Theme | undefined;
  setTheme(theme: string | Theme): { success: boolean; error?: string };
  getToolsExpanded(): boolean;
  setToolsExpanded(expanded: boolean): void;
}

export interface ContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export interface CompactOptions {
  customInstructions?: string;
  onComplete?: (result: unknown) => void;
  onError?: (error: Error) => void;
}

export interface SessionManager {
  file: string;
  append(entry: unknown): unknown;
  getEntries(): unknown[];
  getSessionFile?(): string | undefined;
  getSessionId?(): string;
  getSessionName?(): string | undefined;
  appendMessage?(message: unknown): string;
  buildSessionContext?(): { messages: unknown[] };
}

export type ReadonlySessionManager = Pick<SessionManager, "file" | "getEntries">;

export interface ModelRegistry {
  getModels(): Model[];
  resolveApiKey(model: Model): string | undefined;
}

export interface ScopedModel {
  model: Model;
  source?: string;
}

export interface BuildSystemPromptOptions {
  cwd: string;
  skills?: unknown[];
  contextFiles?: string[];
}

export interface ExtensionContext {
  ui: ExtensionUIContext;
  mode: ExtensionMode;
  hasUI: boolean;
  cwd: string;
  sessionManager: ReadonlySessionManager;
  modelRegistry: ModelRegistry;
  model: Model | undefined;
  scopedModels: readonly ScopedModel[];
  thinkingLevel?: ThinkingLevel;
  isIdle(): boolean;
  isProjectTrusted(): boolean;
  signal: AbortSignal | undefined;
  abort(): void;
  hasPendingMessages(): boolean;
  shutdown(): void;
  getContextUsage(): ContextUsage | undefined;
  compact(options?: CompactOptions): void;
  getSystemPrompt(): string;
}

export interface ReplacedSessionContext extends ExtensionCommandContext {
  sendMessage(
    message: Pick<CustomMessage, "customType" | "content" | "display" | "details">,
    options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
  ): Promise<void>;
  sendUserMessage(
    content: string | Array<TextContent | ImageContent>,
    options?: { deliverAs?: "steer" | "followUp"; expandPromptTemplates?: boolean },
  ): Promise<void>;
}

export interface ExtensionCommandContext extends ExtensionContext {
  getSystemPromptOptions(): BuildSystemPromptOptions;
  waitForIdle(): Promise<void>;
  newSession(options?: {
    parentSession?: string;
    setup?: (sessionManager: SessionManager) => Promise<void>;
    withSession?: (ctx: ReplacedSessionContext) => Promise<void>;
  }): Promise<{ cancelled: boolean }>;
  fork(
    entryId: string,
    options?: { position?: "before" | "at"; withSession?: (ctx: ReplacedSessionContext) => Promise<void> },
  ): Promise<{ cancelled: boolean }>;
  navigateTree(
    targetId: string,
    options?: { summarize?: boolean; customInstructions?: string; replaceInstructions?: boolean; label?: string },
  ): Promise<{ cancelled: boolean }>;
  switchSession(
    sessionPath: string,
    options?: { withSession?: (ctx: ReplacedSessionContext) => Promise<void> },
  ): Promise<{ cancelled: boolean }>;
  reload(): Promise<void>;
}

export interface ToolRenderResultOptions {
  expanded: boolean;
  isPartial: boolean;
}

export interface ToolRenderContext<TState = unknown, TArgs = unknown> {
  args: TArgs;
  toolCallId: string;
  invalidate: () => void;
  lastComponent: Component | undefined;
  state: TState;
  cwd: string;
  executionStarted: boolean;
  argsComplete: boolean;
  isPartial: boolean;
  expanded: boolean;
  showImages: boolean;
  isError: boolean;
}

export interface ToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown, TState = unknown> {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: TParams;
  constrainedSampling?: false | Record<string, unknown>;
  renderShell?: "default" | "self";
  prepareArguments?: (args: unknown) => Static<TParams>;
  executionMode?: ToolExecutionMode;
  execute(
    toolCallId: string,
    params: Static<TParams>,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult<TDetails>>;
  renderCall?: (args: Static<TParams>, theme: Theme, context: ToolRenderContext<TState, Static<TParams>>) => Component;
  renderResult?: (
    result: AgentToolResult<TDetails>,
    options: ToolRenderResultOptions,
    theme: Theme,
    context: ToolRenderContext<TState, Static<TParams>>,
  ) => Component;
}

type AnyToolDefinition = ToolDefinition<any, any, any>;

export function defineTool<TParams extends TSchema, TDetails = unknown, TState = unknown>(
  tool: ToolDefinition<TParams, TDetails, TState>,
): ToolDefinition<TParams, TDetails, TState> & AnyToolDefinition {
  return tool as ToolDefinition<TParams, TDetails, TState> & AnyToolDefinition;
}

export interface ProjectTrustEvent {
  type: "project_trust";
  cwd: string;
}
export type ProjectTrustEventDecision = "yes" | "no" | "undecided";
export interface ProjectTrustEventResult {
  trusted: ProjectTrustEventDecision;
  remember?: boolean;
}
export interface ProjectTrustContext {
  cwd: string;
  mode: ExtensionMode;
  hasUI: boolean;
  ui: Pick<ExtensionUIContext, "select" | "confirm" | "input" | "notify">;
}
export type ProjectTrustHandler = (
  event: ProjectTrustEvent,
  ctx: ProjectTrustContext,
) => Promise<ProjectTrustEventResult | void> | ProjectTrustEventResult | void;

export interface ResourcesDiscoverEvent {
  type: "resources_discover";
  cwd: string;
  reason: "startup" | "reload";
}
export interface ResourcesDiscoverResult {
  skillPaths?: string[];
  promptPaths?: string[];
  themePaths?: string[];
}

export interface SessionStartEvent {
  type: "session_start";
  reason: "startup" | "reload" | "new" | "resume" | "fork";
  previousSessionFile?: string;
}
export interface SessionInfoChangedEvent {
  type: "session_info_changed";
  name: string | undefined;
}
export interface SessionBeforeSwitchEvent {
  type: "session_before_switch";
  reason: "new" | "resume";
  targetSessionFile?: string;
}
export interface SessionBeforeForkEvent {
  type: "session_before_fork";
  entryId: string;
  position: "before" | "at";
}
export interface SessionBeforeCompactEvent {
  type: "session_before_compact";
  preparation: unknown;
  branchEntries: unknown[];
  customInstructions?: string;
  reason: "manual" | "threshold" | "overflow";
  willRetry: boolean;
  signal: AbortSignal;
}
export interface SessionCompactEvent {
  type: "session_compact";
  compactionEntry: unknown;
  fromExtension: boolean;
  reason: "manual" | "threshold" | "overflow";
  willRetry: boolean;
}
export interface SessionCompactFailedEvent {
  type: "session_compact_failed";
  reason: "manual" | "threshold" | "overflow";
  errorMessage?: string;
  aborted: boolean;
  willRetry: boolean;
  fromExtension: boolean;
}
export interface SessionShutdownEvent {
  type: "session_shutdown";
  reason: "quit" | "reload" | "new" | "resume" | "fork";
  targetSessionFile?: string;
}
export interface SessionBeforeTreeEvent {
  type: "session_before_tree";
  preparation: unknown;
  signal: AbortSignal;
}
export interface SessionTreeEvent {
  type: "session_tree";
  newLeafId: string | null;
  oldLeafId: string | null;
  summaryEntry?: unknown;
  fromExtension?: boolean;
}

export interface ContextEvent {
  type: "context";
  messages: AgentMessage[];
}
export interface BeforeProviderRequestEvent {
  type: "before_provider_request";
  payload: unknown;
}
export interface BeforeProviderHeadersEvent {
  type: "before_provider_headers";
  headers: ProviderHeaders;
}
export interface AfterProviderResponseEvent {
  type: "after_provider_response";
  status: number;
  headers: Record<string, string>;
}
export interface BeforeAgentStartEvent {
  type: "before_agent_start";
  prompt: string;
  images?: ImageContent[];
  systemPrompt: string;
  systemPromptOptions: BuildSystemPromptOptions;
}
export interface AgentStartEvent {
  type: "agent_start";
}
export interface AgentEndEvent {
  type: "agent_end";
  messages: AgentMessage[];
}
export interface AgentSettledEvent {
  type: "agent_settled";
}
export interface TurnStartEvent {
  type: "turn_start";
  turnIndex: number;
  timestamp: number;
}
export interface TurnEndEvent {
  type: "turn_end";
  turnIndex: number;
  message: AgentMessage;
  toolResults: unknown[];
}
export interface MessageStartEvent {
  type: "message_start";
  message: AgentMessage;
}
export interface MessageUpdateEvent {
  type: "message_update";
  message: AgentMessage;
  assistantMessageEvent: AssistantMessageEvent;
}
export interface MessageEndEvent {
  type: "message_end";
  message: AgentMessage;
}
export interface ToolExecutionStartEvent {
  type: "tool_execution_start";
  toolCallId: string;
  toolName: string;
  args: unknown;
}
export interface ToolExecutionUpdateEvent {
  type: "tool_execution_update";
  toolCallId: string;
  toolName: string;
  args: unknown;
  partialResult: unknown;
}
export interface ToolExecutionEndEvent {
  type: "tool_execution_end";
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
}
export interface ModelSelectEvent {
  type: "model_select";
  model: Model;
  previousModel: Model | undefined;
  source: ModelSelectSource;
}
export interface ThinkingLevelSelectEvent {
  type: "thinking_level_select";
  level: ThinkingLevel;
  previousLevel: ThinkingLevel;
}
export interface UserBashEvent {
  type: "user_bash";
  command: string;
  excludeFromContext: boolean;
  cwd: string;
}
export interface InputEvent {
  type: "input";
  text: string;
  images?: ImageContent[];
  source: InputSource;
  streamingBehavior?: "steer" | "followUp";
}

interface ToolCallEventBase {
  type: "tool_call";
  toolCallId: string;
}
export interface BashToolCallEvent extends ToolCallEventBase {
  toolName: "bash";
  input: { command: string; timeout?: number };
}
export interface ReadToolCallEvent extends ToolCallEventBase {
  toolName: "read";
  input: { path: string; offset?: number; limit?: number };
}
export interface EditToolCallEvent extends ToolCallEventBase {
  toolName: "edit";
  input: { path: string; oldText: string; newText: string };
}
export interface WriteToolCallEvent extends ToolCallEventBase {
  toolName: "write";
  input: { path: string; content: string };
}
export interface GrepToolCallEvent extends ToolCallEventBase {
  toolName: "grep";
  input: { pattern: string; path?: string; glob?: string };
}
export interface FindToolCallEvent extends ToolCallEventBase {
  toolName: "find";
  input: { pattern: string; path?: string };
}
export interface LsToolCallEvent extends ToolCallEventBase {
  toolName: "ls";
  input: { path?: string };
}
export interface WebFetchToolCallEvent extends ToolCallEventBase {
  toolName: "web_fetch";
  input: { url: string; maxChars?: number; extractMode?: string; timeout?: number; headers?: Record<string, string> };
}
export interface CustomToolCallEvent extends ToolCallEventBase {
  toolName: string;
  input: Record<string, unknown>;
}
export type ToolCallEvent =
  | BashToolCallEvent
  | ReadToolCallEvent
  | EditToolCallEvent
  | WriteToolCallEvent
  | GrepToolCallEvent
  | FindToolCallEvent
  | LsToolCallEvent
  | WebFetchToolCallEvent
  | CustomToolCallEvent;

interface ToolResultEventBase {
  type: "tool_result";
  toolCallId: string;
  input: Record<string, unknown>;
  content: Array<TextContent | ImageContent>;
  isError: boolean;
  usage?: Usage;
}
export interface BashToolResultEvent extends ToolResultEventBase {
  toolName: "bash";
  details: unknown;
}
export interface ReadToolResultEvent extends ToolResultEventBase {
  toolName: "read";
  details: unknown;
}
export interface EditToolResultEvent extends ToolResultEventBase {
  toolName: "edit";
  details: unknown;
}
export interface WriteToolResultEvent extends ToolResultEventBase {
  toolName: "write";
  details: undefined;
}
export interface GrepToolResultEvent extends ToolResultEventBase {
  toolName: "grep";
  details: unknown;
}
export interface FindToolResultEvent extends ToolResultEventBase {
  toolName: "find";
  details: unknown;
}
export interface LsToolResultEvent extends ToolResultEventBase {
  toolName: "ls";
  details: unknown;
}
export interface WebFetchToolResultEvent extends ToolResultEventBase {
  toolName: "web_fetch";
  details: unknown;
}
export interface CustomToolResultEvent extends ToolResultEventBase {
  toolName: string;
  details: unknown;
}
export type ToolResultEvent =
  | BashToolResultEvent
  | ReadToolResultEvent
  | EditToolResultEvent
  | WriteToolResultEvent
  | GrepToolResultEvent
  | FindToolResultEvent
  | LsToolResultEvent
  | WebFetchToolResultEvent
  | CustomToolResultEvent;

export function isBashToolResult(e: ToolResultEvent): e is BashToolResultEvent {
  return e.toolName === "bash";
}
export function isReadToolResult(e: ToolResultEvent): e is ReadToolResultEvent {
  return e.toolName === "read";
}
export function isEditToolResult(e: ToolResultEvent): e is EditToolResultEvent {
  return e.toolName === "edit";
}
export function isWriteToolResult(e: ToolResultEvent): e is WriteToolResultEvent {
  return e.toolName === "write";
}
export function isGrepToolResult(e: ToolResultEvent): e is GrepToolResultEvent {
  return e.toolName === "grep";
}
export function isFindToolResult(e: ToolResultEvent): e is FindToolResultEvent {
  return e.toolName === "find";
}
export function isLsToolResult(e: ToolResultEvent): e is LsToolResultEvent {
  return e.toolName === "ls";
}
export function isWebFetchToolResult(e: ToolResultEvent): e is WebFetchToolResultEvent {
  return e.toolName === "web_fetch";
}

export function isToolCallEventType(toolName: "bash", event: ToolCallEvent): event is BashToolCallEvent;
export function isToolCallEventType(toolName: "read", event: ToolCallEvent): event is ReadToolCallEvent;
export function isToolCallEventType(toolName: "edit", event: ToolCallEvent): event is EditToolCallEvent;
export function isToolCallEventType(toolName: "write", event: ToolCallEvent): event is WriteToolCallEvent;
export function isToolCallEventType(toolName: "grep", event: ToolCallEvent): event is GrepToolCallEvent;
export function isToolCallEventType(toolName: "find", event: ToolCallEvent): event is FindToolCallEvent;
export function isToolCallEventType(toolName: "ls", event: ToolCallEvent): event is LsToolCallEvent;
export function isToolCallEventType(toolName: "web_fetch", event: ToolCallEvent): event is WebFetchToolCallEvent;
export function isToolCallEventType<TName extends string, TInput extends Record<string, unknown>>(
  toolName: TName,
  event: ToolCallEvent,
): event is ToolCallEvent & { toolName: TName; input: TInput };
export function isToolCallEventType(toolName: string, event: ToolCallEvent): boolean {
  return event.toolName === toolName;
}

export type ExtensionEvent =
  | ProjectTrustEvent
  | ResourcesDiscoverEvent
  | SessionStartEvent
  | SessionInfoChangedEvent
  | SessionBeforeSwitchEvent
  | SessionBeforeForkEvent
  | SessionBeforeCompactEvent
  | SessionCompactEvent
  | SessionCompactFailedEvent
  | SessionShutdownEvent
  | SessionBeforeTreeEvent
  | SessionTreeEvent
  | ContextEvent
  | BeforeProviderRequestEvent
  | BeforeProviderHeadersEvent
  | AfterProviderResponseEvent
  | BeforeAgentStartEvent
  | AgentStartEvent
  | AgentEndEvent
  | AgentSettledEvent
  | TurnStartEvent
  | TurnEndEvent
  | MessageStartEvent
  | MessageUpdateEvent
  | MessageEndEvent
  | ToolExecutionStartEvent
  | ToolExecutionUpdateEvent
  | ToolExecutionEndEvent
  | ModelSelectEvent
  | ThinkingLevelSelectEvent
  | UserBashEvent
  | InputEvent
  | ToolCallEvent
  | ToolResultEvent;

export interface ContextEventResult {
  messages?: AgentMessage[];
}
export type BeforeProviderRequestEventResult = unknown;
export interface ToolCallEventResult {
  block?: boolean;
  reason?: string;
  terminate?: boolean;
}
export interface UserBashEventResult {
  operations?: unknown;
  result?: unknown;
}
export interface ToolResultEventResult {
  content?: Array<TextContent | ImageContent>;
  details?: unknown;
  isError?: boolean;
  usage?: Usage;
}
export interface MessageEndEventResult {
  message?: AgentMessage;
}
export interface BeforeAgentStartEventResult {
  message?: Pick<CustomMessage, "customType" | "content" | "display" | "details">;
  systemPrompt?: string;
}
export interface SessionBeforeSwitchResult {
  cancel?: boolean;
}
export interface SessionBeforeForkResult {
  cancel?: boolean;
  skipConversationRestore?: boolean;
}
export interface SessionBeforeCompactResult {
  cancel?: boolean;
  compaction?: unknown;
}
export interface SessionBeforeTreeResult {
  cancel?: boolean;
  summary?: { summary: string; details?: unknown; usage?: Usage };
}
export type InputEventResult =
  | { action: "continue" }
  | { action: "transform"; text: string; images?: ImageContent[] }
  | { action: "handled" };

export type MessageRenderer = (message: CustomMessage, options: unknown, theme: Theme) => Component | undefined;
export type EntryRenderer = (entry: unknown, options: unknown, theme: Theme) => Component | undefined;
export type MarkdownTransformer = (markdown: string, context: unknown) => string;

export interface RegisteredCommand {
  name: string;
  sourceInfo: SourceInfo;
  description?: string;
  getArgumentCompletions?: (
    argumentPrefix: string,
  ) => AutocompleteItem[] | null | Promise<AutocompleteItem[] | null>;
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

export type ExtensionHandler<E = unknown, R = undefined> = (
  event: E,
  ctx: ExtensionContext,
) => Promise<R | void> | R | void;

export interface ProviderModelConfig {
  id: string;
  name: string;
  api?: Api;
  baseUrl?: string;
  reasoning: boolean;
  thinkingLevelMap?: Model["thinkingLevelMap"];
  input: Array<"text" | "image">;
  cost: Model["cost"];
  contextWindow: number;
  maxTokens: number;
  headers?: Record<string, string>;
  compat?: Model["compat"];
}

export interface ProviderConfig {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  api?: Api;
  streamSimple?: (model: Model, context: unknown, options?: SimpleStreamOptions) => unknown;
  headers?: Record<string, string>;
  authHeader?: boolean;
  models?: ProviderModelConfig[];
  refreshModels?(context: RefreshModelsContext): Promise<ProviderModelConfig[]>;
  oauth?: {
    name: string;
    isSubscription?: boolean;
    usesCallbackServer?: boolean;
    login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;
    refreshToken(credentials: OAuthCredentials, signal: AbortSignal): Promise<OAuthCredentials>;
    getApiKey(credentials: OAuthCredentials): string;
    modifyModels?(models: Model[], credentials: OAuthCredentials): Model[];
  };
}

export interface ExtensionAPI {
  on(event: "project_trust", handler: ProjectTrustHandler): void;
  on(event: "resources_discover", handler: ExtensionHandler<ResourcesDiscoverEvent, ResourcesDiscoverResult>): void;
  on(event: "session_start", handler: ExtensionHandler<SessionStartEvent>): void;
  on(event: "session_info_changed", handler: ExtensionHandler<SessionInfoChangedEvent>): void;
  on(event: "session_before_switch", handler: ExtensionHandler<SessionBeforeSwitchEvent, SessionBeforeSwitchResult>): void;
  on(event: "session_before_fork", handler: ExtensionHandler<SessionBeforeForkEvent, SessionBeforeForkResult>): void;
  on(event: "session_before_compact", handler: ExtensionHandler<SessionBeforeCompactEvent, SessionBeforeCompactResult>): void;
  on(event: "session_compact", handler: ExtensionHandler<SessionCompactEvent>): void;
  on(event: "session_compact_failed", handler: ExtensionHandler<SessionCompactFailedEvent>): void;
  on(event: "session_shutdown", handler: ExtensionHandler<SessionShutdownEvent>): void;
  on(event: "session_before_tree", handler: ExtensionHandler<SessionBeforeTreeEvent, SessionBeforeTreeResult>): void;
  on(event: "session_tree", handler: ExtensionHandler<SessionTreeEvent>): void;
  on(event: "context", handler: ExtensionHandler<ContextEvent, ContextEventResult>): void;
  on(event: "before_provider_request", handler: ExtensionHandler<BeforeProviderRequestEvent, BeforeProviderRequestEventResult>): void;
  on(event: "before_provider_headers", handler: ExtensionHandler<BeforeProviderHeadersEvent>): void;
  on(event: "after_provider_response", handler: ExtensionHandler<AfterProviderResponseEvent>): void;
  on(event: "before_agent_start", handler: ExtensionHandler<BeforeAgentStartEvent, BeforeAgentStartEventResult>): void;
  on(event: "agent_start", handler: ExtensionHandler<AgentStartEvent>): void;
  on(event: "agent_end", handler: ExtensionHandler<AgentEndEvent>): void;
  on(event: "agent_settled", handler: ExtensionHandler<AgentSettledEvent>): void;
  on(event: "turn_start", handler: ExtensionHandler<TurnStartEvent>): void;
  on(event: "turn_end", handler: ExtensionHandler<TurnEndEvent>): void;
  on(event: "message_start", handler: ExtensionHandler<MessageStartEvent>): void;
  on(event: "message_update", handler: ExtensionHandler<MessageUpdateEvent>): void;
  on(event: "message_end", handler: ExtensionHandler<MessageEndEvent, MessageEndEventResult>): void;
  on(event: "tool_execution_start", handler: ExtensionHandler<ToolExecutionStartEvent>): void;
  on(event: "tool_execution_update", handler: ExtensionHandler<ToolExecutionUpdateEvent>): void;
  on(event: "tool_execution_end", handler: ExtensionHandler<ToolExecutionEndEvent>): void;
  on(event: "model_select", handler: ExtensionHandler<ModelSelectEvent>): void;
  on(event: "thinking_level_select", handler: ExtensionHandler<ThinkingLevelSelectEvent>): void;
  on(event: "tool_call", handler: ExtensionHandler<ToolCallEvent, ToolCallEventResult>): void;
  on(event: "tool_result", handler: ExtensionHandler<ToolResultEvent, ToolResultEventResult>): void;
  on(event: "user_bash", handler: ExtensionHandler<UserBashEvent, UserBashEventResult>): void;
  on(event: "input", handler: ExtensionHandler<InputEvent, InputEventResult>): void;
  on(event: string, handler: ExtensionHandler<any, any>): void;

  registerTool<TParams extends TSchema, TDetails = unknown, TState = unknown>(
    tool: ToolDefinition<TParams, TDetails, TState>,
  ): void;
  registerCommand(name: string, options: Omit<RegisteredCommand, "name" | "sourceInfo">): void;
  /**
   * 注册系统提示词片段：组装系统提示词时按注册顺序并入（每次重建工具/重载扩展后生效）。
   * 传函数可在每次组装时动态生成（如读取插件设置）。
   */
  registerSystemPrompt(fragment: string | (() => string)): void;
  /** 声明式 UI 贡献（v1/v2：宿主槽位/面板） */
  contributes(ui: UiContribution): void;
  /**
   * v2 预览：为槽位贡献注册数据提供者（宿主 T0 模板渲染时回调）。
   * 500ms 超时兜底，异常/超时回退静态元数据；同步返回、无副作用。
   */
  contributesData(id: string, provider: SlotDataProvider): void;
  /** v2 预览：数据主动变更信号（推送通道预留；宿主当前以轮询兜底） */
  refreshData(id: string): void;
  /** v2：读取插件设置（settings.section 贡献声明的键；来自 ~/.aluka/agent/settings.json 的 pluginSettings） */
  getPluginSetting(key: string): unknown;
  registerShortcut(
    shortcut: KeyId,
    options: { description?: string; handler: (ctx: ExtensionContext) => Promise<void> | void },
  ): void;
  registerFlag(
    name: string,
    options:
      | { description?: string; type: "boolean"; default?: boolean }
      | { description?: string; type: "string"; default?: string },
  ): void;
  getFlag(name: string): boolean | string | undefined;
  registerMessageRenderer(customType: string, renderer: MessageRenderer): void;
  registerMarkdownTransformer(transformer: MarkdownTransformer): void;
  registerEntryRenderer(customType: string, renderer: EntryRenderer): void;
  sendMessage(
    message: Pick<CustomMessage, "customType" | "content" | "display" | "details">,
    options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
  ): void;
  sendUserMessage(
    content: string | Array<TextContent | ImageContent>,
    options?: { deliverAs?: "steer" | "followUp"; expandPromptTemplates?: boolean },
  ): void;
  appendEntry<T>(customType: string, data?: T): void;
  setSessionName(name: string): void;
  getSessionName(): string | undefined;
  setLabel(entryId: string, label: string | undefined): void;
  exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult>;
  getActiveTools(): string[];
  getAllTools(): ToolInfo[];
  setActiveTools(toolNames: string[]): void;
  getCommands(): SlashCommandInfo[];
  setModel(model: Model): Promise<boolean>;
  getThinkingLevel(): ThinkingLevel;
  setThinkingLevel(level: ThinkingLevel): void;
  registerProvider(provider: Provider): void;
  registerProvider(name: string, config: ProviderConfig): void;
  unregisterProvider(name: string): void;
  events: EventBus;
}

export type ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>;

export type InlineExtension =
  | ExtensionFactory
  | { name: string; factory: ExtensionFactory; hidden?: boolean };

export interface RegisteredTool {
  definition: ToolDefinition;
  sourceInfo: SourceInfo;
}

export interface ExtensionFlag {
  name: string;
  description?: string;
  type: "boolean" | "string";
  default?: boolean | string;
  extensionPath: string;
}

export interface ExtensionShortcut {
  shortcut: KeyId;
  description?: string;
  handler: (ctx: ExtensionContext) => Promise<void> | void;
  extensionPath: string;
}

export type ToolInfo = Pick<ToolDefinition, "name" | "description" | "parameters" | "promptGuidelines"> & {
  sourceInfo: SourceInfo;
};

export interface Extension {
  path: string;
  resolvedPath: string;
  hidden?: boolean;
  sourceInfo: SourceInfo;
  handlers: Map<string, ExtensionHandler[]>;
  tools: Map<string, RegisteredTool>;
  messageRenderers: Map<string, MessageRenderer>;
  markdownTransformer?: MarkdownTransformer;
  entryRenderers?: Map<string, EntryRenderer>;
  commands: Map<string, RegisteredCommand>;
  flags: Map<string, ExtensionFlag>;
  shortcuts: Map<string, ExtensionShortcut>;
  /** 声明式 UI 贡献（contributes() 收集，v1/v2） */
  uiContributions: UiContribution[];
  /** 槽位数据提供者（contributesData() 收集；getSlotData RPC 消费） */
  slotData: Map<string, SlotDataProvider>;
  /** 系统提示词片段（registerSystemPrompt() 收集；组装系统提示词时按注册顺序并入） */
  systemPrompts: Array<string | (() => string)>;
}

/**
 * 扩展 UI 贡献（声明式；契约单一来源：./contracts/shell.ts）
 * —— v1 只描述元数据；宿主以声明式渲染器呈现。详见 desktop/docs/shell-plugin-design.md
 */
import type {
  UiContribution,
  UiContributionV1,
  UiContributionV2,
  ShellSlot,
  SlotData,
  SlotDataProvider,
} from "./contracts/shell.ts";
import { SHELL_SLOTS } from "./contracts/shell.ts";
export type { UiContribution, UiContributionV1, UiContributionV2, ShellSlot, SlotData, SlotDataProvider };
export { SHELL_SLOTS };

export interface ExtensionRuntime {
  flagValues: Map<string, boolean | string>;
  pendingProviderRegistrations: Array<{ name: string; config: ProviderConfig; extensionPath: string }>;
  pendingNativeProviderRegistrations: Array<{ provider: Provider; extensionPath: string }>;
  assertActive: () => void;
  invalidate: (message?: string) => void;
  trackEventBusSubscription: (unsubscribe: () => void) => () => void;
  registerProvider: (name: string, config: ProviderConfig, extensionPath?: string) => void;
  registerNativeProvider: (provider: Provider, extensionPath?: string) => void;
  unregisterProvider: (name: string, extensionPath?: string) => void;
  sendMessage: ExtensionAPI["sendMessage"];
  sendUserMessage: ExtensionAPI["sendUserMessage"];
  appendEntry: ExtensionAPI["appendEntry"];
  setSessionName: ExtensionAPI["setSessionName"];
  getSessionName: ExtensionAPI["getSessionName"];
  setLabel: ExtensionAPI["setLabel"];
  getActiveTools: ExtensionAPI["getActiveTools"];
  getAllTools: ExtensionAPI["getAllTools"];
  setActiveTools: ExtensionAPI["setActiveTools"];
  refreshTools: () => void;
  getCommands: ExtensionAPI["getCommands"];
  setModel: ExtensionAPI["setModel"];
  getThinkingLevel: ExtensionAPI["getThinkingLevel"];
  setThinkingLevel: ExtensionAPI["setThinkingLevel"];
}

export interface LoadExtensionsResult {
  extensions: Extension[];
  errors: Array<{ path: string; error: string }>;
  runtime: ExtensionRuntime;
}

export interface ExtensionError {
  extensionPath: string;
  event: string;
  error: string;
  stack?: string;
}

export interface ExtensionActions {
  sendMessage: ExtensionAPI["sendMessage"];
  sendUserMessage: ExtensionAPI["sendUserMessage"];
  appendEntry: ExtensionAPI["appendEntry"];
  setSessionName: ExtensionAPI["setSessionName"];
  getSessionName: ExtensionAPI["getSessionName"];
  setLabel: ExtensionAPI["setLabel"];
  getActiveTools: ExtensionAPI["getActiveTools"];
  getAllTools: ExtensionAPI["getAllTools"];
  setActiveTools: ExtensionAPI["setActiveTools"];
  refreshTools: () => void;
  getCommands: ExtensionAPI["getCommands"];
  setModel: ExtensionAPI["setModel"];
  getThinkingLevel: ExtensionAPI["getThinkingLevel"];
  setThinkingLevel: ExtensionAPI["setThinkingLevel"];
}

export type AppKeybinding = { key: string; handler: () => void };
export type ExtensionContextActions = Record<string, unknown>;
export type ExtensionCommandContextActions = Record<string, unknown>;
