/**
 * 全局 token 用量统计：按「供应商 → 模型」聚合输入 / 输出 token。
 *
 * 独立于会话 JSONL，持久化到 agentDir/usage.json：每轮 prompt 结束后把本轮
 * 各 assistant 消息携带的 usage 累加到对应模型条目，删除会话不影响累计值。
 * 会话级汇总（当前会话卡片）见 session-usage.ts。
 */

import fs from "node:fs";
import path from "node:path";
import type { ModelCost, Usage } from "../ai/types.ts";
import type { AgentMessage } from "../agent/types.ts";
import { getAgentDir } from "../config.ts";
import { findProviderModel } from "../providers/registry.ts";

/** 单个模型的累计用量 */
export interface ModelUsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  /** 带 usage 的 assistant 消息数（≈ 模型调用次数） */
  calls: number;
  firstUsedAt: number;
  lastUsedAt: number;
}

/** usage.json 落盘形态：providers[providerId][modelId] → 累计值 */
export interface UsageStoreFile {
  version: 1;
  providers: Record<string, Record<string, ModelUsageTotals>>;
}

/** 用量统计视图：单模型行 */
export interface UsageModelStat {
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  calls: number;
  /** 占全局 totalTokens 的比例（0-1） */
  share: number;
  /** 注册表单价可得时给出估算（$/M tokens） */
  estimatedCostUsd?: number;
  lastUsedAt: number;
}

/** 用量统计视图：供应商分组 */
export interface UsageProviderStat {
  provider: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  calls: number;
  /** 占全局 totalTokens 的比例（0-1） */
  share: number;
  models: UsageModelStat[];
}

/** 设置页「用量」展示的全局统计（getUsageStats RPC 返回值） */
export interface UsageStatsView {
  totals: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    calls: number;
  };
  /** 任一模型单价可得时给出估算，否则省略 */
  estimatedCostUsd?: number;
  /** 按 totalTokens 降序 */
  providers: UsageProviderStat[];
  /** 最早一次记录时间戳（ms） */
  since: number;
  updatedAt: number;
}

export function usageStorePath(agentDir = getAgentDir()): string {
  return path.join(agentDir, "usage.json");
}

function emptyTotals(now: number): ModelUsageTotals {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    calls: 0,
    firstUsedAt: now,
    lastUsedAt: now,
  };
}

export function loadUsageStore(agentDir = getAgentDir()): UsageStoreFile {
  try {
    const raw = JSON.parse(fs.readFileSync(usageStorePath(agentDir), "utf8")) as UsageStoreFile;
    if (raw && typeof raw === "object" && raw.providers && typeof raw.providers === "object") {
      return { version: 1, providers: raw.providers };
    }
  } catch {
    /* 文件缺失或损坏时从空 store 开始 */
  }
  return { version: 1, providers: {} };
}

function saveUsageStore(agentDir: string, store: UsageStoreFile): void {
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(usageStorePath(agentDir), `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}

function mergeTotals(into: ModelUsageTotals, usage: Usage, now: number): ModelUsageTotals {
  const input = Number(usage.input) || 0;
  const output = Number(usage.output) || 0;
  const cacheRead = Number(usage.cacheRead) || 0;
  const cacheWrite = Number(usage.cacheWrite) || 0;
  const total =
    typeof usage.totalTokens === "number" && Number.isFinite(usage.totalTokens)
      ? usage.totalTokens
      : input + output + cacheRead + cacheWrite;
  return {
    input: into.input + input,
    output: into.output + output,
    cacheRead: into.cacheRead + cacheRead,
    cacheWrite: into.cacheWrite + cacheWrite,
    totalTokens: into.totalTokens + total,
    calls: into.calls + 1,
    firstUsedAt: into.firstUsedAt || now,
    lastUsedAt: now,
  };
}

/** 把一轮 prompt 产生的 assistant 消息 usage 累加进 store 并落盘（无 usage 则不写） */
export function recordProducedUsage(
  agentDir: string,
  messages: AgentMessage[],
  now = Date.now(),
): void {
  const store = loadUsageStore(agentDir);
  let changed = false;
  for (const message of messages) {
    if (message.role !== "assistant" || !message.usage) continue;
    const provider = message.provider?.trim();
    const model = message.model?.trim();
    if (!provider || !model) continue;
    const models = (store.providers[provider] ??= {});
    models[model] = mergeTotals(models[model] ?? emptyTotals(now), message.usage, now);
    changed = true;
  }
  if (changed) saveUsageStore(agentDir, store);
}

/** 单价全为 0 视为未知，返回 undefined */
function costFromPricing(
  totals: { input: number; output: number; cacheRead: number; cacheWrite: number },
  cost: ModelCost,
): number | undefined {
  if (!cost.input && !cost.output && !cost.cacheRead && !cost.cacheWrite) return undefined;
  return (
    (totals.input * cost.input +
      totals.output * cost.output +
      totals.cacheRead * cost.cacheRead +
      totals.cacheWrite * cost.cacheWrite) /
    1_000_000
  );
}

/** 读取 usage.json 并构建给 UI 的统计视图（份额、排序、费用估算） */
export function buildUsageStatsView(agentDir = getAgentDir()): UsageStatsView {
  const store = loadUsageStore(agentDir);
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, calls: 0 };
  let since = 0;
  let updatedAt = 0;
  let costSum = 0;
  let costKnown = false;
  const providers: UsageProviderStat[] = [];

  for (const [provider, models] of Object.entries(store.providers)) {
    if (!models || typeof models !== "object") continue;
    const group: UsageProviderStat = {
      provider,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      calls: 0,
      share: 0,
      models: [],
    };
    for (const [model, t] of Object.entries(models)) {
      if (!t || typeof t !== "object") continue;
      const row: UsageModelStat = {
        provider,
        model,
        input: Number(t.input) || 0,
        output: Number(t.output) || 0,
        cacheRead: Number(t.cacheRead) || 0,
        cacheWrite: Number(t.cacheWrite) || 0,
        totalTokens: Number(t.totalTokens) || 0,
        calls: Number(t.calls) || 0,
        share: 0,
        lastUsedAt: Number(t.lastUsedAt) || 0,
      };
      // 优先供应商内注册的模型单价（内置目录含 models.dev 定价；自定义模型可能无价）
      const registered = findProviderModel(provider, model);
      if (registered?.cost) {
        const est = costFromPricing(row, registered.cost);
        if (est !== undefined) {
          row.estimatedCostUsd = est;
          costSum += est;
          costKnown = true;
        }
      }
      group.input += row.input;
      group.output += row.output;
      group.cacheRead += row.cacheRead;
      group.cacheWrite += row.cacheWrite;
      group.totalTokens += row.totalTokens;
      group.calls += row.calls;
      group.models.push(row);
      const first = Number(t.firstUsedAt) || 0;
      if (first && (!since || first < since)) since = first;
      if (row.lastUsedAt > updatedAt) updatedAt = row.lastUsedAt;
    }
    if (group.models.length) providers.push(group);
  }

  for (const group of providers) {
    group.models.sort((a, b) => b.totalTokens - a.totalTokens || b.calls - a.calls);
  }
  // 份额基于全局合计：先累计再回填
  for (const group of providers) {
    totals.input += group.input;
    totals.output += group.output;
    totals.cacheRead += group.cacheRead;
    totals.cacheWrite += group.cacheWrite;
    totals.totalTokens += group.totalTokens;
    totals.calls += group.calls;
  }
  if (totals.totalTokens > 0) {
    for (const group of providers) {
      group.share = group.totalTokens / totals.totalTokens;
      for (const row of group.models) row.share = row.totalTokens / totals.totalTokens;
    }
  }
  providers.sort((a, b) => b.totalTokens - a.totalTokens);

  return {
    totals,
    ...(costKnown ? { estimatedCostUsd: costSum } : {}),
    providers,
    since,
    updatedAt: updatedAt || Date.now(),
  };
}
