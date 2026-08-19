/**
 * 把发给模型供应商的请求/响应落到 ~/.aluka/agent/logs，
 * 用来对照 tools JSON Schema 被网关拒绝的原因。
 *
 * 不记录 Authorization / x-api-key。
 */

import fs from "node:fs";
import path from "node:path";
import { getAgentDir } from "../config.ts";

/**
 * Console Go / DeepSeek 一类网关通常能接受的工具 schema 字段。
 * 其它 key（~kind、$schema、additionalProperties、minLength 等）会标进 unexpectedKeys。
 */
const SAFE_TOOL_KEYS = new Set([
  "type",
  "function",
  "name",
  "description",
  "parameters",
  "input_schema",
  "strict",
  "properties",
  "required",
  "items",
  "enum",
]);

export interface ProviderCallLog {
  api: string;
  url: string;
  model?: string;
  provider?: string;
  requestBody: string;
  status?: number;
  responseBody?: string;
}

export function providerLogsDir(agentDir = getAgentDir()): string {
  return path.join(agentDir, "logs");
}

export function providerRequestLogPath(agentDir = getAgentDir()): string {
  return path.join(providerLogsDir(agentDir), "provider-requests.log");
}

export function providerLatestRequestPath(agentDir = getAgentDir()): string {
  return path.join(providerLogsDir(agentDir), "provider-request-latest.json");
}

/**
 * 收集工具 JSON Schema 关键字。
 * `properties` 里的字段名（path、command 等）不算关键字，只继续往下看它们的 schema。
 */
export function collectJsonKeys(value: unknown, into = new Set<string>(), inProperties = false): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectJsonKeys(item, into, false);
    return into;
  }
  if (!value || typeof value !== "object") return into;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (!inProperties) into.add(key);
    collectJsonKeys(nested, into, key === "properties");
  }
  return into;
}

export function inspectToolsPayload(requestBody: string): {
  tools?: unknown;
  schemaKeys: string[];
  unexpectedKeys: string[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(requestBody);
  } catch {
    return { schemaKeys: [], unexpectedKeys: [] };
  }
  const tools = parsed && typeof parsed === "object" ? (parsed as { tools?: unknown }).tools : undefined;
  const keys = [...collectJsonKeys(tools)].sort();
  return {
    tools,
    schemaKeys: keys,
    unexpectedKeys: keys.filter((key) => !SAFE_TOOL_KEYS.has(key)),
  };
}

function shouldLog(): boolean {
  if (process.env.ALUKA_LOG_PROVIDER === "0") return false;
  if (process.env.ALUKA_LOG_PROVIDER === "1") return true;
  if (process.env.VITEST) return false;
  return true;
}

function truncate(text: string, max = 8000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]`;
}

function summarizeMessages(body: unknown): unknown {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  const messages = record.messages ?? record.input;
  if (!Array.isArray(messages)) return undefined;
  return messages.map((message) => {
    if (!message || typeof message !== "object") return message;
    const item = { ...(message as Record<string, unknown>) };
    if (typeof item.content === "string" && item.content.length > 400) {
      item.content = `${item.content.slice(0, 400)}…[${item.content.length} chars]`;
    }
    return item;
  });
}

/**
 * 写入请求日志。失败时静默忽略，不影响主请求。
 * @returns 日志文件路径；跳过或失败时返回 undefined
 */
export function logProviderCall(info: ProviderCallLog, agentDir = getAgentDir()): string | undefined {
  if (!shouldLog()) return undefined;
  try {
    const dir = providerLogsDir(agentDir);
    fs.mkdirSync(dir, { recursive: true });

    const inspected = inspectToolsPayload(info.requestBody);
    let parsed: unknown;
    try {
      parsed = JSON.parse(info.requestBody);
    } catch {
      parsed = undefined;
    }

    const snapshot = {
      time: new Date().toISOString(),
      api: info.api,
      url: info.url,
      model: info.model,
      provider: info.provider,
      status: info.status,
      schemaKeys: inspected.schemaKeys,
      unexpectedKeys: inspected.unexpectedKeys,
      tools: inspected.tools,
      messagesPreview: summarizeMessages(parsed),
      requestBytes: info.requestBody.length,
      responseBody: info.responseBody ? truncate(info.responseBody, 4000) : undefined,
    };

    const latestPath = providerLatestRequestPath(agentDir);
    fs.writeFileSync(latestPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

    const toolsPretty = inspected.tools === undefined
      ? "(no tools field)"
      : JSON.stringify(inspected.tools, null, 2);
    const block = [
      "",
      `======== ${snapshot.time} ${info.api} ========`,
      `url: ${info.url}`,
      `model: ${info.model ?? ""}`,
      `provider: ${info.provider ?? ""}`,
      `status: ${info.status ?? "(pending)"}`,
      `requestBytes: ${info.requestBody.length}`,
      `schemaKeys: ${inspected.schemaKeys.join(", ") || "(none)"}`,
      `unexpectedKeys: ${inspected.unexpectedKeys.join(", ") || "(none)"}`,
      "tools:",
      toolsPretty,
      info.responseBody ? `response:\n${truncate(info.responseBody, 4000)}` : "",
      "",
    ].join("\n");

    const logPath = providerRequestLogPath(agentDir);
    fs.appendFileSync(logPath, block, "utf8");
    console.log(`[aluka] provider request logged: ${logPath}`);
    return logPath;
  } catch (error) {
    console.warn("[aluka] failed to write provider request log", error);
    return undefined;
  }
}
