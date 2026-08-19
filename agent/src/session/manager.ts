/**
 * 会话管理：append-only JSONL 树（对齐 pi SessionManager）。
 *
 * 每条记录有 id / parentId。leaf 指向当前分支末端；branch() 只移动 leaf，不改历史。
 * 兼容 Aluka 旧的线性 user/turn 文件（打开时迁移到 v3）。
 */

import fs from "node:fs";
import path from "node:path";
import type { AgentMessage } from "../agent/types.ts";
import type { ImageContent, TextContent, ThinkingLevel, Usage } from "../ai/types.ts";
import {
  CURRENT_SESSION_VERSION,
  buildContextEntries,
  buildSessionContext,
  createSessionUuid,
  generateEntryId,
  getSessionNameFromEntries,
  isLegacyFileEntry,
  migrateToCurrentVersion,
  parseSessionEntries,
  summarizeSessionFile,
  type BranchSummaryEntry,
  type CompactionEntry,
  type CustomEntry,
  type CustomMessageEntry,
  type FileEntry,
  type LabelEntry,
  type ModelChangeEntry,
  type SessionContext,
  type SessionEntry,
  type SessionHeader,
  type SessionInfoEntry,
  type SessionMessageEntry,
  type SessionSummary,
  type SessionTreeNode,
  type ThinkingLevelChangeEntry,
} from "./format.ts";

export type {
  BranchSummaryEntry,
  CompactionEntry,
  CustomEntry,
  CustomMessageEntry,
  FileEntry,
  LabelEntry,
  ModelChangeEntry,
  SessionContext,
  SessionEntry,
  SessionHeader,
  SessionInfoEntry,
  SessionMessageEntry,
  SessionSummary,
  SessionTreeNode,
  ThinkingLevelChangeEntry,
};
export { CURRENT_SESSION_VERSION, buildContextEntries, buildSessionContext } from "./format.ts";

export interface NewSessionOptions {
  id?: string;
  /** 会话文件名（可带 .jsonl）；与显示名无关 */
  fileName?: string;
  cwd?: string;
  parentSession?: string;
}

/** 兼容旧调用：append({ type: "user", text }) / append({ type: "turn", messages }) */
export type LegacyAppendInput = {
  type: string;
  text?: string;
  role?: string;
  messages?: AgentMessage[];
  message?: AgentMessage;
  name?: string;
  customType?: string;
  data?: unknown;
  content?: string | Array<TextContent | ImageContent>;
  display?: boolean;
  details?: unknown;
  id?: string;
  timestamp?: number | string;
  [key: string]: unknown;
};

function sessionFileId(file: string): string {
  return path.basename(file, ".jsonl");
}

function loadEntriesFromFile(filePath: string): FileEntry[] {
  if (!fs.existsSync(filePath)) return [];
  return parseSessionEntries(fs.readFileSync(filePath, "utf8"));
}

export class SessionManager {
  private sessionId = "";
  private sessionFile: string | undefined;
  private sessionDir: string;
  private cwd: string;
  private persist: boolean;
  private fileEntries: FileEntry[] = [];
  private byId = new Map<string, SessionEntry>();
  private labelsById = new Map<string, string>();
  private labelTimestampsById = new Map<string, string>();
  private leafId: string | null = null;

  private constructor(cwd: string, sessionDir: string, sessionFile: string | undefined, persist: boolean, options?: NewSessionOptions) {
    this.cwd = path.resolve(cwd);
    this.sessionDir = sessionDir ? path.resolve(sessionDir) : "";
    this.persist = persist;
    if (persist && this.sessionDir) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
    if (sessionFile) {
      this.loadSessionFile(sessionFile);
    } else {
      this.newSession(options);
    }
  }

  /** 兼容旧 API：会话文件路径（内存会话为空字符串） */
  get file(): string {
    return this.sessionFile ?? "";
  }

  /** 列表 / RPC 使用的 id：文件名去 .jsonl */
  get id(): string {
    return this.sessionFile ? sessionFileId(this.sessionFile) : this.sessionId;
  }

  getCwd(): string {
    return this.cwd;
  }

  getSessionDir(): string {
    return this.sessionDir;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getSessionFile(): string | undefined {
    return this.sessionFile;
  }

  isPersisted(): boolean {
    return this.persist;
  }

  getHeader(): SessionHeader | null {
    const header = this.fileEntries.find((entry) => entry.type === "session");
    return header ? (header as SessionHeader) : null;
  }

  getEntries(): SessionEntry[] {
    return this.fileEntries.filter((entry): entry is SessionEntry => entry.type !== "session");
  }

  getLeafId(): string | null {
    return this.leafId;
  }

  getLeafEntry(): SessionEntry | undefined {
    return this.leafId ? this.byId.get(this.leafId) : undefined;
  }

  getEntry(id: string): SessionEntry | undefined {
    return this.byId.get(id);
  }

  getLabel(id: string): string | undefined {
    return this.labelsById.get(id);
  }

  getSessionName(): string | undefined {
    return getSessionNameFromEntries(this.getEntries());
  }

  getBranch(fromId?: string): SessionEntry[] {
    const pathEntries: SessionEntry[] = [];
    const startId = fromId ?? this.leafId;
    let current = startId ? this.byId.get(startId) : undefined;
    while (current) {
      pathEntries.push(current);
      current = current.parentId ? this.byId.get(current.parentId) : undefined;
    }
    pathEntries.reverse();
    return pathEntries;
  }

  buildContextEntries(): SessionEntry[] {
    return buildContextEntries(this.getEntries(), this.leafId, this.byId);
  }

  buildSessionContext(): SessionContext {
    return buildSessionContext(this.getEntries(), this.leafId, this.byId);
  }

  getTree(): SessionTreeNode[] {
    const entries = this.getEntries();
    const nodeMap = new Map<string, SessionTreeNode>();
    const roots: SessionTreeNode[] = [];
    for (const entry of entries) {
      nodeMap.set(entry.id, {
        entry,
        children: [],
        label: this.labelsById.get(entry.id),
        labelTimestamp: this.labelTimestampsById.get(entry.id),
      });
    }
    for (const entry of entries) {
      const node = nodeMap.get(entry.id)!;
      if (entry.parentId === null || entry.parentId === entry.id) {
        roots.push(node);
      } else {
        const parent = nodeMap.get(entry.parentId);
        if (parent) parent.children.push(node);
        else roots.push(node);
      }
    }
    const stack = [...roots];
    while (stack.length > 0) {
      const node = stack.pop()!;
      node.children.sort((a, b) => Date.parse(a.entry.timestamp) - Date.parse(b.entry.timestamp));
      stack.push(...node.children);
    }
    return roots;
  }

  newSession(options?: NewSessionOptions): string | undefined {
    this.sessionId = options?.id ?? createSessionUuid();
    const timestamp = new Date().toISOString();
    const header: SessionHeader = {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: this.sessionId,
      timestamp,
      cwd: this.cwd,
      parentSession: options?.parentSession,
    };
    this.fileEntries = [header];
    this.byId.clear();
    this.labelsById.clear();
    this.labelTimestampsById.clear();
    this.leafId = null;
    if (this.persist) {
      const fileTimestamp = timestamp.replace(/[:.]/g, "-");
      const rawName = options?.fileName;
      const filename = rawName
        ? rawName.endsWith(".jsonl")
          ? rawName
          : `${rawName}.jsonl`
        : `${fileTimestamp}_${this.sessionId}.jsonl`;
      this.sessionFile = path.join(this.sessionDir, filename);
      this.rewriteFile();
    } else {
      this.sessionFile = undefined;
    }
    return this.sessionFile;
  }

  branch(branchFromId: string): void {
    if (!this.byId.has(branchFromId)) throw new Error(`Entry ${branchFromId} not found`);
    this.leafId = branchFromId;
  }

  resetLeaf(): void {
    this.leafId = null;
  }

  appendMessage(message: AgentMessage): string {
    const entry: SessionMessageEntry = {
      type: "message",
      id: generateEntryId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      message,
    };
    this.appendEntry(entry);
    return entry.id;
  }

  appendThinkingLevelChange(thinkingLevel: ThinkingLevel | string): string {
    const entry: ThinkingLevelChangeEntry = {
      type: "thinking_level_change",
      id: generateEntryId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      thinkingLevel,
    };
    this.appendEntry(entry);
    return entry.id;
  }

  appendModelChange(provider: string, modelId: string): string {
    const entry: ModelChangeEntry = {
      type: "model_change",
      id: generateEntryId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      provider,
      modelId,
    };
    this.appendEntry(entry);
    return entry.id;
  }

  appendCompaction(summary: string, firstKeptEntryId: string, tokensBefore: number, details?: unknown, fromHook?: boolean, usage?: Usage): string {
    const entry: CompactionEntry = {
      type: "compaction",
      id: generateEntryId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      summary,
      firstKeptEntryId,
      tokensBefore,
      details,
      usage,
      fromHook,
    };
    this.appendEntry(entry);
    return entry.id;
  }

  appendCustomEntry(customType: string, data?: unknown): string {
    const entry: CustomEntry = {
      type: "custom",
      customType,
      data,
      id: generateEntryId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
    };
    this.appendEntry(entry);
    return entry.id;
  }

  appendSessionInfo(name: string): string {
    const entry: SessionInfoEntry = {
      type: "session_info",
      id: generateEntryId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      name: name.replace(/[\r\n]+/g, " ").trim(),
    };
    this.appendEntry(entry);
    return entry.id;
  }

  appendCustomMessageEntry(
    customType: string,
    content: string | Array<TextContent | ImageContent>,
    display: boolean,
    details?: unknown,
  ): string {
    const entry: CustomMessageEntry = {
      type: "custom_message",
      customType,
      content,
      display,
      details,
      id: generateEntryId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
    };
    this.appendEntry(entry);
    return entry.id;
  }

  appendLabelChange(targetId: string, label: string | undefined): string {
    if (!this.byId.has(targetId)) throw new Error(`Entry ${targetId} not found`);
    const entry: LabelEntry = {
      type: "label",
      id: generateEntryId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      targetId,
      label,
    };
    this.appendEntry(entry);
    if (label) {
      this.labelsById.set(targetId, label);
      this.labelTimestampsById.set(targetId, entry.timestamp);
    } else {
      this.labelsById.delete(targetId);
      this.labelTimestampsById.delete(targetId);
    }
    return entry.id;
  }

  branchWithSummary(branchFromId: string | null, summary: string, details?: unknown, fromHook?: boolean, usage?: Usage): string {
    if (branchFromId !== null && !this.byId.has(branchFromId)) {
      throw new Error(`Entry ${branchFromId} not found`);
    }
    this.leafId = branchFromId;
    const entry: BranchSummaryEntry = {
      type: "branch_summary",
      id: generateEntryId(this.byId),
      parentId: branchFromId,
      timestamp: new Date().toISOString(),
      fromId: branchFromId ?? "root",
      summary,
      details,
      usage,
      fromHook,
    };
    this.appendEntry(entry);
    return entry.id;
  }

  /**
   * 把当前分支抽到新会话文件（/clone、/fork 的底层）。
   */
  createBranchedSession(leafId: string): string | undefined {
    const previous = this.sessionFile;
    const branch = this.getBranch(leafId);
    if (branch.length === 0) throw new Error(`Entry ${leafId} not found`);

    const withoutLabels: SessionEntry[] = [];
    let parentId: string | null = null;
    for (const entry of branch) {
      if (entry.type === "label") continue;
      withoutLabels.push({ ...entry, parentId });
      parentId = entry.id;
    }

    const newId = createSessionUuid();
    const timestamp = new Date().toISOString();
    const header: SessionHeader = {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: newId,
      timestamp,
      cwd: this.cwd,
      parentSession: this.persist ? previous : undefined,
    };
    this.sessionId = newId;
    this.fileEntries = [header, ...withoutLabels];
    this.rebuildIndex();
    if (this.persist) {
      const filename = `${timestamp.replace(/[:.]/g, "-")}_${newId}.jsonl`;
      this.sessionFile = path.join(this.sessionDir, filename);
      this.rewriteFile();
      return this.sessionFile;
    }
    return undefined;
  }

  /**
   * 旧 API：桌面 / CLI 仍用 type=user / type=turn 追加。
   */
  append(entry: LegacyAppendInput): SessionEntry {
    if (entry.type === "user" && typeof entry.text === "string") {
      const id = this.appendMessage({
        role: "user",
        content: [{ type: "text", text: entry.text }],
        timestamp: typeof entry.timestamp === "number" ? entry.timestamp : Date.now(),
      });
      return this.byId.get(id)!;
    }
    if (entry.type === "turn" && Array.isArray(entry.messages)) {
      let last: SessionEntry | undefined;
      const produced = entry.messages.filter((message) => message?.role !== "user");
      const source = produced.length > 0 ? produced : entry.messages;
      for (const message of source) {
        const id = this.appendMessage(message);
        last = this.byId.get(id);
      }
      return last ?? this.getLeafEntry()!;
    }
    if (entry.type === "message" && entry.message) {
      const id = this.appendMessage(entry.message);
      return this.byId.get(id)!;
    }
    if (entry.type === "session_info" && typeof entry.name === "string") {
      const id = this.appendSessionInfo(entry.name);
      return this.byId.get(id)!;
    }
    const id = this.appendCustomEntry(typeof entry.customType === "string" ? entry.customType : entry.type, entry.data ?? entry);
    return this.byId.get(id)!;
  }

  static create(dir: string, name?: string, cwd = process.cwd()): SessionManager {
    return new SessionManager(cwd, dir, undefined, true, name ? { fileName: name } : undefined);
  }

  static open(dir: string, idOrPath: string, cwd = process.cwd()): SessionManager {
    const full = path.isAbsolute(idOrPath)
      ? idOrPath
      : path.join(dir, idOrPath.endsWith(".jsonl") ? idOrPath : `${idOrPath}.jsonl`);
    if (!fs.existsSync(full)) {
      throw new Error(`session not found: ${idOrPath}`);
    }
    const sessionDir = path.isAbsolute(idOrPath) ? path.dirname(full) : dir;
    return new SessionManager(cwd, sessionDir, full, true);
  }

  static latest(dir: string, cwd = process.cwd()): SessionManager | undefined {
    const listed = SessionManager.list(dir);
    if (!listed[0]) return undefined;
    return SessionManager.open(dir, listed[0].file, cwd);
  }

  static continueRecent(cwd: string, sessionDir: string): SessionManager {
    return SessionManager.latest(sessionDir, cwd) ?? SessionManager.create(sessionDir, undefined, cwd);
  }

  static inMemory(cwd = process.cwd(), options?: NewSessionOptions): SessionManager {
    return new SessionManager(cwd, "", undefined, false, options);
  }

  static list(dir: string): SessionSummary[] {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((file) => file.endsWith(".jsonl"))
      .map((file) => {
        const full = path.join(dir, file);
        const st = fs.statSync(full);
        const entries = loadEntriesFromFile(full);
        return summarizeSessionFile(full, sessionFileId(full), entries, {
          mtimeMs: st.mtimeMs,
          ctimeMs: st.birthtimeMs || st.ctimeMs,
        });
      })
      .sort((a, b) => b.mtime - a.mtime);
  }

  static remove(dir: string, idOrPath: string): boolean {
    const full = path.isAbsolute(idOrPath)
      ? idOrPath
      : path.join(dir, idOrPath.endsWith(".jsonl") ? idOrPath : `${idOrPath}.jsonl`);
    const resolved = path.resolve(full);
    const root = path.resolve(dir);
    const rootNorm = root.replace(/\\/g, "/").toLowerCase();
    const fileNorm = resolved.replace(/\\/g, "/").toLowerCase();
    const prefix = rootNorm.endsWith("/") ? rootNorm : `${rootNorm}/`;
    if (fileNorm !== rootNorm && !fileNorm.startsWith(prefix)) {
      throw new Error("session path escapes sessions directory");
    }
    if (!fileNorm.endsWith(".jsonl")) {
      throw new Error("not a session file");
    }
    if (!fs.existsSync(resolved)) return false;
    fs.unlinkSync(resolved);
    return true;
  }

  private loadSessionFile(sessionFile: string): void {
    this.sessionFile = path.resolve(sessionFile);
    this.fileEntries = loadEntriesFromFile(this.sessionFile);
    if (this.fileEntries.length === 0) {
      this.newSession({ fileName: path.basename(this.sessionFile) });
      this.sessionFile = path.resolve(sessionFile);
      this.rewriteFile();
      return;
    }
    const header = this.fileEntries.find((entry) => entry.type === "session") as SessionHeader | undefined;
    const needsMigrate =
      !header
      || (header.version ?? 1) < CURRENT_SESSION_VERSION
      || this.fileEntries.some((entry) => isLegacyFileEntry(entry));
    if (migrateToCurrentVersion(this.fileEntries, header?.cwd || this.cwd) || needsMigrate) {
      this.rewriteFile();
    }
    const nextHeader = this.fileEntries.find((entry) => entry.type === "session") as SessionHeader | undefined;
    this.sessionId = nextHeader?.id ?? createSessionUuid();
    if (nextHeader?.cwd) this.cwd = path.resolve(nextHeader.cwd);
    this.rebuildIndex();
  }

  private rebuildIndex(): void {
    this.byId.clear();
    this.labelsById.clear();
    this.labelTimestampsById.clear();
    this.leafId = null;
    for (const entry of this.fileEntries) {
      if (entry.type === "session") continue;
      this.byId.set(entry.id, entry);
      this.leafId = entry.id;
      if (entry.type === "label") {
        if (entry.label) {
          this.labelsById.set(entry.targetId, entry.label);
          this.labelTimestampsById.set(entry.targetId, entry.timestamp);
        } else {
          this.labelsById.delete(entry.targetId);
          this.labelTimestampsById.delete(entry.targetId);
        }
      }
    }
  }

  private appendEntry(entry: SessionEntry): void {
    this.fileEntries.push(entry);
    this.byId.set(entry.id, entry);
    this.leafId = entry.id;
    if (this.persist && this.sessionFile) {
      fs.mkdirSync(path.dirname(this.sessionFile), { recursive: true });
      fs.appendFileSync(this.sessionFile, `${JSON.stringify(entry)}\n`);
    }
  }

  private rewriteFile(): void {
    if (!this.persist || !this.sessionFile) return;
    fs.mkdirSync(path.dirname(this.sessionFile), { recursive: true });
    const body = this.fileEntries.map((entry) => `${JSON.stringify(entry)}\n`).join("");
    fs.writeFileSync(this.sessionFile, body);
  }
}
