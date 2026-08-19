/**
 * 跟踪 Agent 拉起的子进程，退出/中止时按进程树清掉，
 * 避免 Windows 上 cmd.exe 残留导致主进程关不掉。
 */

import { spawn, type ChildProcess } from "node:child_process";

const children = new Set<ChildProcess>();

export function trackChild(child: ChildProcess): ChildProcess {
  children.add(child);
  const forget = () => children.delete(child);
  child.once("exit", forget);
  child.once("close", forget);
  child.once("error", forget);
  return child;
}

export function trackedChildCount(): number {
  return children.size;
}

export function killProcessTree(pid?: number): void {
  if (!pid || pid <= 0) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    }).unref();
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* already gone */
  }
}

export function killTrackedChildren(): void {
  for (const child of [...children]) {
    killProcessTree(child.pid);
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    children.delete(child);
  }
}
