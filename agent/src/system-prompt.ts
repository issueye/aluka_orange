/**
 * 系统提示词构建模块
 *
 * 负责组装发送给 LLM 的系统提示词（system prompt），
 * 包含角色定义、工作目录、技能列表、工具说明等信息。
 */

import { formatSkillsForPrompt, type Skill } from "./skills/index.ts";

/** 构建系统提示词的输入参数 */
export interface BuildSystemPromptInput {
  /** 当前工作目录 */
  cwd: string;
  /** 可用技能列表 */
  skills?: Skill[];
  /** 额外追加的提示词片段（如工具说明） */
  extra?: string[];
}

/**
 * 构建系统提示词
 *
 * 将角色定义、工具使用原则、工作目录、技能和额外内容
 * 组合为完整的系统提示词字符串。
 */
export function buildSystemPrompt(input: BuildSystemPromptInput): string {
  const parts = [
    // 角色定义：你是 Aluka，一个本地编码助手，要求简洁准确
    "You are Aluka, a local coding agent. Be concise and correct.",
    // 工具使用原则：优先做精确编辑而非重写整个文件
    "Use tools to inspect and change files. Prefer surgical edits over rewriting whole files.",
    // 原则：不要编造文件内容，先读取再编辑
    "Do not invent file contents. Read before you edit.",
    // 当前工作目录
    `Working directory: ${input.cwd}`,
    // 技能列表
    formatSkillsForPrompt(input.skills ?? []),
    // 额外内容（如工具说明片段）
    ...(input.extra ?? []),
  ].filter(Boolean);
  return parts.join("\n\n");
}

/**
 * 将可用工具列表格式化为提示词片段
 * 每个工具一行，格式为 "- 工具名: 说明"
 */
export function toolSnippets(tools: Array<{ name: string; description: string; promptSnippet?: string }>): string {
  if (!tools.length) return "";
  return [
    "Available tools:",
    ...tools.map((tool) => `- ${tool.name}: ${tool.promptSnippet ?? tool.description}`),
  ].join("\n");
}
