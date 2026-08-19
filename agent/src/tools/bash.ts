/**
 * Shell 执行工具
 *
 * 提供在工作目录中执行 Shell 命令的能力。
 * - Windows 使用 cmd.exe，其他平台使用 bash
 * - 支持超时控制（默认 60 秒）
 * - 支持中止信号取消执行
 * - 实时输出流式回调（onUpdate）
 */

import { spawn } from "node:child_process";
import os from "node:os";
import { Type } from "typebox";
import { defineTool } from "../extensions/types.ts";
import { killProcessTree, trackChild } from "../process-children.ts";

export const bashTool = defineTool({
  name: "bash",
  label: "Bash",
  description: "Run a shell command in the working directory.",
  promptSnippet: "Execute a shell command",
  parameters: Type.Object({
    command: Type.String(),
    timeout: Type.Optional(Type.Number({ description: "Timeout in milliseconds" })),
  }),
  async execute(_id, params, signal, onUpdate, ctx) {
    const timeout = params.timeout ?? 60_000;
    const result = await runShell(params.command, ctx.cwd, timeout, signal, (chunk) => {
      onUpdate?.({ content: [{ type: "text", text: chunk }] });
    });
    // 合并 stdout 和 stderr，截断到 100KB
    const text = [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || `(exit ${result.code})`;
    return {
      content: [{ type: "text", text: text.slice(0, 100_000) }],
      details: { code: result.code },
      isError: result.code !== 0,
    };
  },
});

/**
 * 执行 Shell 命令
 *
 * 使用 child_process.spawn 启动子进程，
 * 支持超时和中止信号。输出通过 onChunk 回调实时流式返回。
 * Windows 下 windowsHide 避免弹出 cmd 控制台窗口。
 */
function runShell(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  onChunk: (text: string) => void,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    // 根据平台选择 Shell
    const shell = os.platform() === "win32" ? "cmd.exe" : "bash";
    const args = os.platform() === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command];
    const child = trackChild(spawn(shell, args, { cwd, env: process.env, windowsHide: true }));
    let stdout = "";
    let stderr = "";

    // 收集标准输出并流式回调
    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      onChunk(text);
    });

    // 收集标准错误并流式回调
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      onChunk(text);
    });

    // 超时后发送 SIGTERM 终止进程
    const timer = setTimeout(() => killProcessTree(child.pid), timeoutMs);

    // 中止信号监听
    const onAbort = () => killProcessTree(child.pid);
    signal?.addEventListener("abort", onAbort);

    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ stdout, stderr, code: code ?? 1 });
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: error.message, code: 1 });
    });
  });
}
