/**
 * 提示词模块
 *
 * 提示词（Prompt）是从 Markdown 文件加载的输入片段，
 * 供用户在对话输入框中手动插入后发送（与技能不同：不注入系统提示）。
 *
 * 提示词文件格式：
 * ---
 * name: 提示词名称
 * description: 提示词描述
 * ---
 * 提示词正文内容（Markdown）
 *
 * 只扫描 .aluka 目录（不扫描 .pi，保持 Aluka 独立）。
 */

import fs from "node:fs";
import path from "node:path";
import { getAgentDir } from "../config.ts";

/** 提示词文件的 frontmatter 字段 */
export interface PromptFrontmatter {
  name?: string;
  description?: string;
}

/** 提示词定义 */
export interface Prompt {
  /** 提示词名称（唯一标识） */
  name: string;
  description: string;
  /** 提示词文件路径 */
  path: string;
  /** 提示词正文（Markdown，插入输入框的内容） */
  body: string;
}

/**
 * 加载所有可用提示词
 *
 * 从以下目录搜索：
 * - {cwd}/.aluka/prompts/
 * - {home}/.aluka/agent/prompts/
 *
 * 同名提示词以后面的覆盖前面的
 */
export function loadPrompts(cwd: string): Prompt[] {
  const dirs = [
    path.join(cwd, ".aluka", "prompts"),
    path.join(getAgentDir(), "prompts"),
  ];
  const prompts: Prompt[] = [];
  for (const dir of dirs) {
    prompts.push(...loadPromptsFromDir(dir));
  }
  // 按名称去重，后面的覆盖前面的
  const byName = new Map<string, Prompt>();
  for (const prompt of prompts) byName.set(prompt.name, prompt);
  return [...byName.values()];
}

/**
 * 从指定目录加载提示词
 * 递归遍历目录，查找所有 .md 文件并解析为提示词
 */
export function loadPromptsFromDir(dir: string): Prompt[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  walk(dir, files);
  return files
    .filter((file) => file.endsWith(".md"))
    .map((file) => parsePrompt(file))
    .filter((prompt): prompt is Prompt => Boolean(prompt));
}

/** 递归遍历目录收集文件路径 */
function walk(dir: string, files: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else files.push(full);
  }
}

/**
 * 解析单个提示词文件
 *
 * 识别 YAML frontmatter（用 --- 包裹）和正文内容。
 * 如果没有 frontmatter，则整个文件作为正文，名称取自文件名。
 */
function parsePrompt(file: string): Prompt | undefined {
  const raw = fs.readFileSync(file, "utf8");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const body = match ? match[2].trim() : raw.trim();
  const front: PromptFrontmatter = {};
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const [key, ...rest] = line.split(":");
      if (!key || rest.length === 0) continue;
      const value = rest.join(":").trim().replace(/^["']|["']$/g, "");
      if (key.trim() === "name") front.name = value;
      if (key.trim() === "description") front.description = value;
    }
  }
  const name = front.name ?? path.basename(file, path.extname(file));
  return {
    name,
    description: front.description ?? name,
    path: file,
    body,
  };
}
