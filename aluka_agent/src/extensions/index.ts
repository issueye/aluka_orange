/**
 * 扩展模块入口
 *
 * 导出 pi-agent 兼容的扩展系统的所有公共 API，
 * 包括类型定义、事件总线、扩展加载器和运行器。
 */

// 类型定义和工具函数
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
  // 事件类型
  type AgentEndEvent,
  type AgentSettledEvent,
  type AgentStartEvent,
  type AgentToolResult,
  type AgentToolUpdateCallback,
  type BeforeAgentStartEvent,
  type BeforeAgentStartEventResult,
  type BeforeProviderHeadersEvent,
  type BeforeProviderRequestEvent,
  type BeforeProviderRequestEventResult,
  type ContextEvent,
  // 扩展核心类型
  type Extension,
  type ExtensionAPI,
  type ExtensionActions,
  type ExtensionCommandContext,
  type ExtensionContext,
  type ExtensionError,
  type ExtensionEvent,
  type ExtensionFactory,
  type ExtensionHandler,
  type ExtensionRuntime,
  type ExtensionShortcut,
  type ExtensionUIContext,
  type InlineExtension,
  type InputEvent,
  type InputEventResult,
  type LoadExtensionsResult,
  type ProviderConfig,
  type RegisteredCommand,
  type RegisteredTool,
  type SessionStartEvent,
  type ToolCallEvent,
  type ToolCallEventResult,
  type ToolDefinition,
  type ToolInfo,
  type ToolResultEvent,
} from "./types.ts";

// 事件总线
export { createEventBus } from "./event-bus.ts";

// 扩展加载和运行时
export { createExtensionRuntime, discoverExtensionPaths, loadExtensions } from "./loader.ts";
export { ExtensionRunner } from "./runner.ts";
export {
  discoverPackageExtensionPaths,
  resolveExtensionEntries,
  resolveExtensionEntry,
  resolvePackageRootFromSpec,
} from "./package-paths.ts";
export { createConsoleUI } from "./ui.ts";
