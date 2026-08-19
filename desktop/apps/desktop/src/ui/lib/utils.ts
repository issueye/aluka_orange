/**
 * 纯工具函数：路径比较、会话键、时间线解析、用量格式化、Host 就绪等待。
 * 无组件、无状态，可被任意视图直接复用。
 */
import { rpc } from "../bridge.ts";
import type { SessionUsageView, TimelineItem } from "../types.ts";

/** 大小写/分隔符不敏感的路径比较（Windows 语义） */
export function pathsEqual(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
}

/** 生成会话缓存键：cwd + id 归一化 */
export function sessionKey(cwd?: string, id?: string): string {
  if (!id) return "";
  return `${(cwd ?? "").replace(/\\/g, "/").toLowerCase()}::${id}`;
}

/** 从 RPC 返回中解析时间线（兼容裸数组 / {items} / {timeline} 包装） */
export function readTimelinePayload(raw: unknown): TimelineItem[] {
  if (Array.isArray(raw)) return raw as TimelineItem[];
  if (raw && typeof raw === "object") {
    const rec = raw as { items?: unknown; timeline?: unknown };
    if (Array.isArray(rec.items)) return rec.items as TimelineItem[];
    if (Array.isArray(rec.timeline)) return rec.timeline as TimelineItem[];
  }
  return [];
}

/** 取更长的时间线（host 数据与本地缓存二选一） */
export function preferTimeline(primary: TimelineItem[], fallback: TimelineItem[]): TimelineItem[] {
  return primary.length >= fallback.length ? primary : fallback;
}

/** 格式化用量统计为简短摘要文本 */
export function formatUsage(u?: SessionUsageView): string {
  if (!u || !u.totals.calls) return "用量 —";
  const t = u.totals;
  const cost = typeof u.estimatedCostUsd === "number" ? ` · 约 $${u.estimatedCostUsd.toFixed(4)}` : "";
  return `输入 ${t.input} · 输出 ${t.output} · 合计 ${t.totalTokens} · 调用 ${t.calls}${cost}`;
}

/**
 * 等待 Host 运行时就绪
 * 轮询 getRuntimeInfo 直到 hostReady 为 true，超时 15 秒。
 */
export async function waitHostRuntime(): Promise<{
  productVersion: string;
  phase: string;
  platform: string;
  hostReady?: boolean;
}> {
  const deadline = Date.now() + 15000;
  let last: { productVersion: string; phase: string; platform: string; hostReady?: boolean } | undefined;
  while (Date.now() < deadline) {
    last = await rpc<{ productVersion: string; phase: string; platform: string; hostReady?: boolean }>("getRuntimeInfo");
    if (last.hostReady) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (last) return last;
  throw new Error("host 启动超时");
}
