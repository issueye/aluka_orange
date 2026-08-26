/**
 * 读写 pi/aluka 的 models.json（~/.aluka/agent/models.json）。
 * 格式对齐 pi-coding-agent docs/models.md：providers → baseUrl / api / models / apiKey。
 * 对外投影永不包含 apiKey 明文（仅 hasApiKeyField）。
 */

import fs from "node:fs";
import path from "node:path";
import { getAgentDir, getPiAgentDir } from "./config.ts";
import { coerceApi, type Api } from "./ai/types.ts";
import { providerFetch } from "./ai/provider-fetch.ts";
import { findProviderEntry, findProviderModel, resolveProviderApiKey } from "./providers/registry.ts";

const MODELS_FILE = "models.json";
const EMPTY_TEMPLATE = `{\n  "providers": {}\n}\n`;
const CUSTOM_PROVIDER_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const SUPPORTED_APIS = new Set<Api>(["openai-completions", "openai-responses", "anthropic-messages"]);
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;

export interface ModelsJsonModelView {
  id: string;
  name?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
}

export interface ModelsJsonProviderView {
  provider: string;
  baseUrl?: string;
  api?: string;
  /** HTTP/SOCKS 代理（明文；展示层可脱敏密码） */
  proxy?: string;
  /** models.json 里是否声明了 apiKey 字段（永不暴露值） */
  hasApiKeyField: boolean;
  models: ModelsJsonModelView[];
}

export interface ModelsJsonSourceView {
  path: string;
  exists: boolean;
  error?: string;
  providers: ModelsJsonProviderView[];
}

export interface ModelsJsonPreview {
  sources: ModelsJsonSourceView[];
}

export interface ModelsJsonConfigView {
  path: string;
  exists: boolean;
  error?: string;
  providers: ModelsJsonProviderView[];
}

/** Composer / Settings 用的扁平模型选项 */
export interface ModelOptionView {
  provider: string;
  id: string;
  name?: string;
  api?: string;
  baseUrl?: string;
  configured: boolean;
}

export interface UpsertCustomProviderInput {
  provider: string;
  baseUrl: string;
  api: Api;
  /** 可选：创建时同步落一个初始模型；留空则仅保存供应商（之后再补模型） */
  modelId?: string;
  modelName?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  /** 可选：写入该供应商 apiKey（留空则保留原值） */
  apiKey?: string;
  /** 可选：HTTP/SOCKS 代理；传空字符串则清除 */
  proxy?: string;
  previousProvider?: string;
  previousModelId?: string;
}

export interface AddProviderModelsInput {
  provider: string;
  models: Array<{ id: string; name?: string; reasoning?: boolean; contextWindow?: number; maxTokens?: number }>;
}

export interface RemoteModelView {
  id: string;
  name?: string;
  ownedBy?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function modelsJsonPath(agentDir: string): string {
  return path.join(agentDir, MODELS_FILE);
}

function projectModel(raw: unknown): ModelsJsonModelView | undefined {
  if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id.trim()) return undefined;
  const model: ModelsJsonModelView = { id: raw.id.trim() };
  if (typeof raw.name === "string" && raw.name.trim()) model.name = raw.name.trim();
  if (typeof raw.reasoning === "boolean") model.reasoning = raw.reasoning;
  if (typeof raw.contextWindow === "number" && Number.isFinite(raw.contextWindow)) {
    model.contextWindow = raw.contextWindow;
  }
  if (typeof raw.maxTokens === "number" && Number.isFinite(raw.maxTokens)) {
    model.maxTokens = raw.maxTokens;
  }
  return model;
}

function projectProvider(providerId: string, raw: unknown): ModelsJsonProviderView {
  const row = isRecord(raw) ? raw : {};
  const models: ModelsJsonModelView[] = [];
  for (const item of Array.isArray(row.models) ? row.models : []) {
    const model = projectModel(item);
    if (model) models.push(model);
  }
  const view: ModelsJsonProviderView = {
    provider: providerId,
    hasApiKeyField: typeof row.apiKey === "string" && row.apiKey.length > 0,
    models,
  };
  if (typeof row.baseUrl === "string" && row.baseUrl.trim()) view.baseUrl = row.baseUrl.trim();
  if (typeof row.api === "string" && row.api.trim()) view.api = row.api.trim();
  if (typeof row.proxy === "string" && row.proxy.trim()) view.proxy = row.proxy.trim();
  return view;
}

/** 同步读取单个 models.json，密钥字段只投影为 hasApiKeyField */
export function readModelsJsonFile(filePath: string): ModelsJsonSourceView {
  if (!fs.existsSync(filePath)) {
    return { path: filePath, exists: false, providers: [] };
  }
  try {
    const text = fs.readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) {
      return { path: filePath, exists: true, providers: [], error: "models.json root must be an object" };
    }
    const providersRaw = isRecord(parsed.providers) ? parsed.providers : {};
    const providers = Object.keys(providersRaw).map((id) => projectProvider(id, providersRaw[id]));
    return { path: filePath, exists: true, providers };
  } catch (error) {
    return {
      path: filePath,
      exists: true,
      providers: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function readModelsJsonConfig(agentDir: string): ModelsJsonConfigView {
  const filePath = modelsJsonPath(agentDir);
  const source = readModelsJsonFile(filePath);
  return {
    path: source.path,
    exists: source.exists,
    error: source.error,
    providers: source.providers,
  };
}

/**
 * 预览 Aluka 与 pi 两处 agent 目录下的 models.json（只读）。
 * 优先列出 ~/.aluka/agent，再 ~/.pi/agent。
 */
export function previewModelsJson(opts?: { agentDir?: string; piAgentDir?: string }): ModelsJsonPreview {
  const alukaDir = opts?.agentDir ?? getAgentDir();
  const piDir = opts?.piAgentDir ?? getPiAgentDir();
  const paths = [path.join(alukaDir, MODELS_FILE), path.join(piDir, MODELS_FILE)];
  const seen = new Set<string>();
  const sources: ModelsJsonSourceView[] = [];
  for (const file of paths) {
    const key = path.normalize(file).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(readModelsJsonFile(file));
  }
  return { sources };
}

function loadRoot(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return { providers: {} };
  const text = fs.readFileSync(filePath, "utf8");
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error("models.json root must be an object");
  return { ...parsed };
}

function asProvidersMap(root: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(root.providers)) root.providers = {};
  return root.providers as Record<string, unknown>;
}

function writeRoot(filePath: string, root: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(root, null, 2)}\n`, { mode: 0o600 });
}

export function ensureModelsJsonTemplate(agentDir: string): string {
  const filePath = modelsJsonPath(agentDir);
  fs.mkdirSync(agentDir, { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, EMPTY_TEMPLATE, { mode: 0o600 });
  }
  return filePath;
}

function positiveInt(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function buildModelEntry(input: {
  id: string;
  name?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
}): Record<string, unknown> {
  const id = input.id.trim();
  return {
    id,
    name: input.name?.trim() || id,
    reasoning: Boolean(input.reasoning),
    input: ["text", "image"],
    contextWindow: positiveInt(input.contextWindow, DEFAULT_CONTEXT_WINDOW),
    maxTokens: positiveInt(input.maxTokens, DEFAULT_MAX_TOKENS),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

export function addModelsToProviderInModelsJson(
  agentDir: string,
  input: AddProviderModelsInput,
): ModelsJsonConfigView {
  const providerId = input.provider.trim();
  if (!providerId) throw new Error("Provider id is required");
  const incoming = input.models
    .map((model) => ({ ...model, id: model.id.trim() }))
    .filter((model) => model.id);
  if (!incoming.length) throw new Error("At least one model id is required");

  const filePath = modelsJsonPath(agentDir);
  const root = loadRoot(filePath);
  const providers = asProvidersMap(root);
  const existing = providers[providerId];
  if (!isRecord(existing)) throw new Error(`Provider ${providerId} not found in models.json`);

  const modelsArr = Array.isArray(existing.models) ? [...existing.models] : [];
  const seen = new Set(
    modelsArr.filter(isRecord).map((item) => String(item.id ?? "")).filter(Boolean),
  );
  for (const model of incoming) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    modelsArr.push(buildModelEntry(model));
  }
  providers[providerId] = { ...existing, models: modelsArr };
  root.providers = providers;
  writeRoot(filePath, root);
  return readModelsJsonConfig(agentDir);
}

function removeModelFromProvidersMap(
  providers: Record<string, unknown>,
  providerId: string,
  modelId: string,
): void {
  const existing = providers[providerId];
  if (!isRecord(existing) || !Array.isArray(existing.models)) return;
  const nextModels = existing.models.filter((item) => !(isRecord(item) && item.id === modelId));
  if (nextModels.length === 0) {
    delete providers[providerId];
    return;
  }
  providers[providerId] = { ...existing, models: nextModels };
}

export function normalizeBaseUrl(raw: string, api: Api): string {
  let url = raw.trim().replace(/\/+$/, "");
  if (!url) return url;
  if (api === "anthropic-messages") {
    url = url.replace(/\/v1$/i, "");
  } else if (!/\/v1$/i.test(url) && !/\/chat\/completions$/i.test(url)) {
    if (/^https?:\/\/[^/]+$/i.test(url)) url = `${url}/v1`;
  }
  return url;
}

const PROXY_SCHEMES = new Set(["http:", "https:", "socks5:", "socks5h:", "socks4:"]);

/** 规范化供应商代理地址；空字符串表示不使用代理 */
export function normalizeProxyUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error("代理地址无效");
  }
  if (!PROXY_SCHEMES.has(parsed.protocol)) {
    throw new Error("代理仅支持 http、https、socks5");
  }
  if (!parsed.hostname) throw new Error("代理地址无效");
  let href = parsed.href;
  if (href.endsWith("/") && parsed.pathname === "/") href = href.slice(0, -1);
  return href;
}

export function upsertCustomProviderInModelsJson(
  agentDir: string,
  input: UpsertCustomProviderInput,
): ModelsJsonConfigView {
  const providerId = input.provider.trim();
  const modelId = input.modelId?.trim() ?? "";
  if (!providerId) throw new Error("Provider id is required");
  if (!CUSTOM_PROVIDER_ID_RE.test(providerId)) {
    throw new Error(
      "Provider id must start with a letter or digit and use only letters, digits, . _ -",
    );
  }
  if (!SUPPORTED_APIS.has(input.api)) {
    throw new Error(`Unsupported API type: ${input.api}`);
  }
  const baseUrl = normalizeBaseUrl(input.baseUrl, input.api);
  if (!baseUrl) throw new Error("Base URL is required");

  const filePath = modelsJsonPath(agentDir);
  fs.mkdirSync(agentDir, { recursive: true });
  const root = loadRoot(filePath);
  const providers = asProvidersMap(root);

  const previousProvider = input.previousProvider?.trim();
  const previousModelId = input.previousModelId?.trim();
  if (
    previousProvider &&
    previousModelId &&
    (previousProvider !== providerId || previousModelId !== modelId)
  ) {
    removeModelFromProvidersMap(providers, previousProvider, previousModelId);
  }

  const existing = isRecord(providers[providerId]) ? { ...providers[providerId] } : {};
  const modelsArr = Array.isArray(existing.models) ? [...existing.models] : [];
  // modelId 可空：仅更新供应商本身（baseUrl / api / 密钥 / 代理），模型列表原样保留
  let nextModels = modelsArr;
  if (modelId) {
    const modelEntry = buildModelEntry({
      id: modelId,
      name: input.modelName,
      reasoning: input.reasoning,
      contextWindow: input.contextWindow,
      maxTokens: input.maxTokens,
    });

    let replaced = false;
    nextModels = modelsArr.map((item) => {
      if (isRecord(item) && item.id === modelId) {
        replaced = true;
        return { ...item, ...modelEntry };
      }
      return item;
    });
    if (!replaced) nextModels.push(modelEntry);
  }

  const providerBlock: Record<string, unknown> = {
    ...existing,
    baseUrl,
    api: input.api,
    models: nextModels,
  };
  if (typeof input.apiKey === "string" && input.apiKey.trim()) {
    providerBlock.apiKey = input.apiKey.trim();
  }
  if (input.proxy !== undefined) {
    const proxy = normalizeProxyUrl(input.proxy);
    if (proxy) providerBlock.proxy = proxy;
    else delete providerBlock.proxy;
  }

  providers[providerId] = providerBlock;
  root.providers = providers;
  writeRoot(filePath, root);
  return readModelsJsonConfig(agentDir);
}

export function removeCustomProviderFromModelsJson(
  agentDir: string,
  provider: string,
): ModelsJsonConfigView {
  const providerId = provider.trim();
  if (!providerId) throw new Error("Provider is required");
  const filePath = modelsJsonPath(agentDir);
  if (!fs.existsSync(filePath)) {
    return { path: filePath, exists: false, providers: [] };
  }
  const root = loadRoot(filePath);
  const providers = asProvidersMap(root);
  if (providerId in providers) {
    delete providers[providerId];
    root.providers = providers;
    writeRoot(filePath, root);
  }
  return readModelsJsonConfig(agentDir);
}

export function removeCustomModelFromModelsJson(
  agentDir: string,
  provider: string,
  modelId: string,
): ModelsJsonConfigView {
  const providerId = provider.trim();
  const id = modelId.trim();
  if (!providerId || !id) throw new Error("Provider and model id are required");
  const filePath = modelsJsonPath(agentDir);
  if (!fs.existsSync(filePath)) {
    return { path: filePath, exists: false, providers: [] };
  }
  const root = loadRoot(filePath);
  const providers = asProvidersMap(root);
  removeModelFromProvidersMap(providers, providerId, id);
  root.providers = providers;
  writeRoot(filePath, root);
  return readModelsJsonConfig(agentDir);
}

export function setProviderApiKeyInModelsJson(
  agentDir: string,
  provider: string,
  apiKey: string,
): ModelsJsonConfigView {
  const providerId = provider.trim();
  const key = apiKey.trim();
  if (!providerId) throw new Error("Provider is required");
  if (!key) throw new Error("API key is required");
  const filePath = modelsJsonPath(agentDir);
  const root = loadRoot(filePath);
  const providers = asProvidersMap(root);
  const existing = providers[providerId];
  if (!isRecord(existing)) throw new Error(`Provider ${providerId} not found in models.json`);
  providers[providerId] = { ...existing, apiKey: key };
  root.providers = providers;
  writeRoot(filePath, root);
  return readModelsJsonConfig(agentDir);
}

export function clearProviderApiKeyInModelsJson(
  agentDir: string,
  provider: string,
): ModelsJsonConfigView {
  const providerId = provider.trim();
  if (!providerId) throw new Error("Provider is required");
  const filePath = modelsJsonPath(agentDir);
  if (!fs.existsSync(filePath)) {
    return { path: filePath, exists: false, providers: [] };
  }
  const root = loadRoot(filePath);
  const providers = asProvidersMap(root);
  const existing = providers[providerId];
  if (!isRecord(existing)) return readModelsJsonConfig(agentDir);
  const next = { ...existing };
  delete next.apiKey;
  providers[providerId] = next;
  root.providers = providers;
  writeRoot(filePath, root);
  return readModelsJsonConfig(agentDir);
}

/** 读取指定供应商的明文 apiKey（仅供 Host 内部 resolve，禁止回传 UI） */
export function readProviderApiKey(agentDir: string, provider: string): string | undefined {
  const filePath = modelsJsonPath(agentDir);
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const root = loadRoot(filePath);
    const providers = asProvidersMap(root);
    const row = providers[provider.trim()];
    if (!isRecord(row) || typeof row.apiKey !== "string") return undefined;
    const key = row.apiKey.trim();
    return key || undefined;
  } catch {
    return undefined;
  }
}

/** 查找供应商+模型的完整配置（含内部用字段） */
export function lookupProviderModel(
  agentDir: string,
  provider: string,
  modelId: string,
): {
  provider: string;
  id: string;
  name?: string;
  api: Api;
  baseUrl?: string;
  proxy?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  apiKey?: string;
  /** 命中自内置厂商目录（而非 models.json） */
  builtin?: true;
  /** 命中自扩展动态注册的供应商 */
  extension?: true;
} | undefined {
  const config = readModelsJsonConfig(agentDir);
  const p = config.providers.find((row) => row.provider === provider);
  const m = p?.models.find((row) => row.id === modelId);
  if (p && m) {
    const api = coerceApi(p.api);
    return {
      provider: p.provider,
      id: m.id,
      name: m.name,
      api,
      baseUrl: p.baseUrl,
      proxy: p.proxy,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      reasoning: m.reasoning,
      apiKey: readProviderApiKey(agentDir, provider),
    };
  }
  // models.json 未命中 → 统一注册表（内置目录 / 扩展注册，扩展覆盖内置）
  const registered = findProviderModel(provider, modelId);
  if (registered) {
    const isExtension = findProviderEntry(registered.provider)?.source === "extension";
    return {
      provider: registered.provider,
      id: registered.id,
      name: registered.name,
      api: registered.api,
      baseUrl: registered.baseUrl,
      proxy: undefined,
      contextWindow: registered.contextWindow,
      maxTokens: registered.maxTokens,
      reasoning: registered.reasoning,
      apiKey: resolveProviderApiKey(registered.provider),
      ...(isExtension ? { extension: true as const } : { builtin: true as const }),
    };
  }
  return undefined;
}

export function listModelOptions(agentDir: string): ModelOptionView[] {
  const config = readModelsJsonConfig(agentDir);
  const out: ModelOptionView[] = [];
  for (const p of config.providers) {
    for (const m of p.models) {
      out.push({
        provider: p.provider,
        id: m.id,
        name: m.name,
        api: p.api,
        baseUrl: p.baseUrl,
        configured: p.hasApiKeyField,
      });
    }
  }
  return out;
}

export function modelsListUrl(baseUrl: string): string {
  const base = normalizeBaseUrl(baseUrl, "openai-completions").replace(/\/+$/, "");
  if (/\/models$/i.test(base)) return base;
  return `${base}/models`;
}

export function parseOpenAiModelsList(payload: unknown): RemoteModelView[] {
  const rows: unknown[] = [];
  if (Array.isArray(payload)) {
    rows.push(...payload);
  } else if (isRecord(payload) && Array.isArray(payload.data)) {
    rows.push(...payload.data);
  } else if (isRecord(payload) && Array.isArray(payload.models)) {
    rows.push(...payload.models);
  }
  const out: RemoteModelView[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    let id = "";
    let name: string | undefined;
    let ownedBy: string | undefined;
    if (typeof row === "string") {
      id = row.trim();
    } else if (isRecord(row)) {
      id = String(row.id ?? row.name ?? "").trim();
      if (typeof row.name === "string" && row.name.trim() && row.name.trim() !== id) {
        name = row.name.trim();
      }
      if (typeof row.owned_by === "string" && row.owned_by.trim()) ownedBy = row.owned_by.trim();
    }
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const item: RemoteModelView = { id };
    if (name) item.name = name;
    if (ownedBy) item.ownedBy = ownedBy;
    out.push(item);
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

export async function fetchOpenAiModelList(opts: {
  baseUrl: string;
  apiKey?: string;
  proxy?: string;
  timeoutMs?: number;
}): Promise<RemoteModelView[]> {
  const url = modelsListUrl(opts.baseUrl);
  if (!url) throw new Error("Base URL is required");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (opts.apiKey?.trim()) headers.Authorization = `Bearer ${opts.apiKey.trim()}`;
    const response = await providerFetch(url, { method: "GET", headers, signal: controller.signal }, opts.proxy);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`GET ${url} failed: ${response.status} ${text.slice(0, 240)}`);
    }
    let payload: unknown = text;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`GET ${url} returned non-JSON`);
    }
    const models = parseOpenAiModelsList(payload);
    if (!models.length) throw new Error("模型列表为空");
    return models;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`GET ${url} timed out`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchProviderRemoteModels(
  agentDir: string,
  provider: string,
  apiKeyOverride?: string,
  proxyOverride?: string,
): Promise<{ provider: string; baseUrl: string; models: RemoteModelView[] }> {
  const providerId = provider.trim();
  if (!providerId) throw new Error("Provider is required");
  const config = readModelsJsonConfig(agentDir);
  const row = config.providers.find((item) => item.provider === providerId);
  if (!row) throw new Error(`Provider ${providerId} not found`);
  if (row.api === "anthropic-messages") {
    throw new Error("Anthropic 供应商不支持 OpenAI /models 列表接口");
  }
  if (!row.baseUrl) throw new Error("该供应商未配置 Base URL");
  const apiKey = apiKeyOverride?.trim() || readProviderApiKey(agentDir, providerId);
  const proxy = proxyOverride?.trim() || row.proxy;
  const models = await fetchOpenAiModelList({ baseUrl: row.baseUrl, apiKey, proxy });
  return { provider: providerId, baseUrl: row.baseUrl, models };
}
