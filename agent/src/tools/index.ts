/**
 * 内置工具索引模块
 *
 * 集中导出所有内置工具定义。
 * 这些工具为 Agent 提供基础的文件操作、代码搜索和 Shell 执行能力。
 */

import { bashTool } from "./bash.ts";
import { editTool, readTool, writeTool } from "./files.ts";
import { findTool, grepTool, lsTool } from "./search.ts";
import { webFetchTool } from "./web_fetch.ts";
import type { ToolDefinition } from "../extensions/types.ts";

/** 所有内置工具的有序列表 */
export const builtinTools: ToolDefinition[] = [
  readTool,   // 读取文件
  writeTool,  // 写入文件
  editTool,   // 编辑文件（精确替换）
  bashTool,   // 执行 Shell 命令
  grepTool,   // 正则搜索文件内容
  findTool,   // 按名称查找文件
  lsTool,     // 列出目录内容
  webFetchTool, // 抓取网页/API 并抽取可读文本
];

export { bashTool, editTool, findTool, grepTool, lsTool, readTool, webFetchTool, writeTool };
