/**
 * 桌面工作区：路径规范化、临时目录、侧栏分组。
 * 会话仍按 cwd 哈希分目录存储；此处只维护「已知工作区」列表。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** 临时工作区目录名前缀（mkdtempSync） */
export const TEMP_WORKSPACE_PREFIX = "aluka-ws-";

export function samePath(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export function isTemporaryWorkspace(dir: string): boolean {
  const resolved = path.resolve(dir);
  const tmp = path.resolve(os.tmpdir());
  const relative = path.relative(tmp, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return false;
  return path.basename(resolved).startsWith(TEMP_WORKSPACE_PREFIX);
}

export function createTemporaryWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), TEMP_WORKSPACE_PREFIX));
}

export function ensureWorkspaceDir(dir: string): string {
  const resolved = path.resolve(dir);
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

export function workspaceDisplayName(dir: string): string {
  const resolved = path.resolve(dir);
  if (isTemporaryWorkspace(resolved)) {
    const suffix = path.basename(resolved).replace(new RegExp(`^${TEMP_WORKSPACE_PREFIX}`), "").slice(0, 6);
    return suffix ? `临时工作区 · ${suffix}` : "临时工作区";
  }
  const base = path.basename(resolved);
  return base || resolved;
}

export function normalizeWorkspaceList(paths: Array<string | undefined>, current?: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...paths, current]) {
    if (!raw || !String(raw).trim()) continue;
    const resolved = path.resolve(String(raw).trim());
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolved);
  }
  return out;
}

export function rememberWorkspace(list: string[], dir: string): string[] {
  return normalizeWorkspaceList([dir, ...list], dir);
}

export function forgetWorkspace(list: string[], dir: string): string[] {
  return list.filter((item) => !samePath(item, dir));
}
