/**
 * 控制台 UI 和命令执行模块
 *
 * 提供非 TUI 模式下的简化 UI 实现（createConsoleUI），
 * 以及子进程命令执行工具（execCommand）。
 *
 * createConsoleUI 使用 stderr 输出交互信息，
 * 使用 readline 读取用户输入，适用于 print 模式。
 */

import { spawn } from "node:child_process";
import os from "node:os";
import readline from "node:readline/promises";
import type { ExtensionUIContext, Theme } from "./types.ts";

/** 默认主题 */
const defaultTheme: Theme = { name: "aluka-dark" };

/**
 * 创建控制台 UI 实现
 *
 * 为扩展提供最基本的 UI 能力：
 * - select: 列出选项让用户选择
 * - confirm: 确认对话框
 * - input: 文本输入
 * - notify: 通知消息输出到 stderr
 * - editor: 简单的文本编辑器
 *
 * 高级 UI 功能（如自定义组件、widget 等）在控制台模式下不可用
 */
export function createConsoleUI(): ExtensionUIContext {
  let editorText = "";
  const statuses = new Map<string, string>();
  return {
    /** 选择对话框：列出选项让用户输入编号选择 */
    async select(title, options) {
      process.stderr.write(`${title}\n${options.map((item, index) => `  ${index + 1}. ${item}`).join("\n")}\n`);
      const answer = await prompt("Choose number: ");
      const index = Number(answer) - 1;
      return options[index];
    },
    /** 确认对话框：显示 y/N 提示 */
    async confirm(title, message) {
      const answer = await prompt(`${title}\n${message} [y/N] `);
      return /^y(es)?$/i.test(answer.trim());
    },
    /** 文本输入对话框 */
    async input(title, placeholder) {
      return prompt(`${title}${placeholder ? ` (${placeholder})` : ""}: `);
    },
    /** 发送通知到 stderr */
    notify(message, type = "info") {
      const prefix = type === "error" ? "error" : type === "warning" ? "warn" : "info";
      process.stderr.write(`[${prefix}] ${message}\n`);
    },
    /** 终端输入监听（控制台模式下为空操作） */
    onTerminalInput() {
      return () => undefined;
    },
    /** 设置状态栏文本 */
    setStatus(key, text) {
      if (text === undefined) statuses.delete(key);
      else statuses.set(key, text);
    },
    /** 以下方法在控制台模式下为空操作 */
    setWorkingMessage() {},
    setWorkingVisible() {},
    setWorkingIndicator() {},
    setHiddenThinkingLabel() {},
    setWidget() {},
    setFooter() {},
    setHeader() {},
    /** 设置窗口标题 */
    setTitle(title) {
      process.title = title;
    },
    /** 自定义组件（控制台模式下不可用） */
    async custom() {
      throw new Error("ctx.ui.custom() is not available outside interactive TUI mode");
    },
    /** 向编辑器追加文本 */
    pasteToEditor(text) {
      editorText += text;
    },
    /** 覆盖编辑器文本 */
    setEditorText(text) {
      editorText = text;
    },
    /** 获取编辑器文本 */
    getEditorText() {
      return editorText;
    },
    /** 简单的文本编辑器（使用 readline） */
    async editor(title, prefill) {
      return prompt(`${title}: `, prefill);
    },
    addAutocompleteProvider() {},
    setEditorComponent() {},
    getEditorComponent() {
      return undefined;
    },
    theme: defaultTheme,
    getAllThemes() {
      return [{ name: defaultTheme.name, path: undefined }];
    },
    getTheme(name) {
      return name === defaultTheme.name ? defaultTheme : undefined;
    },
    setTheme(theme) {
      if (typeof theme === "string" && theme !== defaultTheme.name) {
        return { success: false, error: `Unknown theme: ${theme}` };
      }
      return { success: true };
    },
    getToolsExpanded() {
      return true;
    },
    setToolsExpanded() {},
  };
}

/**
 * 简单的控制台提示函数
 * 如果 stdin 不是 TTY（如管道模式），直接返回预填值
 */
async function prompt(question: string, prefill = ""): Promise<string> {
  if (!process.stdin.isTTY) return prefill;
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

/**
 * 执行外部命令
 *
 * 用于扩展调用系统命令。
 * 支持自定义工作目录、环境变量和超时。
 *
 * @returns 包含 stdout、stderr 和退出码的结果对象
 */
export async function execCommand(
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: { ...process.env, ...options?.env },
      shell: os.platform() === "win32",
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    // 可选超时
    const timer = options?.timeoutMs
      ? setTimeout(() => child.kill("SIGTERM"), options.timeoutMs)
      : undefined;
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr: error.message, code: 1 });
    });
  });
}
