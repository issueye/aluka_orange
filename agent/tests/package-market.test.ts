import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isValidNpmPackageName,
  listInstalledPiPackages,
  mapNpmSearchPayload,
  removeNpmPackageFromAgent,
} from "../src/desktop/package-market.ts";
import { agentNpmPackagesDir } from "../src/desktop/packages.ts";

describe("包名校验", () => {
  it("接受合法 npm 包名（含 scope）", () => {
    expect(isValidNpmPackageName("pi-mcp-adapter")).toBe(true);
    expect(isValidNpmPackageName("@vigolium/piolium")).toBe(true);
    expect(isValidNpmPackageName("pi-web-access@0.24.0".split("@")[0]!)).toBe(true);
  });

  it("拒绝路径穿越与非法形态", () => {
    expect(isValidNpmPackageName("../evil")).toBe(false);
    expect(isValidNpmPackageName("a/b/c")).toBe(false);
    expect(isValidNpmPackageName("")).toBe(false);
    expect(isValidNpmPackageName("has space")).toBe(false);
    expect(isValidNpmPackageName(".hidden-start")).toBe(false);
  });
});

describe("npm search 响应映射", () => {
  it("映射名称/版本/作者/下载量/关键词，跳过无名条目", () => {
    const rows = mapNpmSearchPayload({
      objects: [
        {
          package: {
            name: "pi-mcp-adapter",
            version: "2.26.1",
            description: "MCP adapter extension for Pi coding agent",
            publisher: { name: "nicopreme" },
            links: { npm: "https://www.npmjs.com/package/pi-mcp-adapter" },
            date: "2026-08-18T00:00:00.000Z",
            keywords: ["pi-package", "mcp", "adapter", "", 42],
          },
          downloads: { monthly: 454500 },
        },
        { package: { description: "no name" } },
        null,
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "pi-mcp-adapter",
      version: "2.26.1",
      author: "nicopreme",
      monthlyDownloads: 454500,
      npmUrl: "https://www.npmjs.com/package/pi-mcp-adapter",
      keywords: ["pi-package", "mcp", "adapter"],
    });
  });

  it("空/畸形响应返回空数组", () => {
    expect(mapNpmSearchPayload(null)).toEqual([]);
    expect(mapNpmSearchPayload({})).toEqual([]);
    expect(mapNpmSearchPayload({ objects: "not-array" })).toEqual([]);
  });
});

describe("卸载", () => {
  function tmpAgentDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "aluka-pkg-market-"));
  }

  it("非法包名直接拒绝", async () => {
    const outcome = await removeNpmPackageFromAgent({ agentDir: tmpAgentDir(), packageName: "../evil" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("非法包名");
  });

  it("未安装的包返回未安装", async () => {
    const agentDir = tmpAgentDir();
    fs.mkdirSync(agentNpmPackagesDir(agentDir), { recursive: true });
    const outcome = await removeNpmPackageFromAgent({ agentDir, packageName: "pi-not-installed" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("未安装");
  });
});

describe("已安装插件扫描", () => {
  it("列出普通包与 @scope 包，跳过隐藏目录与坏 package.json", () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-pkg-list-"));
    const nm = path.join(agentNpmPackagesDir(agentDir), "node_modules");
    fs.mkdirSync(path.join(nm, "pi-demo"), { recursive: true });
    fs.writeFileSync(
      path.join(nm, "pi-demo", "package.json"),
      JSON.stringify({ name: "pi-demo", version: "1.0.0", description: "demo pkg" }),
    );
    fs.mkdirSync(path.join(nm, "@scope", "tool"), { recursive: true });
    fs.writeFileSync(
      path.join(nm, "@scope", "tool", "package.json"),
      JSON.stringify({ name: "@scope/tool", version: "0.2.0" }),
    );
    fs.mkdirSync(path.join(nm, ".pnpm"), { recursive: true });
    fs.mkdirSync(path.join(nm, "broken"), { recursive: true });
    fs.writeFileSync(path.join(nm, "broken", "package.json"), "{ not json");

    const rows = listInstalledPiPackages(agentDir);
    expect(rows.map((r) => r.name)).toEqual(["@scope/tool", "pi-demo"]);
    expect(rows[1]).toMatchObject({ name: "pi-demo", version: "1.0.0", description: "demo pkg" });
  });

  it("目录不存在时返回空数组", () => {
    expect(listInstalledPiPackages(fs.mkdtempSync(path.join(os.tmpdir(), "aluka-pkg-empty-")))).toEqual([]);
  });
});
