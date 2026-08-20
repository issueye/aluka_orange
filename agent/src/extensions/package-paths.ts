/**
 * 解析 aluka 扩展包入口，并发现 settings.packages 中的 npm:/git: 包。
 *
 * 目录布局（均在 Aluka 自己的 agentDir 下，不扫描 ~/.pi）：
 * - ~/.aluka/agent/settings.json → packages: ["npm:foo", "git:github.com/org/repo"]
 * - ~/.aluka/agent/npm/node_modules/<pkg>
 * - ~/.aluka/agent/npm-packages/node_modules/<pkg>
 * - ~/.aluka/agent/git/github.com/org/repo
 * - package.json → pi.extensions[] / aluka.extensions[]（亦可单数字段 extension）
 */

import fs from "node:fs";
import path from "node:path";
import { getAgentDir } from "../config.ts";

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function pushRel(candidates: string[], value: unknown): void {
  if (typeof value === "string" && value.trim()) {
    candidates.push(value.trim());
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.trim()) candidates.push(item.trim());
    }
  }
}

/**
 * 解析包根目录下的全部扩展入口文件。
 * 优先 package.json 的 aluka.extensions / pi.extensions（及单数 extension），
 * 再回退 main/module/exports["."] 与 index.*。
 */
export function resolveExtensionEntries(packageRoot: string): string[] {
  const pj = readJson(path.join(packageRoot, "package.json"));
  const candidates: string[] = [];
  if (pj) {
    for (const key of ["aluka", "pi"] as const) {
      const block = pj[key];
      if (block && typeof block === "object" && !Array.isArray(block)) {
        const rec = block as Record<string, unknown>;
        pushRel(candidates, rec.extensions);
        pushRel(candidates, rec.extension);
      }
    }
    for (const key of ["main", "module"] as const) {
      pushRel(candidates, pj[key]);
    }
    const exportsField = pj.exports;
    if (typeof exportsField === "string") {
      pushRel(candidates, exportsField);
    } else if (exportsField && typeof exportsField === "object" && !Array.isArray(exportsField)) {
      const root = (exportsField as Record<string, unknown>)["."];
      if (typeof root === "string") pushRel(candidates, root);
      else if (root && typeof root === "object" && !Array.isArray(root)) {
        const rec = root as Record<string, unknown>;
        for (const k of ["import", "require", "default"] as const) {
          pushRel(candidates, rec[k]);
        }
      }
    }
  }
  candidates.push("index.ts", "index.js", "index.mjs", "index.cjs");

  const out: string[] = [];
  const seen = new Set<string>();
  for (const rel of candidates) {
    const full = path.resolve(packageRoot, rel);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
    const key = full.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(full);
  }
  return out;
}

/** 兼容旧 API：返回第一个扩展入口 */
export function resolveExtensionEntry(packageRoot: string): string | undefined {
  return resolveExtensionEntries(packageRoot)[0];
}

/** npm 安装目录：pi 用 npm，aluka 桌面用 npm-packages */
export function agentNpmInstallDirs(agentDir: string): string[] {
  return [path.join(agentDir, "npm"), path.join(agentDir, "npm-packages")];
}

export function agentGitDir(agentDir: string): string {
  return path.join(agentDir, "git");
}

function resolveNpmPackageRoot(agentDir: string, packageName: string): string | undefined {
  const parts = packageName.startsWith("@") ? packageName.split("/") : [packageName];
  for (const installDir of agentNpmInstallDirs(agentDir)) {
    const root = path.join(installDir, "node_modules", ...parts);
    if (fs.existsSync(root) && fs.statSync(root).isDirectory()) return root;
  }
  return undefined;
}

function resolveGitPackageRoot(agentDir: string, gitPath: string): string | undefined {
  const cleaned = gitPath.replace(/^\/+/, "").replace(/\\/g, "/");
  const root = path.join(agentGitDir(agentDir), ...cleaned.split("/").filter(Boolean));
  if (fs.existsSync(root) && fs.statSync(root).isDirectory()) return root;
  return undefined;
}

/**
 * 将 packages[] 条目解析为包根目录。
 * 支持：npm:name、git:host/org/repo、绝对/相对路径、裸包名（在 npm 目录中查找）。
 */
export function resolvePackageRootFromSpec(spec: string, agentDirs: string[]): string | undefined {
  const trimmed = spec.trim();
  if (!trimmed) return undefined;

  if (trimmed.startsWith("npm:")) {
    const name = trimmed.slice("npm:".length).trim();
    if (!name) return undefined;
    for (const dir of agentDirs) {
      const root = resolveNpmPackageRoot(dir, name);
      if (root) return root;
    }
    return undefined;
  }

  if (trimmed.startsWith("git:")) {
    const gitPath = trimmed.slice("git:".length).trim();
    if (!gitPath) return undefined;
    for (const dir of agentDirs) {
      const root = resolveGitPackageRoot(dir, gitPath);
      if (root) return root;
    }
    return undefined;
  }

  if (path.isAbsolute(trimmed) || trimmed.startsWith(".") || trimmed.includes("/") || trimmed.includes("\\")) {
    const full = path.resolve(trimmed);
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) return full;
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return path.dirname(full);
    return undefined;
  }

  // 裸包名：当作已安装的 npm 包
  for (const dir of agentDirs) {
    const root = resolveNpmPackageRoot(dir, trimmed);
    if (root) return root;
  }
  return undefined;
}

function readPackagesList(file: string): string[] {
  const json = readJson(file);
  if (!json) return [];
  const packages = json.packages;
  if (!Array.isArray(packages)) return [];
  return packages.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

/**
 * 从 aluka settings 的 packages 字段发现扩展入口路径（不扫描 .pi 目录）。
 * @param agentDirs 可注入（测试）；默认 [~/.aluka/agent]
 */
export function discoverPackageExtensionPaths(options?: {
  cwd?: string;
  agentDirs?: string[];
}): string[] {
  const agentDirs = options?.agentDirs ?? [getAgentDir()];
  const cwd = options?.cwd ?? process.cwd();
  const settingsFiles = [
    ...agentDirs.map((d) => path.join(d, "settings.json")),
    path.join(cwd, ".aluka", "settings.json"),
  ];

  const specs: string[] = [];
  const seenSpec = new Set<string>();
  for (const file of settingsFiles) {
    for (const spec of readPackagesList(file)) {
      const key = spec.trim().toLowerCase();
      if (seenSpec.has(key)) continue;
      seenSpec.add(key);
      specs.push(spec.trim());
    }
  }

  const files: string[] = [];
  const seenFile = new Set<string>();
  for (const spec of specs) {
    const root = resolvePackageRootFromSpec(spec, agentDirs);
    if (!root) continue;
    for (const entry of resolveExtensionEntries(root)) {
      const key = entry.toLowerCase();
      if (seenFile.has(key)) continue;
      seenFile.add(key);
      files.push(entry);
    }
  }
  return files;
}
