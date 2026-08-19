/**
 * 技能模块
 *
 * 技能（Skill）是从 Markdown 文件加载的提示词片段，
 * 用于在系统提示词中注入领域知识或操作指南。
 *
 * 技能文件格式：
 * ---
 * name: 技能名称
 * description: 技能描述
 * ---
 * 技能正文内容（Markdown）
 */

import fs from "node:fs";
import path from "node:path";

/** 技能文件的 frontmatter 字段 */
export interface SkillFrontmatter {
  name?: string;
  description?: string;
}

/** 技能定义 */
export interface Skill {
  /** 技能名称（唯一标识） */
  name: string;
  /** 技能描述 */
  description: string;
  /** 技能文件路径 */
  path: string;
  /** 技能正文（Markdown） */
  body: string;
}

/**
 * 加载所有可用技能
 *
 * 从以下目录搜索技能文件：
 * - {cwd}/.pi/skills/
 * - {cwd}/.aluka/skills/
 * - {home}/.pi/agent/skills/
 * - {home}/.aluka/agent/skills/
 *
 * 同名技能以后面的覆盖前面的
 */
export function loadSkills(cwd: string): Skill[] {
  const dirs = [
    path.join(cwd, ".pi", "skills"),
    path.join(cwd, ".aluka", "skills"),
    path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".pi", "agent", "skills"),
    path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".aluka", "agent", "skills"),
  ];
  const skills: Skill[] = [];
  for (const dir of dirs) {
    skills.push(...loadSkillsFromDir(dir));
  }
  // 按名称去重，后面的覆盖前面的
  const byName = new Map<string, Skill>();
  for (const skill of skills) byName.set(skill.name, skill);
  return [...byName.values()];
}

/**
 * 从指定目录加载技能
 * 递归遍历目录，查找所有 .md 文件并解析为技能
 */
export function loadSkillsFromDir(dir: string): Skill[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  walk(dir, files);
  return files
    .filter((file) => file.endsWith(".md"))
    .map((file) => parseSkill(file))
    .filter((skill): skill is Skill => Boolean(skill));
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
 * 解析单个技能文件
 *
 * 识别 YAML frontmatter（用 --- 包裹）和正文内容。
 * 如果没有 frontmatter，则整个文件作为正文，名称取自文件名。
 */
function parseSkill(file: string): Skill | undefined {
  const raw = fs.readFileSync(file, "utf8");
  // 匹配 frontmatter 和正文
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const body = match ? match[2].trim() : raw.trim();
  const front: SkillFrontmatter = {};
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

/**
 * 将技能列表格式化为系统提示词片段
 * 格式为 "- 技能名: 描述"，用于注入系统提示词
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
  if (!skills.length) return "";
  return [
    "Skills (follow when relevant):",
    ...skills.map((skill) => `- ${skill.name}: ${skill.description}`),
  ].join("\n");
}
