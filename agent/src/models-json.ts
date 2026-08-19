/**
 * 读写 pi/aluka 的 models.json（~/.aluka/agent/models.json）。
 * 格式对齐 pi-coding-agent docs/models.md：providers → baseUrl / api / models / apiKey。
 * 对外投影永不包含 apiKey 明文（仅 hasApiKeyField）。
 */

import fs from "node:fs";
import path from "node:path";
import { getAgentDir, getPiAgentDir } from "./config.ts";
import type { Api } from "./ai/types.ts";

const MODELS_FILE = "models.json";
const EMPTY_TEMPLATE = `{\n  "providers": {}\n}\n`;
const CUSTOM_PROVIDER_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const SUPPORTED_APIS = new Set<Api>(["openai-completions", "anthropic-messages"]);
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
  modelId: string;
  modelName?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  /** 可选：写入该供应商 apiKey（留空则保留原值） */
  apiKey?: string;
  previousProvider?: string;
  previousModelId?: string;
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

function normalizeBaseUrl(raw: string, api: Api): string {
  let url = raw.trim().replace(/\/+$/, "");
  if (!url) return url;
  if (api === "anthropic-messages") {
    url = url.replace(/\/v1$/i, "");
  } else if (!/\/v1$/i.test(url) && !/\/chat\/completions$/i.test(url)) {
    if (/^https?:\/\/[^/]+$/i.test(url)) url = `${url}/v1`;
  }
  return url;
}

export function upsertCustomProviderInModelsJson(
  agentDir: string,
  input: UpsertCustomProviderInput,
): ModelsJsonConfigView {
  const providerId = input.provider.trim();
  const modelId = input.modelId.trim();
  if (!providerId) throw new Error("Provider id is required");
  if (!modelId) throw new Error("Model id is required");
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
  const modelEntry: Record<string, unknown> = {
    id: modelId,
    name: input.modelName?.trim() || modelId,
    reasoning: Boolean(input.reasoning),
    input: ["text", "image"],
    contextWindow: positiveInt(input.contextWindow, DEFAULT_CONTEXT_WINDOW),
    maxTokens: positiveInt(input.maxTokens, DEFAULT_MAX_TOKENS),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };

  let replaced = false;
  const nextModels = modelsArr.map((item) => {
    if (isRecord(item) && item.id === modelId) {
      replaced = true;
      return { ...item, ...modelEntry };
    }
    return item;
  });
  if (!replaced) nextModels.push(modelEntry);

  const providerBlock: Record<string, unknown> = {
    ...existing,
    baseUrl,
    api: input.api,
    models: nextModels,
  };
  if (typeof input.apiKey === "string" && input.apiKey.trim()) {
    providerBlock.apiKey = input.apiKey.trim();
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
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  apiKey?: string;
} | undefined {
  const config = readModelsJsonConfig(agentDir);
  const p = config.providers.find((row) => row.provider === provider);
  if (!p) return undefined;
  const m = p.models.find((row) => row.id === modelId);
  if (!m) return undefined;
  const api: Api =
    p.api === "anthropic-messages" ? "anthropic-messages" : "openai-completions";
  return {
    provider: p.provider,
    id: m.id,
    name: m.name,
    api,
    baseUrl: p.baseUrl,
    contextWindow: m.contextWindow,
    maxTokens: m.maxTokens,
    reasoning: m.reasoning,
    apiKey: readProviderApiKey(agentDir, provider),
  };
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
