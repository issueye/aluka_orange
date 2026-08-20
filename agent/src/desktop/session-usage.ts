/**
 * 会话级 token 用量汇总（从 AssistantMessage.usage 累加）。
 * 不是 Zeno 式「账户配额」；OAuth / 实时 Provider usage 不在此范围。
 */

import type { Usage } from "../ai/types.ts";
import type { AgentMessage } from "../agent/types.ts";
import type { SessionEntry } from "../session/manager.ts";

export interface SessionUsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  /** 带 usage 的 assistant 条数 */
  calls: number;
}

export interface SessionUsageView {
  sessionId: string;
  totals: SessionUsageTotals;
  /** 当前模型成本字段若全为 0，则 estimatedCost 为 undefined */
  estimatedCostUsd?: number;
  /** 最近一轮请求占用的 token（用于上下文占比环） */
  contextTokens: number;
  /** 当前模型上下文窗口 */
  contextWindow: number;
  authMode: "api_key";
  oauthSupported: false;
  note: string;
}

export function emptyUsageTotals(): SessionUsageTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, calls: 0 };
}

export function addUsage(into: SessionUsageTotals, usage?: Usage | null): SessionUsageTotals {
  if (!usage) return into;
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
  };
}

export function sumUsageFromMessages(messages: AgentMessage[]): SessionUsageTotals {
  let totals = emptyUsageTotals();
  for (const message of messages) {
    if (message.role === "assistant" && message.usage) {
      totals = addUsage(totals, message.usage);
    }
  }
  return totals;
}

/** 从会话 JSONL 条目恢复用量（message / compaction.usage） */
export function sumUsageFromSessionEntries(entries: SessionEntry[]): SessionUsageTotals {
  let totals = emptyUsageTotals();
  for (const entry of entries) {
    if (entry.type === "message") {
      totals = mergeUsageTotals(totals, sumUsageFromMessages([entry.message as AgentMessage]));
      continue;
    }
    if (entry.type === "compaction" && entry.usage) {
      totals = addUsage(totals, entry.usage);
    }
  }
  return totals;
}

/** 最近一条带 usage 的助手消息：该轮 prompt+completion，近似当前上下文占用 */
export function lastTurnContextTokens(messages: AgentMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant" || !message.usage) continue;
    const usage = message.usage;
    const input = Number(usage.input) || 0;
    const output = Number(usage.output) || 0;
    if (typeof usage.totalTokens === "number" && Number.isFinite(usage.totalTokens) && usage.totalTokens > 0) {
      return usage.totalTokens;
    }
    return input + output;
  }
  return 0;
}

export function mergeUsageTotals(a: SessionUsageTotals, b: SessionUsageTotals): SessionUsageTotals {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    totalTokens: a.totalTokens + b.totalTokens,
    calls: a.calls + b.calls,
  };
}

export function buildSessionUsageView(opts: {
  sessionId: string;
  messages: AgentMessage[];
  /** 可选：模型单价（$/M tokens）；全 0 则不估费 */
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow?: number;
}): SessionUsageView {
  const totals = sumUsageFromMessages(opts.messages);
  let estimatedCostUsd: number | undefined;
  if (opts.cost) {
    const { input, output, cacheRead, cacheWrite } = opts.cost;
    if (input || output || cacheRead || cacheWrite) {
      estimatedCostUsd =
        (totals.input * input +
          totals.output * output +
          totals.cacheRead * cacheRead +
          totals.cacheWrite * cacheWrite) /
        1_000_000;
    }
  }
  const contextWindow =
    typeof opts.contextWindow === "number" && Number.isFinite(opts.contextWindow) && opts.contextWindow > 0
      ? Math.floor(opts.contextWindow)
      : 0;
  return {
    sessionId: opts.sessionId,
    totals,
    estimatedCostUsd,
    contextTokens: lastTurnContextTokens(opts.messages),
    contextWindow,
    authMode: "api_key",
    oauthSupported: false,
    note: "Auth is API key only. OAuth and live provider quotas are not supported in Aluka Desktop.",
  };
}
