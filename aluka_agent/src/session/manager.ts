/**
 * 会话管理模块
 *
 * 负责对话会话的持久化存储和管理。
 * 使用 JSONL (JSON Lines) 格式存储会话记录，每行一个 JSON 对象。
 * 支持创建新会话、恢复最近会话、追加会话条目等操作。
 */

import fs from "node:fs";
import path from "node:path";

/** 会话条目接口 */
export interface SessionEntry {
  /** 条目唯一 ID */
  id: string;
  /** 条目类型（如 "user"、"turn"、"custom"） */
  type: string;
  /** 创建时间戳 */
  timestamp: number;
  /** 扩展属性 */
  [key: string]: unknown;
}

/** 会话列表摘要 */
export interface SessionSummary {
  id: string;
  file: string;
  title: string;
  mtime: number;
  ctime: number;
}

function deriveSessionTitle(file: string, fallback: string): string {
  try {
    if (!fs.existsSync(file)) return fallback;
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      const entry = JSON.parse(line) as SessionEntry;
      if (entry.type === "user" && typeof entry.text === "string" && entry.text.trim()) {
        const text = entry.text.trim().replace(/\s+/g, " ");
        return text.length > 48 ? `${text.slice(0, 48)}…` : text;
      }
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

/**
 * 会话管理器
 *
 * 管理单个会话文件的读写操作。
 * 每个会话对应一个 .jsonl 文件。
 */
export class SessionManager {
  /** 会话文件路径 */
  readonly file: string;
  /** 内存中的会话条目列表 */
  private entries: SessionEntry[] = [];

  constructor(file: string) {
    this.file = file;
    this.load();
  }

  /**
   * 创建新会话
   * @param dir - 会话存储目录
   * @param name - 会话文件名，默认使用时间戳命名
   */
  static create(dir: string, name = `session-${Date.now()}.jsonl`): SessionManager {
    fs.mkdirSync(dir, { recursive: true });
    return new SessionManager(path.join(dir, name));
  }

  /**
   * 获取最近的会话
   * 按文件修改时间排序，返回最新的会话
   */
  static latest(dir: string): SessionManager | undefined {
    const listed = SessionManager.list(dir);
    if (!listed[0]) return undefined;
    return new SessionManager(listed[0].file);
  }

  /**
   * 列出目录中的会话（按 mtime 新→旧）
   */
  static list(dir: string): SessionSummary[] {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((file) => file.endsWith(".jsonl"))
      .map((file) => {
        const full = path.join(dir, file);
        const st = fs.statSync(full);
        const id = file.replace(/\.jsonl$/i, "");
        return {
          id,
          file: full,
          title: deriveSessionTitle(full, id),
          mtime: st.mtimeMs,
          ctime: st.birthtimeMs || st.ctimeMs,
        };
      })
      .sort((a, b) => b.mtime - a.mtime);
  }

  /**
   * 按会话 id 或绝对路径打开
   */
  static open(dir: string, idOrPath: string): SessionManager {
    const full = path.isAbsolute(idOrPath)
      ? idOrPath
      : path.join(dir, idOrPath.endsWith(".jsonl") ? idOrPath : `${idOrPath}.jsonl`);
    if (!fs.existsSync(full)) {
      throw new Error(`session not found: ${idOrPath}`);
    }
    return new SessionManager(full);
  }

  /** 会话 id（文件名去扩展名） */
  get id(): string {
    return path.basename(this.file, ".jsonl");
  }

  /** 从文件加载会话条目 */
  private load(): void {
    if (!fs.existsSync(this.file)) return;
    const lines = fs.readFileSync(this.file, "utf8").split(/\r?\n/).filter(Boolean);
    this.entries = lines.map((line) => JSON.parse(line) as SessionEntry);
  }

  /** 获取所有会话条目的副本 */
  getEntries(): SessionEntry[] {
    return [...this.entries];
  }

  /**
   * 追加一个会话条目
   *
   * 自动补充 id 和 timestamp（如果未提供），
   * 并将条目追加到内存列表和文件末尾。
   *
   * @returns 完整的会话条目（包含生成的 id 和 timestamp）
   */
  append(entry: Omit<SessionEntry, "id" | "timestamp"> & Partial<Pick<SessionEntry, "id" | "timestamp">>): SessionEntry {
    const full: SessionEntry = {
      ...entry,
      id: entry.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timestamp: entry.timestamp ?? Date.now(),
      type: typeof entry.type === "string" ? entry.type : "entry",
    };
    this.entries.push(full);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, `${JSON.stringify(full)}\n`);
    return full;
  }
}
