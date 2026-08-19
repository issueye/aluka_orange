/**
 * 文件操作工具
 *
 * 提供三个内置工具：
 * - readTool: 读取文件内容，支持行号偏移和行数限制
 * - writeTool: 写入或覆盖文件，自动创建父目录
 * - editTool: 精确字符串替换（oldText 必须唯一匹配）
 */

import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import { defineTool } from "../extensions/types.ts";

/** 文件读取的最大字节数（50KB） */
const MAX_BYTES = 50 * 1024;

/**
 * 读取文件工具
 *
 * 支持可选的 offset（起始行号，1-based）和 limit（最大行数）。
 * 输出带行号前缀的文本，超过 50KB 会截断。
 */
export const readTool = defineTool({
  name: "read",
  label: "Read",
  description: "Read a file. Optional offset/limit are 1-based line numbers.",
  promptSnippet: "Read file contents",
  parameters: Type.Object({
    path: Type.String({ description: "Path to the file" }),
    offset: Type.Optional(Type.Number({ description: "1-based start line" })),
    limit: Type.Optional(Type.Number({ description: "Max number of lines" })),
  }),
  async execute(_id, params, _signal, _onUpdate, ctx) {
    const absolute = path.resolve(ctx.cwd, params.path);
    try {
      const raw = await fs.readFile(absolute, "utf8");
      const lines = raw.split("\n");
      // 计算实际读取范围（offset 为 1-based，转换为 0-based 索引）
      const start = params.offset ? Math.max(0, params.offset - 1) : 0;
      const end = params.limit ? start + params.limit : lines.length;
      let text = lines.slice(start, end).join("\n");
      // 超过 50KB 截断
      if (Buffer.byteLength(text, "utf8") > MAX_BYTES) {
        text = `${text.slice(0, MAX_BYTES)}\n\n[truncated at 50KB]`;
      }
      // 添加行号前缀
      const numbered = text
        .split("\n")
        .map((line, index) => `${String(start + index + 1).padStart(6)}|${line}`)
        .join("\n");
      return {
        content: [{ type: "text", text: numbered }],
        details: { lines: lines.length, path: absolute },
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error reading ${params.path}: ${error instanceof Error ? error.message : error}` }],
        isError: true,
      };
    }
  },
});

/**
 * 写入文件工具
 *
 * 自动创建不存在的父目录。
 * 会覆盖文件的全部内容。
 */
export const writeTool = defineTool({
  name: "write",
  label: "Write",
  description: "Write a file, creating parent directories as needed.",
  promptSnippet: "Create or overwrite a file",
  parameters: Type.Object({
    path: Type.String(),
    content: Type.String(),
  }),
  async execute(_id, params, _signal, _onUpdate, ctx) {
    const absolute = path.resolve(ctx.cwd, params.path);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, params.content, "utf8");
    return { content: [{ type: "text", text: `Wrote ${params.path}` }] };
  },
});

/**
 * 编辑文件工具
 *
 * 执行精确的字符串替换。oldText 必须在文件中唯一匹配：
 * - 匹配 0 次：返回错误 "oldText not found"
 * - 匹配多次：返回错误提示需要唯一匹配
 * - 匹配恰好 1 次：执行替换
 */
export const editTool = defineTool({
  name: "edit",
  label: "Edit",
  description: "Replace exact oldText with newText in a file. oldText must match uniquely.",
  promptSnippet: "Exact string replacement in a file",
  parameters: Type.Object({
    path: Type.String(),
    oldText: Type.String(),
    newText: Type.String(),
  }),
  async execute(_id, params, _signal, _onUpdate, ctx) {
    const absolute = path.resolve(ctx.cwd, params.path);
    const raw = await fs.readFile(absolute, "utf8");
    const matches = raw.split(params.oldText).length - 1;
    if (matches === 0) {
      return { content: [{ type: "text", text: "oldText not found" }], isError: true };
    }
    if (matches > 1) {
      return { content: [{ type: "text", text: `oldText matched ${matches} times; it must be unique` }], isError: true };
    }
    await fs.writeFile(absolute, raw.replace(params.oldText, params.newText), "utf8");
    return { content: [{ type: "text", text: `Edited ${params.path}` }], details: { replacements: 1 } };
  },
});
