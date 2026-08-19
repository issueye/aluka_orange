/**
 * 会话分享：导出 markdown → `gh gist create --public=false`。
 * 需要本机安装 GitHub CLI 并已 `gh auth login`。
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionManager } from "../session/manager.ts";
import { renderSessionMarkdown } from "./session-export.ts";

export interface SessionShareResult {
  ok: true;
  sessionId: string;
  gistUrl: string;
  gistId: string;
}

export interface SessionShareError {
  ok: false;
  error: string;
  log?: string;
}

export type SessionShareOutcome = SessionShareResult | SessionShareError;

function resolveGhCommand(): string {
  const fromEnv = process.env.GH_PATH?.trim() || process.env.ALUKA_GH?.trim();
  if (fromEnv) return fromEnv;
  return "gh";
}

function runGh(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string; missing?: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(resolveGhCommand(), args, {
      cwd,
      env: process.env,
      shell: process.platform === "win32",
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
      if (code === "ENOENT") {
        resolve({
          code: 1,
          stdout,
          stderr,
          missing: true,
        });
        return;
      }
      resolve({ code: 1, stdout, stderr: stderr || (err instanceof Error ? err.message : String(err)) });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function parseGistUrl(stdout: string): { gistUrl: string; gistId: string } | undefined {
  const token =
    stdout
      .trim()
      .split(/\s+/)
      .find((part) => /gist\.github\.com/i.test(part)) ?? stdout.trim().split(/\r?\n/).find((line) => /gist\.github\.com/i.test(line));
  if (!token) return undefined;
  const gistUrl = token.trim();
  const gistId = gistUrl.split("/").filter(Boolean).pop();
  if (!gistId) return undefined;
  return { gistUrl, gistId };
}

/** 纯解析：便于单测，不依赖 gh */
export function parseGhGistStdout(stdout: string): { gistUrl: string; gistId: string } | undefined {
  return parseGistUrl(stdout);
}

export async function shareSessionViaGh(opts: {
  sessionsDir: string;
  sessionId: string;
  /** 测试注入：跳过真实 gh */
  run?: typeof runGh;
}): Promise<SessionShareOutcome> {
  const run = opts.run ?? runGh;
  let tmpDir: string | undefined;
  try {
    const session = SessionManager.open(opts.sessionsDir, opts.sessionId);
    const entries = session.getEntries();
    if (!entries.length) {
      return { ok: false, error: "session is empty; nothing to share" };
    }
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-share-"));
    const file = path.join(tmpDir, `${session.id}.md`);
    fs.writeFileSync(file, renderSessionMarkdown(session.id, entries), "utf8");

    const result = await run(["gist", "create", "--public=false", file], tmpDir);
    if (result.missing) {
      return {
        ok: false,
        error: "GitHub CLI (gh) is not installed. Install from https://cli.github.com/ and run `gh auth login`.",
      };
    }
    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout).trim() || `exit ${result.code}`;
      return {
        ok: false,
        error: `gh gist create failed: ${detail}`,
        log: `${result.stdout}\n${result.stderr}`.slice(-2000),
      };
    }
    const parsed = parseGistUrl(result.stdout);
    if (!parsed) {
      return {
        ok: false,
        error: "failed to parse gist URL from gh output",
        log: result.stdout.slice(-1000),
      };
    }
    return {
      ok: true,
      sessionId: session.id,
      gistUrl: parsed.gistUrl,
      gistId: parsed.gistId,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}
