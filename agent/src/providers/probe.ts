/**
 * 供应商连通性探测（「测试连接」）
 *
 * 对目标端点发起一次轻量 GET models 请求：
 * - openai 系：GET {base}/models，Authorization: Bearer
 * - anthropic 系：GET {base}/v1/models，x-api-key + anthropic-version
 * 返回状态码 / 延迟 / 可见模型数，不产生 token 消耗。
 */

import { getAgentDir } from "../config.ts";
import { modelsListUrl, parseOpenAiModelsList, readProviderApiKey } from "../models-json.ts";
import { providerFetch } from "../ai/provider-fetch.ts";
import type { Api } from "../ai/types.ts";
import { findProviderEntry, resolveProviderApiKey } from "./registry.ts";

export interface ProviderProbeInput {
  /** 内置厂商 id（用于补全 baseUrl/api/envKey 默认值） */
  provider?: string;
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  proxy?: string;
}

export interface ProviderProbeResult {
  ok: boolean;
  /** HTTP 状态码（网络失败时缺省） */
  status?: number;
  latencyMs: number;
  /** 响应中的模型数量 */
  modelCount?: number;
  error?: string;
  /** 实际探测的 URL（回显给 UI） */
  url?: string;
}

const TIMEOUT_MS = 15_000;

function anthropicModelsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "").replace(/\/v1$/i, "");
  return `${base}/v1/models`;
}

/** 解析探测参数：显式传入 > models.json 已存密钥 > 注册表（扩展 env 模板 > 厂商环境变量） */
function resolveTarget(input: ProviderProbeInput): {
  url: string;
  headers: Record<string, string>;
  proxy?: string;
  api: Api;
} | { error: string } {
  const providerId = input.provider?.trim();
  const entry = providerId ? findProviderEntry(providerId) : undefined;
  const baseUrl = input.baseUrl?.trim() || entry?.baseUrl;
  if (!baseUrl) return { error: "缺少 baseUrl（且该厂商未注册）" };
  const api = (input.api?.trim() || entry?.api || "openai-completions") as Api;
  const apiKey = input.apiKey?.trim()
    || (providerId ? readProviderApiKey(getAgentDir(), providerId) : undefined)
    || (entry ? resolveProviderApiKey(entry.id) : undefined)
    || (entry ? firstEnvKey(entry.envKeys) : undefined);

  const url = api === "anthropic-messages" ? anthropicModelsUrl(baseUrl) : modelsListUrl(baseUrl);
  const headers: Record<string, string> = {};
  if (apiKey) {
    if (api === "anthropic-messages") {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers.Authorization = `Bearer ${apiKey}`;
    }
  }
  return { url, headers, proxy: input.proxy?.trim() || undefined, api };
}

function firstEnvKey(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value?.trim()) return value.trim();
  }
  return undefined;
}

export async function probeProviderConnection(input: ProviderProbeInput): Promise<ProviderProbeResult> {
  const target = resolveTarget(input);
  if ("error" in target) {
    return { ok: false, latencyMs: 0, error: target.error };
  }
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await providerFetch(target.url, {
      method: "GET",
      headers: target.headers,
      signal: controller.signal,
    }, target.proxy);
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const detail = body.slice(0, 200).replace(/\s+/g, " ").trim();
      return {
        ok: false,
        status: res.status,
        latencyMs,
        url: target.url,
        error: `HTTP ${res.status}${detail ? `：${detail}` : ""}`,
      };
    }
    const payload = await res.json().catch(() => null);
    const models = parseOpenAiModelsList(payload);
    return {
      ok: true,
      status: res.status,
      latencyMs,
      modelCount: models.length,
      url: target.url,
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      latencyMs,
      url: target.url,
      error: controller.signal.aborted ? `请求超时（${TIMEOUT_MS / 1000}s）` : message,
    };
  } finally {
    clearTimeout(timer);
  }
}
