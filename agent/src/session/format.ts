/**
 * pi 兼容的会话 JSONL 格式：header + 带 id/parentId 的树。
 * 当前版本 3（与 pi 对齐）。Aluka 旧文件是线性 user/turn，加载时迁移。
 */

import { randomBytes, randomUUID } from "node:crypto";
import { textFrom, type AgentMessage, type CustomMessage } from "../agent/types.ts";
import type { ImageContent, TextContent, ThinkingLevel, Usage } from "../ai/types.ts";

export const CURRENT_SESSION_VERSION = 3;

export interface SessionHeader {
  type: "session";
  version?: number;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
}

export interface SessionEntryBase {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
}

export interface SessionMessageEntry extends SessionEntryBase {
  type: "message";
  message: AgentMessage;
}

export interface ThinkingLevelChangeEntry extends SessionEntryBase {
  type: "thinking_level_change";
  thinkingLevel: ThinkingLevel | string;
}

export interface ModelChangeEntry extends SessionEntryBase {
  type: "model_change";
  provider: string;
  modelId: string;
}

export interface CompactionEntry extends SessionEntryBase {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: unknown;
  usage?: Usage;
  fromHook?: boolean;
}

export interface BranchSummaryEntry extends SessionEntryBase {
  type: "branch_summary";
  fromId: string;
  summary: string;
  details?: unknown;
  usage?: Usage;
  fromHook?: boolean;
}

export interface CustomEntry extends SessionEntryBase {
  type: "custom";
  customType: string;
  data?: unknown;
}

export interface CustomMessageEntry extends SessionEntryBase {
  type: "custom_message";
  customType: string;
  content: string | Array<TextContent | ImageContent>;
  details?: unknown;
  display: boolean;
}

export interface LabelEntry extends SessionEntryBase {
  type: "label";
  targetId: string;
  label: string | undefined;
}

export interface SessionInfoEntry extends SessionEntryBase {
  type: "session_info";
  name?: string;
}

export type SessionEntry =
  | SessionMessageEntry
  | ThinkingLevelChangeEntry
  | ModelChangeEntry
  | CompactionEntry
  | BranchSummaryEntry
  | CustomEntry
  | CustomMessageEntry
  | LabelEntry
  | SessionInfoEntry;

export type FileEntry = SessionHeader | SessionEntry;

export interface SessionTreeNode {
  entry: SessionEntry;
  children: SessionTreeNode[];
  label?: string;
  labelTimestamp?: string;
}

export interface SessionContext {
  messages: AgentMessage[];
  thinkingLevel: string;
  model: { provider: string; modelId: string } | null;
}

export interface SessionSummary {
  id: string;
  file: string;
  title: string;
  name?: string;
  mtime: number;
  ctime: number;
  messageCount: number;
}

export function createSessionUuid(): string {
  return randomUUID();
}

export function generateEntryId(byId: { has(id: string): boolean }): string {
  for (let i = 0; i < 100; i++) {
    const id = randomBytes(4).toString("hex");
    if (!byId.has(id)) return id;
  }
  return randomUUID();
}

export function toIsoTimestamp(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return new Date().toISOString();
}

export function isoToMillis(timestamp: string): number {
  const ms = Date.parse(timestamp);
  return Number.isNaN(ms) ? Date.now() : ms;
}

export function parseSessionEntries(content: string): FileEntry[] {
  const entries: FileEntry[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as FileEntry);
    } catch {
      /* skip malformed */
    }
  }
  return entries;
}

function asTextContent(content: string | Array<TextContent | ImageContent> | undefined): Array<TextContent | ImageContent> {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) return content;
  return [];
}

function extractTextFromMessage(message: AgentMessage): string {
  return textFrom(message);
}

function isLegacyUser(entry: Record<string, unknown>): boolean {
  return entry.type === "user" && typeof entry.text === "string";
}

function isLegacyTurn(entry: Record<string, unknown>): boolean {
  return entry.type === "turn" && Array.isArray(entry.messages);
}

export function isLegacyFileEntry(entry: FileEntry): boolean {
  const rec = entry as unknown as Record<string, unknown>;
  return isLegacyUser(rec) || isLegacyTurn(rec);
}

function messageFromLegacyUser(entry: Record<string, unknown>): AgentMessage {
  return {
    role: "user",
    content: [{ type: "text", text: String(entry.text ?? "") }],
    timestamp: typeof entry.timestamp === "number" ? entry.timestamp : isoToMillis(toIsoTimestamp(entry.timestamp)),
  };
}

/**
 * 把 Aluka v1 线性 user/turn（以及混在 v3 文件里的旧行）展开为树节点。
 * 返回是否改写了内容。
 */
export function migrateToCurrentVersion(entries: FileEntry[], cwd: string): boolean {
  const headerIndex = entries.findIndex((entry) => entry.type === "session");
  let changed = false;
  let header = headerIndex >= 0 ? (entries[headerIndex] as SessionHeader) : undefined;
  const version = header?.version ?? (header ? CURRENT_SESSION_VERSION : 1);

  if (!header) {
    header = {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: createSessionUuid(),
      timestamp: toIsoTimestamp(entries[0] && "timestamp" in entries[0] ? entries[0].timestamp : undefined),
      cwd,
    };
    changed = true;
  } else if ((header.version ?? 1) < CURRENT_SESSION_VERSION) {
    header.version = CURRENT_SESSION_VERSION;
    if (!header.cwd) header.cwd = cwd;
    changed = true;
  }

  const ids = new Set<string>();
  const migrated: FileEntry[] = [header];
  let prevId: string | null = null;

  const pushMessage = (message: AgentMessage, timestamp: unknown, explicitId?: string) => {
    let id = explicitId && !ids.has(explicitId) ? explicitId : generateEntryId(ids);
    ids.add(id);
    const entry: SessionMessageEntry = {
      type: "message",
      id,
      parentId: prevId,
      timestamp: toIsoTimestamp(timestamp),
      message,
    };
    migrated.push(entry);
    prevId = id;
  };

  for (const raw of entries) {
    if (raw.type === "session") continue;
    const rec = raw as unknown as Record<string, unknown>;

    if (isLegacyUser(rec)) {
      pushMessage(messageFromLegacyUser(rec), rec.timestamp, typeof rec.id === "string" ? rec.id : undefined);
      changed = true;
      continue;
    }
    if (isLegacyTurn(rec)) {
      for (const message of rec.messages as AgentMessage[]) {
        if (message?.role === "user") continue;
        pushMessage(message, rec.timestamp ?? (message as { timestamp?: number }).timestamp);
      }
      changed = true;
      continue;
    }

    const entry = raw as SessionEntry;
    if (!entry.id || ids.has(entry.id)) {
      entry.id = generateEntryId(ids);
      changed = true;
    }
    ids.add(entry.id);
    if (entry.parentId === undefined || (entry.parentId === null && prevId !== null && version < 2)) {
      entry.parentId = prevId;
      changed = true;
    }
    if (typeof entry.timestamp === "number") {
      (entry as SessionEntryBase).timestamp = toIsoTimestamp(entry.timestamp);
      changed = true;
    } else if (!entry.timestamp) {
      entry.timestamp = new Date().toISOString();
      changed = true;
    }
    migrated.push(entry);
    prevId = entry.id;
  }

  entries.length = 0;
  entries.push(...migrated);
  return changed || version < CURRENT_SESSION_VERSION;
}

export function buildEntryIndex(entries: SessionEntry[]): Map<string, SessionEntry> {
  const index = new Map<string, SessionEntry>();
  for (const entry of entries) index.set(entry.id, entry);
  return index;
}

export function buildSessionPath(
  entries: SessionEntry[],
  leafId?: string | null,
  byId?: Map<string, SessionEntry>,
): SessionEntry[] {
  const index = byId ?? buildEntryIndex(entries);
  if (leafId === null) return [];
  let leaf = leafId ? index.get(leafId) : undefined;
  leaf ??= entries[entries.length - 1];
  if (!leaf) return [];
  const path: SessionEntry[] = [];
  let current: SessionEntry | undefined = leaf;
  while (current) {
    path.push(current);
    current = current.parentId ? index.get(current.parentId) : undefined;
  }
  path.reverse();
  return path;
}

export function sessionEntryToContextMessages(entry: SessionEntry): AgentMessage[] {
  if (entry.type === "message") {
    const message = entry.message;
    if (!message) return [];
    if ((message.role === "user" || message.role === "assistant" || message.role === "toolResult") && message.content == null) {
      return [{ ...message, content: [] } as AgentMessage];
    }
    return [message];
  }
  if (entry.type === "custom_message") {
    const custom: CustomMessage = {
      role: "custom",
      customType: entry.customType,
      content: asTextContent(entry.content),
      display: entry.display,
      details: entry.details,
      timestamp: isoToMillis(entry.timestamp),
    };
    return [custom];
  }
  if (entry.type === "branch_summary" && entry.summary) {
    return [
      {
        role: "branchSummary",
        summary: entry.summary,
        fromId: entry.fromId,
        timestamp: isoToMillis(entry.timestamp),
      },
    ];
  }
  if (entry.type === "compaction") {
    return [
      {
        role: "compactionSummary",
        summary: entry.summary,
        tokensBefore: entry.tokensBefore,
        timestamp: isoToMillis(entry.timestamp),
      },
    ];
  }
  return [];
}

export function buildContextEntries(
  entries: SessionEntry[],
  leafId?: string | null,
  byId?: Map<string, SessionEntry>,
): SessionEntry[] {
  const path = buildSessionPath(entries, leafId, byId);
  let compaction: CompactionEntry | null = null;
  for (const entry of path) {
    if (entry.type === "compaction") compaction = entry;
  }
  if (!compaction) return path;

  const compactionIdx = path.findIndex((entry) => entry.id === compaction.id);
  if (compactionIdx < 0) return path;

  const contextEntries: SessionEntry[] = [compaction];
  let foundFirstKept = false;
  for (let i = 0; i < compactionIdx; i++) {
    const entry = path[i];
    if (entry.id === compaction.firstKeptEntryId) foundFirstKept = true;
    if (foundFirstKept) contextEntries.push(entry);
  }
  contextEntries.push(...path.slice(compactionIdx + 1));
  return contextEntries;
}

function getSessionContextSettings(path: SessionEntry[]): Pick<SessionContext, "thinkingLevel" | "model"> {
  let thinkingLevel = "off";
  let model: { provider: string; modelId: string } | null = null;
  for (const entry of path) {
    if (entry.type === "thinking_level_change") {
      thinkingLevel = entry.thinkingLevel;
    } else if (entry.type === "model_change") {
      model = { provider: entry.provider, modelId: entry.modelId };
    } else if (entry.type === "message" && entry.message.role === "assistant") {
      const assistant = entry.message as { provider?: string; model?: string };
      if (assistant.provider && assistant.model) {
        model = { provider: assistant.provider, modelId: assistant.model };
      }
    }
  }
  return { thinkingLevel, model };
}

export function buildSessionContext(
  entries: SessionEntry[],
  leafId?: string | null,
  byId?: Map<string, SessionEntry>,
): SessionContext {
  const path = buildSessionPath(entries, leafId, byId);
  const { thinkingLevel, model } = getSessionContextSettings(path);
  const messages = buildContextEntries(entries, leafId, byId).flatMap(sessionEntryToContextMessages);
  return { messages, thinkingLevel, model };
}

export function getSessionNameFromEntries(entries: SessionEntry[]): string | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === "session_info") {
      return entry.name?.trim() || undefined;
    }
  }
  return undefined;
}

export function firstUserText(entries: SessionEntry[]): string {
  for (const entry of entries) {
    if (entry.type === "message" && entry.message.role === "user") {
      const text = extractTextFromMessage(entry.message).trim().replace(/\s+/g, " ");
      if (text) return text;
    }
    const rec = entry as unknown as Record<string, unknown>;
    if (isLegacyUser(rec)) {
      const text = String(rec.text).trim().replace(/\s+/g, " ");
      if (text) return text;
    }
  }
  return "";
}

export function summarizeSessionFile(
  file: string,
  fileId: string,
  entries: FileEntry[],
  stats: { mtimeMs: number; ctimeMs: number },
): SessionSummary {
  const body = entries.filter((entry): entry is SessionEntry => entry.type !== "session");
  const name = getSessionNameFromEntries(body);
  const first = firstUserText(body);
  const titleSource = name || first || fileId;
  const title = titleSource.length > 48 ? `${titleSource.slice(0, 48)}…` : titleSource;
  let messageCount = 0;
  let lastActivity = 0;
  for (const entry of body) {
    if (entry.type === "message") {
      messageCount += 1;
      const ts = isoToMillis(entry.timestamp);
      if (ts > lastActivity) lastActivity = ts;
    }
  }
  return {
    id: fileId,
    file,
    title,
    name,
    mtime: lastActivity || stats.mtimeMs,
    ctime: stats.ctimeMs,
    messageCount,
  };
}
