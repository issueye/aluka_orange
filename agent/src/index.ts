/**
 * 模块导出入口
 *
 * 统一导出所有公共 API，外部消费者通过此文件引入 aluka 的功能。
 * 包含配置、Agent 循环、AI 类型、扩展系统、会话管理、工具定义等。
 */

// 配置相关导出
export { VERSION, parseArgs, HELP, getAgentDir, getPiAgentDir } from "./config.ts";

// Agent 核心循环
export { runAgentLoop } from "./agent/loop.ts";

// Agent 消息和工具类型
export {
  convertToLlm,
  type AgentMessage,
  type AgentTool,
  type AgentToolResult,
  type AgentToolUpdateCallback,
  type CustomMessage,
} from "./agent/types.ts";

// AI 提供商相关类型
export {
  StringEnum,
  type Model,
  type TextContent,
  type ImageContent,
  type Usage,
  type ThinkingLevel,
} from "./ai/types.ts";

// 流式模型调用
export { streamModel } from "./ai/stream.ts";

// 扩展系统：工具定义、类型守卫、加载器等
export {
  defineTool,
  isBashToolResult,
  isEditToolResult,
  isFindToolResult,
  isGrepToolResult,
  isLsToolResult,
  isReadToolResult,
  isToolCallEventType,
  isWriteToolResult,
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionCommandContext,
  type ExtensionFactory,
  type ToolDefinition,
  type ToolCallEvent,
  type ToolResultEvent,
  type LoadExtensionsResult,
} from "./extensions/index.ts";

// 扩展运行时和发现
export { createExtensionRuntime, discoverExtensionPaths, loadExtensions } from "./extensions/loader.ts";
export { ExtensionRunner } from "./extensions/runner.ts";

// 事件总线
export { createEventBus } from "./extensions/event-bus.ts";

// 会话管理
export {
  SessionManager,
  CURRENT_SESSION_VERSION,
  buildSessionContext,
  type SessionSummary,
  type SessionEntry,
  type SessionHeader,
  type SessionContext,
} from "./session/manager.ts";

// 桌面 Host API（Aluka Desktop）
export {
  createDesktopRuntime,
  loadSettings,
  saveSettings,
  settingsView,
  type CreateDesktopRuntimeOptions,
  type DesktopEventSink,
  type DesktopRuntime,
  type DesktopRuntimeEvent,
  type DesktopSettings,
  type ExtensionInventory,
  type ExtensionUiRequest,
  type ExtensionUiResponse,
  type ThemeId,
  type TimelineItem,
} from "./desktop/index.ts";

// 内置工具（文件读写、编辑、搜索、Shell 执行、网页抓取等）
export { builtinTools, readTool, writeTool, editTool, bashTool, grepTool, findTool, lsTool, webFetchTool } from "./tools/index.ts";

// 技能系统（从 Markdown 文件加载提示词技能）
export { loadSkills, formatSkillsForPrompt } from "./skills/index.ts";

// 系统提示词构建
export { buildSystemPrompt } from "./system-prompt.ts";

// 默认模型 / 运行时供应商解析
export {
  defaultModel,
  PROVIDER_PRESETS,
  inferProviderPreset,
  apiForProvider,
  resolveApiKey,
  resolveRuntimeModel,
  resolveRuntimeApiKey,
  hasRuntimeApiKey,
} from "./models.ts";

// models.json 读写（供应商管理）
export {
  previewModelsJson,
  readModelsJsonConfig,
  upsertCustomProviderInModelsJson,
  addModelsToProviderInModelsJson,
  removeCustomProviderFromModelsJson,
  removeCustomModelFromModelsJson,
  setProviderApiKeyInModelsJson,
  clearProviderApiKeyInModelsJson,
  listModelOptions,
  lookupProviderModel,
  fetchOpenAiModelList,
  parseOpenAiModelsList,
  type ModelsJsonPreview,
  type ModelsJsonConfigView,
  type ModelOptionView,
  type UpsertCustomProviderInput,
  type AddProviderModelsInput,
  type RemoteModelView,
} from "./models-json.ts";

// 自定义编辑器组件
export { CustomEditor } from "./custom-editor.ts";

// 来源信息（标识内容来自内置、扩展还是内联）
export { createSyntheticSourceInfo } from "./source-info.ts";
