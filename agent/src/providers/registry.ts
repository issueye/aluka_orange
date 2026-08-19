/**
 * 供应商统一注册表（Unified Provider Registry）
 *
 * 内置厂商目录与扩展动态注册共用同一条注册管道：
 * - 内置目录：由 catalog.generated.ts（build-provider-catalog.mjs 生成）
 *   在首次访问时引导注册（source="builtin"，重载不清理）
 * - 扩展注册：`pi.registerProvider(name, config)` 即时生效
 *   （source="extension"，可覆盖同 id 内置条目，注销/重载自动还原）
 *
 * 解析优先级（与 models.ts / models-json.ts 约定）：
 *   models.json（用户显式配置） > 注册表（扩展覆盖内置） > 内置默认链
 *
 * 本模块是进程级单例：桌面/CLI 每进程只有一个 agent 运行时。
 */

import type { Api, Model, Provider, RefreshModelsContext } from "../ai/types.ts";
import type { ProviderConfig, ProviderModelConfig } from "../extensions/types.ts";
import type { BuiltinProviderDef, BuiltinProviderView } from "./builtin.ts";
import { BUILTIN_PROVIDER_CATALOG } from "./catalog.generated.ts";

/** 统一注册表条目（内置与扩展同构） */
export interface ProviderRegistryEntry {
  id: string;
  name: string;
  description: string;
  api: Api;
  baseUrl?: string;
  /** 原样保存；解析时支持 $ENV / ${ENV} 模板，非模板则视为字面量（仅扩展使用） */
  apiKey?: string;
  headers?: Record<string, string>;
  authHeader?: boolean;
  models: Model[];
  refreshModels?(context: RefreshModelsContext): Promise<ProviderModelConfig[]>;
  /** 自定义流式实现（覆盖默认协议路由） */
  streamSimple?: ProviderConfig["streamSimple"];
  /** 依次尝试的 API Key 环境变量（内置目录声明） */
  envKeys: string[];
  docsUrl?: string;
  /** 本地/自托管端点 */
  local?: boolean;
  source: "builtin" | "extension";
  /** 注册来源扩展路径；内置条目为空串 */
  extensionPath: string;
}

const registry = new Map<string, ProviderRegistryEntry>();
/** 被扩展覆盖的内置条目，注销扩展时还原 */
const builtinBackups = new Map<string, ProviderRegistryEntry>();
let bootstrapped = false;

/** 首次访问时把内置厂商目录灌入注册表（幂等） */
function ensureBootstrapped(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  for (const def of BUILTIN_PROVIDER_CATALOG) {
    registry.set(def.id, entryFromBuiltin(def));
  }
}

function entryFromBuiltin(def: BuiltinProviderDef): ProviderRegistryEntry {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    api: def.api,
    baseUrl: def.baseUrl,
    models: def.models,
    envKeys: def.envKeys,
    docsUrl: def.docsUrl,
    ...(def.local ? { local: true } : {}),
    source: "builtin",
    extensionPath: "",
  };
}

/** 归一化 ProviderModelConfig → 完整 Model（补 provider/api/baseUrl） */
function normalizeModel(
  raw: ProviderModelConfig,
  providerId: string,
  defaults: { api: Api; baseUrl?: string },
): Model {
  return {
    ...raw,
    provider: providerId,
    api: raw.api ?? defaults.api,
    baseUrl: raw.baseUrl ?? defaults.baseUrl,
  };
}

function entryFromConfig(name: string, config: ProviderConfig, extensionPath: string): ProviderRegistryEntry {
  const api: Api = config.api ?? "openai-completions";
  return {
    id: name,
    name: config.name ?? name,
    description: `由扩展注册（${extensionPath || "unknown"}）`,
    api,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    headers: config.headers,
    authHeader: config.authHeader,
    models: (config.models ?? []).map((m) => normalizeModel(m, name, { api, baseUrl: config.baseUrl })),
    refreshModels: config.refreshModels,
    streamSimple: config.streamSimple,
    envKeys: [],
    extensionPath,
    source: "extension",
  };
}

function entryFromProvider(provider: Provider, extensionPath: string): ProviderRegistryEntry {
  const api: Api = provider.api ?? "openai-completions";
  return {
    id: provider.id,
    name: provider.name,
    description: `由扩展注册（${extensionPath || "unknown"}）`,
    api,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    headers: provider.headers,
    authHeader: provider.authHeader,
    models: (provider.models ?? []).map((m) => ({
      ...m,
      provider: provider.id,
      api: m.api ?? api,
      baseUrl: m.baseUrl ?? provider.baseUrl,
    })),
    envKeys: [],
    extensionPath,
    source: "extension",
  };
}

/** 扩展注册覆盖内置条目前备份；重载时还原被覆盖的内置条目 */
function setEntry(entry: ProviderRegistryEntry): void {
  const existing = registry.get(entry.id);
  if (existing?.source === "builtin") builtinBackups.set(entry.id, existing);
  registry.set(entry.id, entry);
}

/**
 * 应用一次扩展加载收集到的注册。
 * 先还原/移除上一批扩展条目，保证扩展重载后旧注册不残留。
 */
export function applyRuntimeProviderRegistrations(pending: {
  configs: Array<{ name: string; config: ProviderConfig; extensionPath: string }>;
  natives: Array<{ provider: Provider; extensionPath: string }>;
}): void {
  ensureBootstrapped();
  for (const [id, entry] of registry) {
    if (entry.source !== "extension") continue;
    const backup = builtinBackups.get(id);
    if (backup) {
      registry.set(id, backup);
      builtinBackups.delete(id);
    } else {
      registry.delete(id);
    }
  }
  for (const { name, config, extensionPath } of pending.configs) {
    setEntry(entryFromConfig(name, config, extensionPath));
  }
  for (const { provider, extensionPath } of pending.natives) {
    setEntry(entryFromProvider(provider, extensionPath));
  }
}

/** 注销扩展注册的供应商；若覆盖了内置条目则还原内置 */
export function unregisterProviderEntry(id: string): void {
  const key = id.trim();
  const backup = builtinBackups.get(key);
  if (backup) {
    registry.set(key, backup);
    builtinBackups.delete(key);
    return;
  }
  const existing = registry.get(key);
  if (existing?.source === "extension") registry.delete(key);
}

export function findProviderEntry(id: string): ProviderRegistryEntry | undefined {
  ensureBootstrapped();
  const key = id.trim().toLowerCase();
  for (const entry of registry.values()) {
    if (entry.id.toLowerCase() === key) return entry;
  }
  return undefined;
}

/** 查注册表模型；provider 缺省时跨厂商唯一命中，多命中视为歧义 */
export function findProviderModel(
  provider: string | undefined,
  modelId: string | undefined,
): Model | undefined {
  ensureBootstrapped();
  const id = modelId?.trim();
  if (!id) return undefined;
  if (provider?.trim()) {
    return findProviderEntry(provider)?.models.find((m) => m.id === id);
  }
  const hits = [...registry.values()]
    .map((entry) => entry.models.find((m) => m.id === id))
    .filter((m): m is Model => Boolean(m));
  return hits.length === 1 ? hits[0] : undefined;
}

/** 解析扩展密钥模板：$ENV / ${ENV} → 环境变量；非模板按字面量返回 */
export function resolveProviderApiKey(provider: string): string | undefined {
  const entry = findProviderEntry(provider);
  if (!entry?.apiKey) return undefined;
  const raw = entry.apiKey.trim();
  const template = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(raw);
  if (template) {
    const value = process.env[template[1]!];
    return value?.trim() || undefined;
  }
  return raw || undefined;
}

/** 厂商声明的环境变量名列表（内置目录携带，扩展通常为空） */
export function providerEnvKeys(provider: string): string[] {
  return findProviderEntry(provider)?.envKeys ?? [];
}

/**
 * 调用 refreshModels 动态发现模型，成功后替换该条目的模型目录。
 */
export async function refreshProviderModels(
  provider: string,
  context?: RefreshModelsContext,
): Promise<Model[]> {
  const entry = findProviderEntry(provider);
  if (!entry) throw new Error(`供应商 ${provider} 未注册`);
  if (!entry.refreshModels) throw new Error(`供应商 ${provider} 不支持动态刷新模型`);
  const discovered = await entry.refreshModels(context ?? {});
  const models = (discovered ?? []).map((m) => normalizeModel(m, entry.id, { api: entry.api, baseUrl: entry.baseUrl }));
  registry.set(entry.id, { ...entry, models });
  return models;
}

/** UI 投影：全部注册供应商（内置 + 扩展，不含密钥） */
export function listProviderViews(): BuiltinProviderView[] {
  ensureBootstrapped();
  return [...registry.values()].map((entry) => ({
    id: entry.id,
    name: entry.name,
    description: entry.description,
    api: entry.api,
    baseUrl: entry.baseUrl,
    envKeys: entry.envKeys,
    docsUrl: entry.docsUrl,
    ...(entry.local ? { local: true } : {}),
    models: entry.models.map((m) => ({
      id: m.id,
      name: m.name,
      api: m.api,
      reasoning: m.reasoning,
      input: m.input,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
    })),
    source: entry.source,
    ...(entry.source === "extension" ? { refreshable: Boolean(entry.refreshModels), extensionPath: entry.extensionPath } : {}),
  }));
}

/** 清空注册表（测试用；下次访问会重新引导内置目录） */
export function clearProviderRegistry(): void {
  registry.clear();
  builtinBackups.clear();
  bootstrapped = false;
}
