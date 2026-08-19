/**
 * 全局配置模块
 *
 * 提供版本号、目录路径、CLI 参数解析等基础配置。
 * 所有路径和目录名常量集中在此管理，便于统一维护。
 */

import os from "node:os";
import path from "node:path";

/** 当前版本号 */
export const VERSION = "0.1.0";

/** Aluka 自身的配置目录名 */
export const CONFIG_DIR_NAME = ".aluka";

/** pi-agent 兼容的配置目录名 */
export const PI_CONFIG_DIR_NAME = ".pi";

/**
 * 获取用户主目录
 * 优先使用 ALUKA_HOME 环境变量，其次 PI_HOME，最后回退到系统主目录
 */
export function getHomeDir(): string {
  return process.env.ALUKA_HOME ?? process.env.PI_HOME ?? os.homedir();
}

/**
 * 获取 Aluka 的 agent 数据目录
 * 路径为: {home}/.aluka/agent
 */
export function getAgentDir(): string {
  return path.join(getHomeDir(), ".aluka", "agent");
}

/**
 * 获取 pi-agent 兼容的数据目录
 * 路径为: {home}/.pi/agent
 */
export function getPiAgentDir(): string {
  return path.join(getHomeDir(), ".pi", "agent");
}

/**
 * 获取指定工作目录对应的会话存储路径
 * 会将 cwd 进行哈希处理以生成唯一的子目录名
 * @param agentDir 可选；桌面 Host 传入自定义 agent 目录（测试/多实例）
 */
export function getSessionsDir(cwd: string, agentDir = getAgentDir()): string {
  return path.join(agentDir, "sessions", hashCwd(cwd));
}

/**
 * 将工作目录路径转换为文件系统安全的目录名
 * 将路径分隔符替换为下划线，截取后 180 个字符作为哈希值
 */
function hashCwd(cwd: string): string {
  const cleaned = cwd.replace(/[:\\/]+/g, "_");
  return cleaned.slice(-180);
}

/**
 * CLI 参数类型定义
 * 包含所有命令行选项的解析结果
 */
export type CliArgs = {
  /** 一次性提示词（print 模式下使用） */
  prompt?: string;
  /** 是否为 print 模式（非交互式，执行一次后退出） */
  print: boolean;
  /** 额外加载的扩展文件路径列表 */
  extensions: string[];
  /** 指定的模型 ID */
  model?: string;
  /** 指定的模型提供商 */
  provider?: string;
  /** 工作目录 */
  cwd: string;
  /** 是否显示帮助信息 */
  help: boolean;
  /** 是否显示版本号 */
  version: boolean;
  /** 是否继续上一次会话 */
  continue: boolean;
  /** 会话显示名 */
  name?: string;
  /** 打开指定会话（文件路径或 id） */
  session?: string;
};

/**
 * 解析命令行参数
 *
 * 支持的参数格式:
 * -p, --print [text]   一次性提示词模式
 * -e, --extension      加载额外扩展
 * -m, --model          指定模型
 * --provider           指定提供商 (openai | anthropic)
 * --cwd                指定工作目录
 * -c, --continue       继续上一次会话
 * -h, --help           显示帮助
 * -v, --version        显示版本号
 *
 * 未加前缀的参数会被拼接为提示词
 */
export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    print: false,
    extensions: [],
    cwd: process.cwd(),
    help: false,
    version: false,
    continue: false,
  };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "-p" || token === "--print") {
      args.print = true;
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        args.prompt = next;
        i += 1;
      }
    } else if (token === "-e" || token === "--extension") {
      const next = argv[++i];
      if (next) args.extensions.push(next);
    } else if (token === "--model" || token === "-m") {
      args.model = argv[++i];
    } else if (token === "--provider") {
      args.provider = argv[++i];
    } else if (token === "--cwd") {
      args.cwd = argv[++i] ?? args.cwd;
    } else if (token === "-c" || token === "--continue") {
      args.continue = true;
    } else if (token === "-n" || token === "--name") {
      args.name = argv[++i];
    } else if (token === "--session") {
      args.session = argv[++i];
    } else if (token === "-h" || token === "--help") {
      args.help = true;
    } else if (token === "-v" || token === "--version") {
      args.version = true;
    } else if (!token.startsWith("-")) {
      rest.push(token);
    }
  }
  // 将非选项参数拼接为提示词
  if (!args.prompt && rest.length) args.prompt = rest.join(" ");
  // 如果有提示词，自动进入 print 模式
  if (args.prompt) args.print = true;
  return args;
}

/**
 * 帮助信息文本
 * 包含用法说明、所有可用参数和扩展发现路径
 */
export const HELP = `aluka — TypeScript AI agent compatible with pi-agent extensions

Usage:
  aluka                     Interactive REPL
  aluka -p "prompt"         Print mode (one shot)
  aluka -e ./ext.ts -p "hi" Load extra extension
  aluka --model gpt-4.1     Choose model

Flags:
  -p, --print <text>     One-shot prompt
  -e, --extension <path> Extra extension file or directory
  -m, --model <id>       Model id (resolved via models.json when present)
  --provider <name>      Provider id (openai / anthropic / custom in models.json)
  --cwd <dir>            Working directory
  -c, --continue         Resume last session
  -n, --name <name>      Set session display name
  --session <id|path>    Open a specific session file or id
  -h, --help             Help
  -v, --version          Version

Extensions are discovered from:
  ~/.pi/agent/extensions/
  ~/.aluka/agent/extensions/
  .pi/extensions/
  .aluka/extensions/
  settings.json extensions[] / packages[] (npm: / git: under ~/.pi/agent)
`;
