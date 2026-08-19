/**
 * 搜索工具集
 *
 * 提供文件系统搜索相关的内置工具：
 * - lsTool: 列出目录内容
 * - findTool: 按名称模式查找文件
 * - grepTool: 按正则表达式搜索文件内容
 *
 * 所有搜索工具都会自动跳过 node_modules、.git、dist、.aluka 目录。
 */

import fs from "node:fs";
import path from "node:path";
import { Type } from "typebox";
import { defineTool } from "../extensions/types.ts";

/**
 * 目录列表工具
 *
 * 列出指定目录下的所有文件和子目录，
 * 以 "d 目录名" 或 "f 文件名" 的格式输出。
 */
export const lsTool = defineTool({
  name: "ls",
  label: "List",
  description: "List files in a directory.",
  promptSnippet: "List directory contents",
  parameters: Type.Object({
    path: Type.Optional(Type.String()),
  }),
  async execute(_id, params, _signal, _onUpdate, ctx) {
    const absolute = path.resolve(ctx.cwd, params.path ?? ".");
    const entries = fs.readdirSync(absolute, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "dir" : "file",
    }));
    const text = entries.map((entry) => `${entry.type === "dir" ? "d" : "f"} ${entry.name}`).join("\n");
    return { content: [{ type: "text", text: text || "(empty)" }], details: { count: entries.length } };
  },
});

/**
 * 文件查找工具
 *
 * 按文件名的子串匹配或 glob 模式查找文件。
 * 递归遍历目录，最多返回 200 个结果。
 */
export const findTool = defineTool({
  name: "find",
  label: "Find",
  description: "Find files by glob-like name pattern (substring match).",
  promptSnippet: "Find files by name",
  parameters: Type.Object({
    pattern: Type.String(),
    path: Type.Optional(Type.String()),
  }),
  async execute(_id, params, _signal, _onUpdate, ctx) {
    const root = path.resolve(ctx.cwd, params.path ?? ".");
    const hits: string[] = [];
    walk(root, ctx.cwd, params.pattern, hits, 200);
    return {
      content: [{ type: "text", text: hits.join("\n") || "(no matches)" }],
      details: { count: hits.length },
    };
  },
});

/**
 * 内容搜索工具（grep）
 *
 * 使用正则表达式搜索文件内容。
 * 支持可选的 glob 过滤（按文件名匹配）。
 * 每个匹配输出 "文件路径:行号:匹配行内容"。
 */
export const grepTool = defineTool({
  name: "grep",
  label: "Grep",
  description: "Search file contents with a regular expression.",
  promptSnippet: "Search code with regex",
  parameters: Type.Object({
    pattern: Type.String(),
    path: Type.Optional(Type.String()),
    glob: Type.Optional(Type.String()),
  }),
  async execute(_id, params, _signal, _onUpdate, ctx) {
    const root = path.resolve(ctx.cwd, params.path ?? ".");
    const regex = new RegExp(params.pattern);
    const hits: string[] = [];
    grepWalk(root, ctx.cwd, regex, params.glob, hits, 200);
    return {
      content: [{ type: "text", text: hits.join("\n") || "(no matches)" }],
      details: { count: hits.length },
    };
  },
});

/**
 * 递归遍历目录查找文件名匹配的文件
 *
 * @param dir - 当前遍历的目录
 * @param cwd - 工作目录（用于生成相对路径）
 * @param pattern - 文件名匹配模式（子串或 glob）
 * @param hits - 匹配结果收集数组
 * @param limit - 最大结果数
 */
function walk(dir: string, cwd: string, pattern: string, hits: string[], limit: number): void {
  if (hits.length >= limit || shouldSkip(dir)) return;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (hits.length >= limit) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, cwd, pattern, hits, limit);
    else if (entry.name.includes(pattern) || matchGlob(entry.name, pattern)) {
      hits.push(path.relative(cwd, full) || entry.name);
    }
  }
}

/**
 * 递归搜索文件内容
 *
 * 逐行匹配正则表达式，支持 glob 过滤和文本文件类型检测。
 */
function grepWalk(
  dir: string,
  cwd: string,
  regex: RegExp,
  glob: string | undefined,
  hits: string[],
  limit: number,
): void {
  if (hits.length >= limit || shouldSkip(dir)) return;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (hits.length >= limit) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      grepWalk(full, cwd, regex, glob, hits, limit);
      continue;
    }
    // 跳过不匹配 glob 的文件
    if (glob && !matchGlob(entry.name, glob)) continue;
    // 只搜索已知的文本文件类型
    if (!isTextFile(entry.name)) continue;
    let content = "";
    try {
      content = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index++) {
      if (hits.length >= limit) return;
      if (regex.test(lines[index])) {
        hits.push(`${path.relative(cwd, full)}:${index + 1}:${lines[index].slice(0, 240)}`);
      }
    }
  }
}

/**
 * 判断是否应跳过该目录
 * 自动跳过 node_modules、.git、dist、.aluka 等大型或无关目录
 */
function shouldSkip(dir: string): boolean {
  const base = path.basename(dir);
  return base === "node_modules" || base === ".git" || base === "dist" || base === ".aluka";
}

/**
 * glob 模式匹配
 * 支持 "*" 通配符（转换为正则 .*），
 * 无通配符时退化为子串匹配
 */
function matchGlob(name: string, pattern: string): boolean {
  if (!pattern.includes("*")) return name.includes(pattern);
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(name);
}

/**
 * 判断是否为文本文件
 * 根据文件扩展名判断，支持常见的代码和配置文件类型
 */
function isTextFile(name: string): boolean {
  return /\.(ts|tsx|js|jsx|json|md|txt|css|html|yml|yaml|toml|py|go|rs|java|c|h|cpp|vue|svelte)$/i.test(name);
}
