/**
 * 插件市场：查询 pi 生态包（pi.dev/packages 的数据源）+ 卸载。
 *
 * pi 生态包在 npm 上以 `pi-package` keyword 标记（pi.dev/packages
 * 聚合的就是这部分），因此查询直接走 npm registry search API：
 *   GET https://registry.npmjs.org/-/v1/search?text=keywords:pi-package <query>
 * 返回带月下载量。安装复用 packages.ts 的 installNpmPackageToAgent。
 */

import fs from "node:fs";
import path from "node:path";
import {
  agentNpmPackagesDir,
  installedPackageRoot,
  runPackageCommand,
} from "./packages.ts";

/** 市场包条目（UI 投影） */
export interface PiPackageView {
  name: string;
  version?: string;
  description?: string;
  author?: string;
  /** 月下载量 */
  monthlyDownloads?: number;
  /** 最近发布/更新时间（ISO） */
  updatedAt?: string;
  /** npm keywords（含 pi-package 标记，UI 展示时自行过滤） */
  keywords?: string[];
  npmUrl?: string;
}

export interface PiPackageRow extends PiPackageView {
  installed: boolean;
}

/** 分页查询结果：packages 为当前页，total 为 registry 报告的总匹配数 */
export interface PiPackageSearchResult {
  packages: PiPackageView[];
  total: number;
}

const NPM_SEARCH_ENDPOINT = "https://registry.npmjs.org/-/v1/search";
const SEARCH_TIMEOUT_MS = 10_000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** npm 包名合法性（含 @scope/ 形态）；拒绝路径穿越 */
export function isValidNpmPackageName(name: string): boolean {
  return /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i.test(name.trim());
}

/** 把 npm search 响应映射为市场条目（独立导出便于单测） */
export function mapNpmSearchPayload(payload: unknown): PiPackageView[] {
  if (typeof payload !== "object" || payload === null) return [];
  const objects = (payload as { objects?: unknown }).objects;
  if (!Array.isArray(objects)) return [];
  const rows: PiPackageView[] = [];
  for (const item of objects) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as {
      package?: {
        name?: unknown;
        version?: unknown;
        description?: unknown;
        publisher?: { name?: unknown };
        links?: { npm?: unknown };
        date?: unknown;
        keywords?: unknown;
      };
      downloads?: { monthly?: unknown };
    };
    const pkg = raw.package ?? {};
    if (typeof pkg.name !== "string" || !pkg.name.trim()) continue;
    const row: PiPackageView = { name: pkg.name.trim() };
    if (typeof pkg.version === "string") row.version = pkg.version;
    if (typeof pkg.description === "string" && pkg.description.trim()) {
      row.description = pkg.description.trim().slice(0, 200);
    }
    if (typeof pkg.publisher?.name === "string" && pkg.publisher.name.trim()) {
      row.author = pkg.publisher.name.trim();
    }
    if (typeof raw.downloads?.monthly === "number") row.monthlyDownloads = raw.downloads.monthly;
    if (typeof pkg.date === "string") row.updatedAt = pkg.date;
    if (Array.isArray(pkg.keywords)) {
      const keywords = pkg.keywords.filter((k): k is string => typeof k === "string" && k.trim().length > 0);
      if (keywords.length) row.keywords = keywords.slice(0, 8);
    }
    if (typeof pkg.links?.npm === "string") row.npmUrl = pkg.links.npm;
    rows.push(row);
  }
  return rows;
}

/** 解析 registry total：非法值回退为「当前页末尾」，保证 UI 还能尝试翻页 */
function normalizeTotal(payload: unknown, fallback: number): number {
  const total = (payload as { total?: unknown })?.total;
  if (typeof total === "number" && Number.isFinite(total) && total >= 0) return Math.ceil(total);
  return fallback;
}

/** 查询 pi 生态包（keywords:pi-package + 可选关键词），按相关性排序，支持分页 */
export async function searchPiPackages(
  opts: { query?: string; limit?: number; from?: number } = {},
): Promise<PiPackageSearchResult> {
  const query = opts.query?.trim();
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const from = Math.max(Math.floor(opts.from ?? 0), 0);
  const text = ["keywords:pi-package", query].filter(Boolean).join(" ");
  const url = `${NPM_SEARCH_ENDPOINT}?text=${encodeURIComponent(text)}&size=${limit}&from=${from}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`npm registry 查询失败（HTTP ${res.status}）`);
    const payload = await res.json().catch(() => null);
    const packages = mapNpmSearchPayload(payload);
    // npm 的 total 是分数下限（非精确值）：取两者较大值，避免“还有更多”被误判为没有
    return { packages, total: Math.max(normalizeTotal(payload, from + packages.length), from + packages.length) };
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`npm registry 查询超时（${SEARCH_TIMEOUT_MS / 1000}s）`);
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    clearTimeout(timer);
  }
}

/** 已安装插件条目（扫描 npm-packages/node_modules） */
export interface InstalledPiPackage {
  name: string;
  version?: string;
  description?: string;
}

/** 列出 ~/.aluka/agent/npm-packages 下已安装的包（含 @scope 两级结构） */
export function listInstalledPiPackages(agentDir: string): InstalledPiPackage[] {
  const nm = path.join(agentNpmPackagesDir(agentDir), "node_modules");
  if (!fs.existsSync(nm)) return [];
  const out: InstalledPiPackage[] = [];
  const readEntry = (dir: string) => {
    const pj = path.join(dir, "package.json");
    if (!fs.existsSync(pj)) return;
    try {
      const meta = JSON.parse(fs.readFileSync(pj, "utf8")) as {
        name?: unknown;
        version?: unknown;
        description?: unknown;
      };
      if (typeof meta.name !== "string" || !meta.name.trim()) return;
      out.push({
        name: meta.name.trim(),
        ...(typeof meta.version === "string" ? { version: meta.version } : {}),
        ...(typeof meta.description === "string" && meta.description.trim()
          ? { description: meta.description.trim().slice(0, 200) }
          : {}),
      });
    } catch {
      // 坏 package.json 跳过
    }
  };
  const dirents = fs.readdirSync(nm, { withFileTypes: true });
  for (const entry of dirents) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.startsWith("@")) continue;
    readEntry(path.join(nm, entry.name));
  }
  for (const scope of dirents) {
    if (!scope.isDirectory() || !scope.name.startsWith("@")) continue;
    for (const sub of fs.readdirSync(path.join(nm, scope.name), { withFileTypes: true })) {
      if (!sub.isDirectory() || sub.name.startsWith(".")) continue;
      readEntry(path.join(nm, scope.name, sub.name));
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export type RemovePackageOutcome =
  | { ok: true; packageName: string; log?: string }
  | { ok: false; packageName: string; error: string; log?: string };

/**
 * 从 ~/.aluka/agent/npm-packages 卸载包。
 * 先 `npm uninstall`（保持 package.json 一致），失败或残留则直接删除目录兜底。
 */
export async function removeNpmPackageFromAgent(opts: {
  agentDir: string;
  packageName: string;
}): Promise<RemovePackageOutcome> {
  const name = opts.packageName.trim();
  if (!isValidNpmPackageName(name)) {
    return { ok: false, packageName: name, error: `非法包名：${name}` };
  }
  const installDir = agentNpmPackagesDir(opts.agentDir);
  const pkgRoot = installedPackageRoot(installDir, name);
  if (!fs.existsSync(pkgRoot)) {
    return { ok: false, packageName: name, error: `未安装：${name}` };
  }

  const result = await runPackageCommand("npm", ["uninstall", name, "--no-fund", "--no-audit"], installDir);
  if (result.code !== 0 || fs.existsSync(pkgRoot)) {
    // npm 卸载失败或目录残留 → 强制删除兜底
    try {
      fs.rmSync(pkgRoot, { recursive: true, force: true });
    } catch (err) {
      return {
        ok: false,
        packageName: name,
        error: `卸载失败：${err instanceof Error ? err.message : String(err)}`,
        log: result.log.slice(-3000),
      };
    }
  }
  if (fs.existsSync(pkgRoot)) {
    return { ok: false, packageName: name, error: "卸载后目录仍存在", log: result.log.slice(-3000) };
  }
  return { ok: true, packageName: name, log: result.log.slice(-2000) };
}
