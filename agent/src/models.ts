/**
 * 模型配置模块
 *
 * - 默认模型 / 预设
 * - 运行时解析：settings.json + models.json + 环境变量
 *   优先级（模型）：显式参数 > settings > models.json 默认条目 > 环境变量 > 内置默认
 *   优先级（密钥）：显式 apiKey > settings.apiKey > models.json 供应商 apiKey > 环境变量
 */

import type { Api, Model } from "./ai/types.ts";
import { getAgentDir } from "./config.ts";
import {
  listModelOptions,
  lookupProviderModel,
  readModelsJsonConfig,
  readProviderApiKey,
} from "./models-json.ts";

export type ProviderPresetId = "openai" | "anthropic" | "openai-compatible";

export interface ProviderPreset {
  id: ProviderPresetId;
  label: string;
  provider: string;
  defaultModel: string;
  /** 空表示使用提供商默认（官方） */
  defaultBaseUrl?: string;
  hint: string;
}

/** 桌面 Settings 用的提供商预设 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    provider: "openai",
    defaultModel: "gpt-4.1",
    hint: "官方 OpenAI API",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    provider: "anthropic",
    defaultModel: "claude-sonnet-4-20250514",
    hint: "官方 Anthropic Messages API",
  },
  {
    id: "openai-compatible",
    label: "OpenAI-compatible",
    provider: "openai",
    defaultModel: "gpt-4.1",
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
    hint: "任意兼容 /v1/chat/completions 或 /v1/responses 的端点（Ollama、DeepSeek、自建网关等）",
  },
];

/** 非 anthropic 一律走 openai-completions（含自定义兼容端点） */
export function apiForProvider(provider: string): Api {
  return provider === "anthropic" ? "anthropic-messages" : "openai-completions";
}

/**
 * 构建默认模型配置
 *
 * 配置优先级：参数覆盖 > 环境变量 > 默认值
 * - 提供商：ALUKA_PROVIDER 环境变量，默认 "openai"
 * - 模型 ID：按提供商选择不同的默认模型
 * - API 类型：根据提供商自动选择 (openai-completions / anthropic-messages)；OpenAI Responses 需在 models.json 显式指定
 */
export function defaultModel(overrides: Partial<Model> = {}): Model {
  const provider = (overrides.provider ?? process.env.ALUKA_PROVIDER ?? "openai") as string;
  const apiFromOverride = overrides.api;
  const api: Api = apiFromOverride ?? apiForProvider(provider);
  const id =
    overrides.id
    ?? process.env.ALUKA_MODEL
    ?? (api === "anthropic-messages" ? process.env.ANTHROPIC_MODEL : process.env.OPENAI_MODEL)
    ?? (api === "anthropic-messages" ? "claude-sonnet-4-20250514" : "gpt-4.1");
  return {
    name: overrides.name ?? id,
    baseUrl:
      overrides.baseUrl
      ?? process.env.ALUKA_BASE_URL
      ?? (api === "anthropic-messages" ? process.env.ANTHROPIC_BASE_URL : process.env.OPENAI_BASE_URL),
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
    ...overrides,
    id,
    provider,
    api,
  };
}

/**
 * 根据模型的 API 类型解析对应的 API Key（仅环境变量）
 * - Anthropic: 优先 ANTHROPIC_API_KEY，其次 ALUKA_API_KEY
 * - OpenAI / compatible: 优先 ALUKA_API_KEY，其次 OPENAI_API_KEY
 */
export function resolveApiKey(model: Model): string | undefined {
  if (model.api === "anthropic-messages") {
    return process.env.ANTHROPIC_API_KEY ?? process.env.ALUKA_API_KEY;
  }
  return process.env.ALUKA_API_KEY ?? process.env.OPENAI_API_KEY;
}

/** 根据当前 settings 推断预设（用于 UI 回显） */
export function inferProviderPreset(provider?: string, baseUrl?: string): ProviderPresetId {
  if (provider === "anthropic") return "anthropic";
  if (baseUrl && baseUrl.trim()) return "openai-compatible";
  return "openai";
}

export type ResolveRuntimeModelOptions = {
  agentDir?: string;
  /** 显式指定；覆盖 settings / models.json */
  provider?: string;
  model?: string;
  baseUrl?: string;
  /** settings.json 中的字段（可由调用方传入已加载结果） */
  settings?: {
    provider?: string;
    model?: string;
    baseUrl?: string;
  };
};

export type ResolveRuntimeApiKeyOptions = {
  agentDir?: string;
  model: Model;
  /** 显式密钥（settings / CLI） */
  apiKey?: string;
};

export type RuntimeModelResolution = {
  model: Model;
  /** 解析来源，便于日志 / 调试 */
  source: "explicit" | "settings+models.json" | "models.json" | "settings" | "env-default";
};

/**
 * 从 models.json 中挑模型：
 * - provider+model 都给了 → 精确查找（找不到返回 undefined）
 * - 只给 provider → 该供应商第一个模型
 * - 只给 model → 任一供应商中同 id
 * - 都没给 → 全局第一个
 */
function pickFromModelsJson(
  agentDir: string,
  provider?: string,
  modelId?: string,
): ReturnType<typeof lookupProviderModel> {
  if (provider && modelId) {
    return lookupProviderModel(agentDir, provider, modelId);
  }
  const config = readModelsJsonConfig(agentDir);
  if (provider) {
    const p = config.providers.find((row) => row.provider === provider);
    const first = p?.models[0];
    if (p && first) return lookupProviderModel(agentDir, p.provider, first.id);
    return undefined;
  }
  if (modelId) {
    for (const p of config.providers) {
      if (p.models.some((m) => m.id === modelId)) {
        return lookupProviderModel(agentDir, p.provider, modelId);
      }
    }
    return undefined;
  }
  const options = listModelOptions(agentDir);
  const first = options[0];
  if (first) return lookupProviderModel(agentDir, first.provider, first.id);
  return undefined;
}

function modelFromLookup(
  found: NonNullable<ReturnType<typeof lookupProviderModel>>,
  baseUrlOverride?: string,
): Model {
  return defaultModel({
    id: found.id,
    name: found.name ?? found.id,
    provider: found.provider,
    api: found.api,
    baseUrl: baseUrlOverride?.trim() || found.baseUrl,
    proxy: found.proxy,
    contextWindow: found.contextWindow,
    maxTokens: found.maxTokens,
    reasoning: found.reasoning ?? false,
  });
}

/**
 * 运行时解析完整 Model（CLI / Desktop 共用）。
 *
 * 顺序：
 * 1. 显式 / settings 的 provider+model 能在 models.json 命中 → 用 models.json 条目
 * 2. 未指定时若 models.json 有条目 → 用第一项
 * 3. 否则 defaultModel（环境变量 + 内置默认），合并 baseUrl
 */
export function resolveRuntimeModel(opts: ResolveRuntimeModelOptions = {}): RuntimeModelResolution {
  const agentDir = opts.agentDir ?? getAgentDir();
  const settings = opts.settings ?? {};
  const provider = opts.provider?.trim() || settings.provider?.trim() || undefined;
  const modelId = opts.model?.trim() || settings.model?.trim() || undefined;
  const baseUrlOverride = opts.baseUrl?.trim() || settings.baseUrl?.trim() || undefined;

  const explicitProvider = Boolean(opts.provider?.trim());
  const explicitModel = Boolean(opts.model?.trim());

  if (provider || modelId) {
    const found = pickFromModelsJson(agentDir, provider, modelId);
    if (found) {
      const source =
        explicitProvider || explicitModel
          ? "explicit"
          : settings.provider || settings.model
            ? "settings+models.json"
            : "models.json";
      return {
        model: modelFromLookup(found, baseUrlOverride),
        source,
      };
    }
  }

  if (!provider && !modelId) {
    const found = pickFromModelsJson(agentDir);
    if (found) {
      return {
        model: modelFromLookup(found, baseUrlOverride),
        source: "models.json",
      };
    }
  }

  const model = defaultModel({
    provider: provider || undefined,
    id: modelId || undefined,
    baseUrl: baseUrlOverride || undefined,
  });
  const source =
    settings.provider || settings.model || settings.baseUrl ? "settings" : "env-default";
  return { model, source };
}

/**
 * 运行时解析 API Key。
 * 显式 > settings > models.json[provider].apiKey > 环境变量
 */
export function resolveRuntimeApiKey(opts: ResolveRuntimeApiKeyOptions): string | undefined {
  const agentDir = opts.agentDir ?? getAgentDir();
  if (opts.apiKey?.trim()) return opts.apiKey.trim();
  const fromModels = readProviderApiKey(agentDir, opts.model.provider);
  if (fromModels) return fromModels;
  return resolveApiKey(opts.model);
}

/** 是否已为某模型配置了可用密钥（含 models.json / env） */
export function hasRuntimeApiKey(opts: {
  agentDir?: string;
  model: Model;
  settingsApiKey?: string;
}): boolean {
  return Boolean(
    resolveRuntimeApiKey({
      agentDir: opts.agentDir,
      model: opts.model,
      apiKey: opts.settingsApiKey,
    }),
  );
}
