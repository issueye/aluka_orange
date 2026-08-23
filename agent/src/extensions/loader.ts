/**
 * 扩展加载器模块
 *
 * 负责扩展的发现、加载和初始化：
 * 1. 从预设目录和设置文件中发现扩展路径
 * 2. 使用 jiti（TypeScript 运行时加载器）加载扩展模块
 * 3. 创建扩展 API 实例并调用扩展的工厂函数
 * 4. 管理扩展运行时状态和事件总线
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import * as nodeModule from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti, type TransformOptions, type TransformResult } from "jiti";
import { getAgentDir } from "../config.ts";
import { createSyntheticSourceInfo } from "../source-info.ts";
import { createEventBus } from "./event-bus.ts";
import { discoverPackageExtensionPaths } from "./package-paths.ts";
import { execCommand } from "./ui.ts";
import * as piCompat from "./pi-compat.ts";
import * as piAi from "../ai/index.ts";
import * as piAgent from "../agent/index.ts";
import * as piTui from "../tui/index.ts";
import * as typebox from "typebox";
import * as typeboxValue from "typebox/value";
import type {
  Extension,
  ExtensionAPI,
  ExtensionFactory,
  ExtensionRuntime,
  LoadExtensionsResult,
  ProviderConfig,
  RegisteredCommand,
  ToolDefinition,
  UiContribution,
} from "./types.ts";
import type { Model, Provider, ThinkingLevel } from "../ai/types.ts";
import { applyRuntimeProviderRegistrations, unregisterProviderEntry } from "../providers/registry.ts";

const require = createRequire(import.meta.url);

/**
 * 创建扩展运行时实例
 *
 * 运行时管理扩展的全局状态，包括：
 * - 标志值存储
 * - 待注册的提供商列表
 * - 事件总线订阅跟踪
 * - 活跃状态断言
 *
 * 注意：运行时的方法在扩展加载期间不可用（调用会抛出错误），
 * 只有在 bind() 之后才可用。
 */
export function createExtensionRuntime(): ExtensionRuntime {
  /** 运行时未初始化时的错误提示 */
  const notInitialized = () => {
    throw new Error("Extension runtime not initialized. Action methods cannot be called during extension loading.");
  };
  let staleMessage: string | undefined;
  /** 跟踪事件总线订阅，便于清理 */
  const eventBusUnsubscribers = new Set<() => void>();
  const runtime: ExtensionRuntime = {
    /** 标志值存储 */
    flagValues: new Map(),
    /** 待注册的提供商配置 */
    pendingProviderRegistrations: [],
    /** 待注册的原生提供商 */
    pendingNativeProviderRegistrations: [],
    /** 断言运行时仍然活跃（未被替换） */
    assertActive() {
      if (staleMessage) throw new Error(staleMessage);
    },
    /** 标记运行时为过期状态，并清理所有事件总线订阅 */
    invalidate(message) {
      staleMessage = message ?? "Extension runtime was replaced";
      for (const unsubscribe of eventBusUnsubscribers) unsubscribe();
      eventBusUnsubscribers.clear();
    },
    /** 跟踪事件总线订阅，返回取消跟踪的函数 */
    trackEventBusSubscription(unsubscribe) {
      eventBusUnsubscribers.add(unsubscribe);
      return () => {
        eventBusUnsubscribers.delete(unsubscribe);
        unsubscribe();
      };
    },
    /** 注册提供商配置；初始加载期排队，加载后调用立即生效 */
    registerProvider(name, config, extensionPath = "") {
      runtime.pendingProviderRegistrations.push({ name, config, extensionPath });
      applyRuntimeProviderRegistrations({
        configs: runtime.pendingProviderRegistrations,
        natives: runtime.pendingNativeProviderRegistrations,
      });
    },
    /** 注册原生提供商实例 */
    registerNativeProvider(provider, extensionPath = "") {
      runtime.pendingNativeProviderRegistrations.push({ provider, extensionPath });
      applyRuntimeProviderRegistrations({
        configs: runtime.pendingProviderRegistrations,
        natives: runtime.pendingNativeProviderRegistrations,
      });
    },
    /** 取消注册提供商（含已应用的动态注册表条目） */
    unregisterProvider(name) {
      runtime.pendingProviderRegistrations = runtime.pendingProviderRegistrations.filter((item) => item.name !== name);
      unregisterProviderEntry(name);
    },
    // 以下方法在扩展加载期间为占位函数，bind() 后会被替换为实际实现
    sendMessage: notInitialized,
    sendUserMessage: notInitialized,
    appendEntry: notInitialized,
    setSessionName: notInitialized,
    getSessionName: notInitialized,
    setLabel: notInitialized,
    getActiveTools: notInitialized,
    getAllTools: notInitialized,
    setActiveTools: notInitialized,
    refreshTools() {},
    getCommands: notInitialized,
    setModel: () => Promise.reject(new Error("Extension runtime not initialized")),
    getThinkingLevel: notInitialized,
    setThinkingLevel: notInitialized,
  };
  return runtime;
}

/**
 * 发现扩展文件路径
 *
 * 按优先级从以下位置搜索扩展：
 * 1. {home}/.aluka/agent/extensions/
 * 2. {cwd}/.aluka/extensions/
 * 3. 设置文件中的 extensions / extraExtensions 路径
 * 4. 设置文件中的 packages（npm: / git:）
 * 5. 命令行参数指定的额外路径
 *
 * 不再扫描 .pi 目录（~/.pi/agent 与 {cwd}/.pi），保持 Aluka 独立。
 */
export function discoverExtensionPaths(cwd: string, extra: string[] = []): string[] {
  const fromSettings = readSettingsExtensionPaths(cwd);
  const fromPackages = discoverPackageExtensionPaths({ cwd });
  const dirs = [
    path.join(getAgentDir(), "extensions"),
    path.join(cwd, ".aluka", "extensions"),
    ...fromSettings,
    ...extra,
  ];
  const files: string[] = [];
  for (const dir of dirs) {
    files.push(...collectExtensionFiles(dir));
  }
  files.push(...fromPackages);
  // 去重（Windows 路径大小写不敏感）
  const seen = new Set<string>();
  const out: string[] = [];
  for (const file of files) {
    const key = path.resolve(file).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(file);
  }
  return out;
}

/**
 * 从设置文件中读取扩展路径
 *
 * 检查以下位置的 settings.json 文件：
 * - {home}/.aluka/agent/settings.json
 * - {cwd}/.aluka/settings.json
 */
function readSettingsExtensionPaths(cwd: string): string[] {
  const files = [
    path.join(getAgentDir(), "settings.json"),
    path.join(cwd, ".aluka", "settings.json"),
  ];
  const extra: string[] = [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    try {
      const json = JSON.parse(fs.readFileSync(file, "utf8")) as {
        extensions?: string[];
        extraExtensions?: string[];
      };
      const items = [...(json.extensions ?? []), ...(json.extraExtensions ?? [])];
      for (const item of items) {
        // 相对路径相对于配置文件所在目录解析
        extra.push(path.isAbsolute(item) ? item : path.resolve(path.dirname(file), item));
      }
    } catch {
      // 忽略格式错误的设置文件
    }
  }
  return extra;
}

/**
 * 收集目标路径下的扩展文件
 *
 * - 如果是文件：检查是否为扩展文件（.ts/.js/.mts/.mjs 等）
 * - 如果是目录：查找 index.ts 或 index.js 作为入口
 */
function collectExtensionFiles(target: string): string[] {
  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) return [];
  const stat = fs.statSync(resolved);
  if (stat.isFile()) {
    return isExtensionFile(resolved) ? [resolved] : [];
  }
  const entries = fs.readdirSync(resolved, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(resolved, entry.name);
    if (entry.isFile() && isExtensionFile(full)) files.push(full);
    if (entry.isDirectory()) {
      const index = path.join(full, "index.ts");
      const indexJs = path.join(full, "index.js");
      if (fs.existsSync(index)) files.push(index);
      else if (fs.existsSync(indexJs)) files.push(indexJs);
    }
  }
  return files;
}

/** 判断文件是否为可识别的扩展文件 */
function isExtensionFile(file: string): boolean {
  return /\.(ts|js|mts|mjs|cts|cjs)$/.test(file) && !file.endsWith(".d.ts");
}

/**
 * 创建扩展加载用的 jiti 实例
 *
 * jiti 是一个 TypeScript 运行时加载器，支持：
 * - 直接 import .ts 文件
 * - 路径别名（将 npm 包名映射到本地模块）
 *
 * 配置了多个别名以兼容 pi-agent 的不同包名：
 * - @aluka/pi
 * - @earendil-works/pi-coding-agent
 * - @mariozechner/pi-coding-agent
 * - 以及对应的子模块 (@pi-agent-core, @pi-ai, @pi-tui)
 */
export function createExtensionLoaderJiti() {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const ext = path.extname(fileURLToPath(import.meta.url));
  const selfIndex = path.resolve(root, `../index${ext}`);
  // pi 包名走兼容 shim：getAgentDir → ~/.pi/agent
  const piCompat = path.resolve(root, `./pi-compat${ext}`);
  const aliases: Record<string, string> = {
    "@aluka/pi": selfIndex,
    "@earendil-works/pi-coding-agent": piCompat,
    "@mariozechner/pi-coding-agent": piCompat,
    "@earendil-works/pi-agent-core": path.resolve(root, `../agent/index${ext}`),
    "@mariozechner/pi-agent-core": path.resolve(root, `../agent/index${ext}`),
    "@earendil-works/pi-ai": path.resolve(root, `../ai/index${ext}`),
    "@earendil-works/pi-ai/compat": path.resolve(root, `../ai/index${ext}`),
    "@mariozechner/pi-ai": path.resolve(root, `../ai/index${ext}`),
    "@mariozechner/pi-ai/compat": path.resolve(root, `../ai/index${ext}`),
    "@earendil-works/pi-tui": path.resolve(root, `../tui/index${ext}`),
    "@mariozechner/pi-tui": path.resolve(root, `../tui/index${ext}`),
  };
  try {
    // 不要把 typebox 指到 index.mjs 文件本身，否则 typebox/value 会变成 index.mjs/value。
    aliases["typebox"] = require.resolve("typebox");
    aliases["typebox/value"] = require.resolve("typebox/value");
    aliases["typebox/compile"] = require.resolve("typebox/compile");
    aliases["typebox/error"] = require.resolve("typebox/error");
    aliases["typebox/type"] = require.resolve("typebox/type");
    aliases["@sinclair/typebox"] = aliases["typebox"];
    aliases["@sinclair/typebox/value"] = aliases["typebox/value"];
  } catch {
    // typebox 是运行时依赖，测试中可能在稍后解析
  }
  // 注意：在 Aluka 下 createJiti(id) 的 id 若落在将被 jiti 变换的源码文件
  // （如本 loader.ts / src/index.ts），变换 agent/loop.ts 会报
  // ParseError: Unexpected token（表现为扩展里 migrateConfig 等 named export 为 undefined）。
  // 使用包根 package.json 作为 jiti 根，Node 与 Aluka 均正常。
  const jitiRoot = path.resolve(root, "../../package.json");
  return createJiti(jitiRoot, {
    interopDefault: true,
    alias: aliases,
    // Aluka 自身能加载 .ts，jiti 的 tryNative 会混用两套编译器，named export 经常是 undefined。
    tryNative: false,
    fsCache: false,
    // 禁止 `babel(...args)` 展开：Aluka 会把 options 对象拆成位置参数，filename（E:\...）被当成源码。
    transform: createJitiBabelTransform(),
  });
}

function createJitiBabelTransform(): (opts: TransformOptions) => TransformResult {
  let babelPath = "";
  try {
    babelPath = path.join(path.dirname(require.resolve("jiti/package.json")), "dist", "babel.cjs");
  } catch {
    babelPath = path.join(path.dirname(require.resolve("jiti")), "../dist/babel.cjs");
  }
  const babel = require(babelPath) as (opts: Record<string, unknown>) => { code: string; error?: unknown };
  return (opts) => {
    const filename = opts.filename ?? "";
    const ts = opts.ts ?? /\.([cm]?ts|tsx)$/.test(filename);
    return babel({
      source: opts.source,
      filename,
      ts,
      jsx: opts.jsx,
      interopDefault: opts.interopDefault ?? true,
    });
  };
}

function isAlukaRuntime(): boolean {
  const versions = (process as { versions?: { aluka?: string } }).versions;
  return Boolean(versions?.aluka);
}

/** Aluka 原生加载 .ts；把 pi 包名挂成虚拟模块，避免走 jiti/babel（Aluka 下会丢 import）。 */
function registerAlukaPiVirtualModules(): void {
  const register =
    (nodeModule as { registerVirtualModule?: (name: string, value: unknown) => void }).registerVirtualModule ??
    (nodeModule as { default?: { registerVirtualModule?: (name: string, value: unknown) => void } }).default
      ?.registerVirtualModule;
  if (typeof register !== "function") return;

  const entries: Array<[string, unknown]> = [
    ["@aluka/pi", piCompat],
    ["@earendil-works/pi-coding-agent", piCompat],
    ["@mariozechner/pi-coding-agent", piCompat],
    ["@earendil-works/pi-ai", piAi],
    ["@earendil-works/pi-ai/compat", piAi],
    ["@mariozechner/pi-ai", piAi],
    ["@mariozechner/pi-ai/compat", piAi],
    ["@earendil-works/pi-agent-core", piAgent],
    ["@mariozechner/pi-agent-core", piAgent],
    ["@earendil-works/pi-tui", piTui],
    ["@mariozechner/pi-tui", piTui],
    ["typebox", typebox],
    ["typebox/value", typeboxValue],
  ];
  for (const [name, value] of entries) {
    register(name, value);
  }
}

/**
 * 加载所有扩展
 *
 * 流程：
 * 1. 发现所有扩展文件路径
 * 2. 使用 jiti 逐个加载模块
 * 3. 调用模块导出的工厂函数，传入扩展 API
 * 4. 收集加载错误
 *
 * @returns 加载结果：扩展列表、错误列表和运行时实例
 */
export async function loadExtensions(options: {
  cwd: string;
  extraPaths?: string[];
  runtime?: ExtensionRuntime;
  events?: ReturnType<typeof createEventBus>;
}): Promise<LoadExtensionsResult> {
  const runtime = options.runtime ?? createExtensionRuntime();
  const events = options.events ?? createEventBus();
  const paths = discoverExtensionPaths(options.cwd, options.extraPaths);
  const native = isAlukaRuntime();
  const extensions: Extension[] = [];
  const errors: Array<{ path: string; error: string }> = [];
  if (native) {
    try {
      registerAlukaPiVirtualModules();
    } catch (error) {
      errors.push({
        path: "aluka:virtual-modules",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  // 打包 exe 没有 node_modules/jiti；Aluka 用原生 import() 加载 .ts。
  const jiti = native ? undefined : createExtensionLoaderJiti();

  for (const file of paths) {
    try {
      const loaded = native
        ? await import(pathToFileURL(path.resolve(file)).href) as { default?: ExtensionFactory } | ExtensionFactory
        : await jiti!.import(file) as { default?: ExtensionFactory } | ExtensionFactory;
      const factory = typeof loaded === "function" ? loaded : loaded.default;
      if (typeof factory !== "function") {
        throw new Error("Extension must export a default function (pi: ExtensionAPI) => void");
      }
      // 创建扩展容器并初始化 API
      const extension = createEmptyExtension(file);
      const api = createExtensionAPI(extension, runtime, events);
      await factory(api);
      extensions.push(extension);
    } catch (error) {
      errors.push({
        path: file,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // 扩展工厂执行完毕：把收集到的供应商注册应用到动态注册表
  // （先清空上一批扩展条目，支持扩展重载 / cwd 切换后旧注册不残留）
  applyRuntimeProviderRegistrations({
    configs: runtime.pendingProviderRegistrations,
    natives: runtime.pendingNativeProviderRegistrations,
  });

  return { extensions, errors, runtime };
}

/**
 * 创建空的扩展容器对象
 * 扩展加载前的占位结构
 */
function createEmptyExtension(file: string): Extension {
  return {
    path: file,
    resolvedPath: path.resolve(file),
    sourceInfo: createSyntheticSourceInfo(file, "extension"),
    handlers: new Map(),
    tools: new Map(),
    messageRenderers: new Map(),
    entryRenderers: new Map(),
    commands: new Map(),
    flags: new Map(),
    shortcuts: new Map(),
    uiContributions: [],
  };
}

/**
 * 创建扩展 API 实例
 *
 * 为每个扩展模块创建独立的 API 实例，提供：
 * - 事件监听（on）
 * - 工具注册（registerTool）
 * - 命令注册（registerCommand）
 * - 快捷键注册（registerShortcut）
 * - 标志注册（registerFlag）
 * - 消息发送（sendMessage）
 * - 提供商注册（registerProvider）
 * - 扩展间通信（events 总线）
 */
function createExtensionAPI(
  extension: Extension,
  runtime: ExtensionRuntime,
  events: ReturnType<typeof createEventBus>,
): ExtensionAPI {
  const api = {
    /** 注册事件处理器 */
    on(event: string, handler: (...args: unknown[]) => unknown) {
      const list = extension.handlers.get(event) ?? [];
      list.push(handler as never);
      extension.handlers.set(event, list);
    },
    /** 注册自定义工具 */
    registerTool(tool: ToolDefinition) {
      extension.tools.set(tool.name, { definition: tool, sourceInfo: extension.sourceInfo });
      runtime.refreshTools();
    },
    /** 注册斜杠命令 */
    registerCommand(name: string, options: Omit<RegisteredCommand, "name" | "sourceInfo">) {
      extension.commands.set(name, { ...options, name, sourceInfo: extension.sourceInfo });
    },
    /** 声明式 UI 贡献（v1）：校验不通过的整条拒绝并告警，不影响扩展其余注册 */
    contributes(ui: UiContribution) {
      const problems: string[] = [];
      if (!ui || typeof ui !== "object") {
        problems.push("参数须为对象");
      } else {
        if (typeof ui.id !== "string" || !ui.id.trim()) problems.push("缺少 id");
        if (typeof ui.title !== "string" || !ui.title.trim()) problems.push("缺少 title");
        if (ui.version !== 1) problems.push(`不支持的 version：${String(ui.version)}（当前支持 1）`);
        if (extension.uiContributions.some((item) => item.id === ui.id)) problems.push(`id 重复：${ui.id}`);
      }
      if (problems.length) {
        console.warn(`[extension] ${extension.path} contributes 被拒绝：${problems.join("；")}`);
        return;
      }
      extension.uiContributions.push(ui);
    },
    /** 注册键盘快捷键 */
    registerShortcut(shortcut: string, options: { description?: string; handler: never }) {
      extension.shortcuts.set(shortcut, { shortcut, ...options, extensionPath: extension.path });
    },
    /** 注册标志（布尔/字符串配置项） */
    registerFlag(name: string, options: { description?: string; type: "boolean" | "string"; default?: boolean | string }) {
      extension.flags.set(name, { name, ...options, extensionPath: extension.path });
      if (options.default !== undefined && !runtime.flagValues.has(name)) {
        runtime.flagValues.set(name, options.default);
      }
    },
    /** 获取标志值 */
    getFlag(name: string) {
      return runtime.flagValues.get(name);
    },
    /** 注册自定义消息渲染器 */
    registerMessageRenderer(customType: string, renderer: never) {
      extension.messageRenderers.set(customType, renderer);
    },
    /** 注册 Markdown 转换器 */
    registerMarkdownTransformer(transformer: never) {
      extension.markdownTransformer = transformer;
    },
    /** 注册条目渲染器 */
    registerEntryRenderer(customType: string, renderer: never) {
      extension.entryRenderers?.set(customType, renderer);
    },
    // 委托给运行时的方法
    sendMessage: (...args: Parameters<ExtensionAPI["sendMessage"]>) => runtime.sendMessage(...args),
    sendUserMessage: (...args: Parameters<ExtensionAPI["sendUserMessage"]>) => runtime.sendUserMessage(...args),
    appendEntry: (...args: Parameters<ExtensionAPI["appendEntry"]>) => runtime.appendEntry(...args),
    setSessionName: (name: string) => runtime.setSessionName(name),
    getSessionName: () => runtime.getSessionName(),
    setLabel: (entryId: string, label: string | undefined) => runtime.setLabel(entryId, label),
    /** 执行外部命令 */
    exec: (command: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }) =>
      execCommand(command, args, options),
    getActiveTools: () => runtime.getActiveTools(),
    getAllTools: () => runtime.getAllTools(),
    setActiveTools: (names: string[]) => runtime.setActiveTools(names),
    getCommands: () => runtime.getCommands(),
    setModel: (model: Model) => runtime.setModel(model),
    getThinkingLevel: () => runtime.getThinkingLevel(),
    setThinkingLevel: (level: ThinkingLevel) => runtime.setThinkingLevel(level),
    /** 注册 LLM 提供商（支持名称+配置或原生 Provider 对象） */
    registerProvider: ((nameOrProvider: string | Provider, config?: ProviderConfig) => {
      if (typeof nameOrProvider === "string") {
        runtime.registerProvider(nameOrProvider, config ?? {}, extension.path);
      } else {
        runtime.registerNativeProvider(nameOrProvider, extension.path);
      }
    }) as ExtensionAPI["registerProvider"],
    unregisterProvider: (name: string) => runtime.unregisterProvider(name, extension.path),
    events,
  };
  return api as ExtensionAPI;
}
