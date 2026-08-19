/**
 * 将 npm / file: 包安装到 ~/.aluka/agent/npm-packages，并解析扩展入口。
 * 包装 `aluka install <spec>`（优先）或 `npm install <spec>`。
 *
 * 边界（见 README）：
 * - 包必须导出 pi/aluka 扩展 default 工厂，或提供 index.ts/js / package.json main
 * - 需要本机网络（registry）或 file: 本地路径
 * - 打包 exe 内 jiti 动态加载可能仍受限
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  resolveExtensionEntries,
  resolveExtensionEntry,
} from "../extensions/package-paths.ts";

export { resolveExtensionEntries, resolveExtensionEntry };

export interface InstallNpmPackageResult {
  ok: true;
  spec: string;
  packageName: string;
  entryPath: string;
  installDir: string;
  runner: string;
  log: string;
}

export interface InstallNpmPackageError {
  ok: false;
  spec: string;
  error: string;
  log?: string;
}

export type InstallNpmPackageOutcome = InstallNpmPackageResult | InstallNpmPackageError;

export function agentNpmPackagesDir(agentDir: string): string {
  return path.join(agentDir, "npm-packages");
}

/** 从 npm spec 提取包名（去掉版本 / tag） */
export function packageNameFromSpec(spec: string): string {
  const trimmed = spec.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("file:")) {
    const target = trimmed.slice("file:".length);
    const base = path.basename(path.resolve(target));
    return base || trimmed;
  }
  if (trimmed.startsWith("@")) {
    const m = trimmed.match(/^(@[^/]+\/[^@]+)(?:@.+)?$/);
    return m?.[1] ?? trimmed;
  }
  const at = trimmed.indexOf("@", 1);
  return at === -1 ? trimmed : trimmed.slice(0, at);
}

function ensurePackageJson(installDir: string): void {
  fs.mkdirSync(installDir, { recursive: true });
  const pj = path.join(installDir, "package.json");
  if (!fs.existsSync(pj)) {
    fs.writeFileSync(
      pj,
      `${JSON.stringify({ name: "aluka-agent-npm-packages", private: true, version: "0.0.0" }, null, 2)}\n`,
    );
  }
}

function resolveInstalledPackageRoot(installDir: string, packageName: string): string | undefined {
  const parts = packageName.startsWith("@") ? packageName.split("/") : [packageName];
  const root = path.join(installDir, "node_modules", ...parts);
  if (fs.existsSync(root)) return root;
  return undefined;
}

function resolveRunner(explicit?: string): { cmd: string; kind: "aluka" | "npm" } {
  if (explicit === "npm") return { cmd: "npm", kind: "npm" };
  if (explicit === "aluka") {
    const fromEnv = process.env.ALUKA?.trim();
    return { cmd: fromEnv && fs.existsSync(fromEnv) ? fromEnv : "aluka", kind: "aluka" };
  }
  const fromEnv = process.env.ALUKA?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return { cmd: fromEnv, kind: "aluka" };
  return { cmd: "aluka", kind: "aluka" };
}

function runCommand(cmd: string, args: string[], cwd: string): Promise<{ code: number; log: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: process.env,
      shell: process.platform === "win32",
      windowsHide: true,
    });
    let log = "";
    child.stdout?.on("data", (chunk) => {
      log += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      log += String(chunk);
    });
    child.on("error", (err) => {
      resolve({ code: 1, log: `${log}\n${err.message}` });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, log });
    });
  });
}

export async function installNpmPackageToAgent(opts: {
  agentDir: string;
  spec: string;
  /** auto：优先 ALUKA/aluka，失败可再试 npm（由调用方决定）；此处只跑一次 */
  runner?: "auto" | "aluka" | "npm";
}): Promise<InstallNpmPackageOutcome> {
  const spec = opts.spec.trim();
  if (!spec) return { ok: false, spec, error: "missing package spec" };

  const installDir = agentNpmPackagesDir(opts.agentDir);
  ensurePackageJson(installDir);
  const packageName = packageNameFromSpec(spec);
  if (!packageName) return { ok: false, spec, error: "cannot parse package name from spec" };

  const prefer = opts.runner === "npm" ? "npm" : opts.runner === "aluka" ? "aluka" : "auto";
  const attempts: Array<{ cmd: string; kind: "aluka" | "npm"; args: string[] }> = [];
  if (prefer === "npm") {
    attempts.push({ cmd: "npm", kind: "npm", args: ["install", spec, "--no-fund", "--no-audit"] });
  } else if (prefer === "aluka") {
    const r = resolveRunner("aluka");
    attempts.push({ cmd: r.cmd, kind: "aluka", args: ["install", spec] });
  } else {
    const r = resolveRunner("auto");
    attempts.push({ cmd: r.cmd, kind: "aluka", args: ["install", spec] });
    attempts.push({ cmd: "npm", kind: "npm", args: ["install", spec, "--no-fund", "--no-audit"] });
  }

  let lastLog = "";
  let used: { kind: "aluka" | "npm"; cmd: string } | undefined;
  for (const attempt of attempts) {
    const result = await runCommand(attempt.cmd, attempt.args, installDir);
    lastLog = result.log;
    if (result.code === 0) {
      used = { kind: attempt.kind, cmd: attempt.cmd };
      break;
    }
    // auto 模式下 aluka 失败则继续试 npm
    if (prefer !== "auto") {
      return {
        ok: false,
        spec,
        error: `${attempt.kind} install failed (exit ${result.code})`,
        log: result.log.slice(-4000),
      };
    }
  }
  if (!used) {
    return { ok: false, spec, error: "aluka/npm install failed", log: lastLog.slice(-4000) };
  }

  const pkgRoot = resolveInstalledPackageRoot(installDir, packageName);
  if (!pkgRoot) {
    // file: 安装后目录名可能是 basename；再扫一层
    const nm = path.join(installDir, "node_modules");
    if (fs.existsSync(nm)) {
      // scoped or flat
    }
    return {
      ok: false,
      spec,
      error: `installed but package root not found for ${packageName}`,
      log: lastLog.slice(-4000),
    };
  }
  const entryPath = resolveExtensionEntry(pkgRoot);
  if (!entryPath) {
    return {
      ok: false,
      spec,
      error: `no extension entry in ${pkgRoot} (need index.ts/js or package.json main / pi.extensions / aluka.extension)`,
      log: lastLog.slice(-4000),
    };
  }
  return {
    ok: true,
    spec,
    packageName,
    entryPath,
    installDir,
    runner: used.kind,
    log: lastLog.slice(-2000),
  };
}
