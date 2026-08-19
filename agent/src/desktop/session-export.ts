/**
 * 会话导出：json / markdown / jsonl（写到 agentDir/exports，不依赖系统另存对话框）。
 */

import fs from "node:fs";
import path from "node:path";
import type { SessionEntry } from "../session/manager.ts";
import { SessionManager } from "../session/manager.ts";
import { textFrom, type AgentMessage } from "../agent/types.ts";

export type SessionExportFormat = "json" | "markdown" | "jsonl";

export interface SessionExportResult {
  ok: true;
  format: SessionExportFormat;
  sessionId: string;
  path: string;
  bytes: number;
}

export interface SessionExportError {
  ok: false;
  error: string;
}

export type SessionExportOutcome = SessionExportResult | SessionExportError;

function safeName(id: string): string {
  return id.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 80) || "session";
}

function entryUserText(entry: SessionEntry): string | undefined {
  if (entry.type === "user" && typeof entry.text === "string") return entry.text;
  return undefined;
}

function messagesFromTurn(entry: SessionEntry): AgentMessage[] {
  if (entry.type !== "turn" || !Array.isArray(entry.messages)) return [];
  return entry.messages as AgentMessage[];
}

export function renderSessionMarkdown(sessionId: string, entries: SessionEntry[]): string {
  const lines: string[] = [`# Session ${sessionId}`, "", `Exported: ${new Date().toISOString()}`, ""];
  for (const entry of entries) {
    const user = entryUserText(entry);
    if (user) {
      lines.push(`## User`, "", user, "");
      continue;
    }
    for (const message of messagesFromTurn(entry)) {
      if (message.role === "assistant") {
        lines.push(`## Assistant`, "", textFrom(message) || "(empty)", "");
      } else if (message.role === "toolResult") {
        lines.push(`### Tool · ${message.toolName ?? "tool"}`, "", "```", textFrom(message) || "", "```", "");
      } else if (message.role === "user") {
        lines.push(`## User`, "", textFrom(message), "");
      }
    }
  }
  return `${lines.join("\n").trim()}\n`;
}

export function renderSessionJson(sessionId: string, file: string, entries: SessionEntry[]): string {
  return `${JSON.stringify(
    {
      version: 1,
      sessionId,
      sourceFile: file,
      exportedAt: new Date().toISOString(),
      entries,
    },
    null,
    2,
  )}\n`;
}

export function exportSessionToDir(opts: {
  sessionsDir: string;
  exportDir: string;
  sessionId: string;
  format: SessionExportFormat;
}): SessionExportOutcome {
  try {
    const session = SessionManager.open(opts.sessionsDir, opts.sessionId);
    const entries = session.getEntries();
    fs.mkdirSync(opts.exportDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = `${safeName(session.id)}-${stamp}`;
    let filename: string;
    let body: string;
    if (opts.format === "markdown") {
      filename = `${base}.md`;
      body = renderSessionMarkdown(session.id, entries);
    } else if (opts.format === "jsonl") {
      filename = `${base}.jsonl`;
      body = entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : "");
    } else {
      filename = `${base}.json`;
      body = renderSessionJson(session.id, session.file, entries);
    }
    const out = path.join(opts.exportDir, filename);
    fs.writeFileSync(out, body, "utf8");
    return {
      ok: true,
      format: opts.format,
      sessionId: session.id,
      path: out,
      bytes: Buffer.byteLength(body, "utf8"),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
