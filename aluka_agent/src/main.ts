/**
 * 主程序模块
 *
 * aluka 的核心入口，负责：
 * 1. 解析命令行参数
 * 2. 加载扩展
 * 3. 初始化模型和会话
 * 4. 运行交互式 REPL 或一次性 print 模式
 */

import readline from "node:readline/promises";
import { runAgentLoop } from "./agent/loop.ts";
import type { AgentMessage } from "./agent/types.ts";
import { HELP, parseArgs, VERSION, getSessionsDir, getAgentDir } from "./config.ts";
import { loadExtensions } from "./extensions/loader.ts";
import { ExtensionRunner } from "./extensions/runner.ts";
import { resolveRuntimeApiKey, resolveRuntimeModel } from "./models.ts";
import { loadSettings } from "./desktop/settings.ts";
import { SessionManager } from "./session/manager.ts";
import { loadSkills } from "./skills/index.ts";
import { buildSystemPrompt, toolSnippets } from "./system-prompt.ts";
import { builtinTools } from "./tools/index.ts";
import type { ToolDefinition } from "./extensions/types.ts";

/**
 * 主函数
 *
 * @param argv - 命令行参数数组，默认取 process.argv.slice(2)
 * @returns 退出码，0 表示正常退出
 */
export async function main(argv = process.argv.slice(2)): Promise<number> {
  // 解析命令行参数
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  if (args.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const cwd = args.cwd;
  const agentDir = getAgentDir();
  const settings = loadSettings(agentDir);

  // 加载扩展（从预设路径和命令行指定路径）
  const loaded = await loadExtensions({ cwd, extraPaths: args.extensions });
  // 输出扩展加载过程中的错误信息
  for (const error of loaded.errors) {
    process.stderr.write(`[extension] ${error.path}: ${error.error}\n`);
  }

  // 运行时解析模型：CLI 参数 > settings.json > models.json > 环境变量
  const { model, source: modelSource } = resolveRuntimeModel({
    agentDir,
    settings,
    provider: args.provider,
    model: args.model,
  });
  const apiKey = resolveRuntimeApiKey({
    agentDir,
    model,
    apiKey: settings.apiKey,
  });

  // 初始化会话管理器
  const sessionDir = getSessionsDir(cwd);
  const session = args.continue
    ? (SessionManager.latest(sessionDir) ?? SessionManager.create(sessionDir))
    : SessionManager.create(sessionDir);

  // 创建扩展运行器，设置运行模式（print 或 tui）
  const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, cwd, args.print ? "print" : "tui");
  runner.setModel(model);
  runner.setSession(session);

  // 用于排队等待处理的用户消息
  const queued: string[] = [];

  // 创建扩展命令上下文
  const ctx = runner.createContext();

  // 合并内置工具和扩展注册的工具
  const toolDefs: ToolDefinition[] = [...builtinTools];
  // 获取扩展注册的工具名，用于过滤同名的内置工具
  const overrideNames = new Set(runner.getRegisteredTools().map((tool) => tool.definition.name));
  const tools = [
    // 内置工具（排除被扩展覆盖的）
    ...toolDefs.filter((tool) => !overrideNames.has(tool.name)).map((tool) => runner.wrapTool(tool, ctx)),
    // 扩展注册的工具
    ...runner.getRegisteredTools().map((tool) => runner.wrapTool(tool.definition, ctx)),
  ];

  // 绑定运行器的回调接口
  runner.bind({
    /** 发送用户消息到队列 */
    sendUserMessage(content) {
      const text = typeof content === "string" ? content : content.map((part) => ("text" in part ? part.text : "")).join("");
      queued.push(text);
    },
    /** 获取当前可用工具名列表 */
    getActiveTools: () => tools.map((tool) => tool.name),
    /** 获取所有工具的详细信息 */
    getAllTools: () =>
      tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as never,
        sourceInfo: { path: "builtin", kind: "builtin" },
      })),
    /** 获取所有可用的斜杠命令 */
    getCommands: () => [
      { name: "help", description: "Show help", source: "builtin" },
      { name: "quit", description: "Exit", source: "builtin" },
      ...runner.getCommands().map((command) => ({
        name: command.name,
        description: command.description,
        source: "extension" as const,
      })),
    ],
  });

  // 加载技能并构建系统提示词
  const skills = loadSkills(cwd);
  let systemPrompt = buildSystemPrompt({
    cwd,
    skills,
    extra: [toolSnippets(tools)],
  });
  runner.setSystemPrompt(systemPrompt);

  // 触发会话启动和资源发现事件
  await runner.emitEvent({ type: "session_start", reason: args.continue ? "resume" : "startup" });
  await runner.emitEvent({ type: "resources_discover", cwd, reason: "startup" });

  // 消息历史记录
  const history: AgentMessage[] = [];

  // 如果指定了提示词，直接执行一次性交互
  if (args.prompt) {
    return runTurn(args.prompt);
  }

  // 交互式 REPL 模式
  process.stderr.write(
    `aluka ${VERSION}  model=${model.provider}/${model.id}  source=${modelSource}  extensions=${loaded.extensions.length}\n`,
  );
  process.stderr.write("Type a prompt, /help, or /quit.\n");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (!runner.wantsShutdown()) {
      const line = (await rl.question("you> ")).trim();
      if (!line) continue;

      // 处理内置命令
      if (line === "/quit" || line === "/exit") break;
      if (line === "/help") {
        process.stdout.write(`${HELP}\nCommands: ${runner.getCommands().map((command) => `/${command.name}`).join(" ")}\n`);
        continue;
      }

      // 处理扩展注册的自定义命令
      if (line.startsWith("/")) {
        const [name, ...rest] = line.slice(1).split(/\s+/);
        const command = runner.getCommands().find((item) => item.name === name);
        if (!command) {
          process.stderr.write(`Unknown command /${name}\n`);
          continue;
        }
        await command.handler(rest.join(" "), runner.createContext());
        continue;
      }

      // 执行一轮对话
      const code = await runTurn(line);
      if (code !== 0) return code;
    }
  } finally {
    rl.close();
    await runner.emitEvent({ type: "session_shutdown", reason: "quit" });
  }
  return 0;

  /**
   * 执行一轮对话（一个用户输入 → Agent 循环 → 返回结果）
   *
   * @param prompt - 用户输入的提示词
   * @returns 退出码，0 表示正常
   */
  async function runTurn(prompt: string): Promise<number> {
    // 让扩展有机会处理或转换输入
    const input = await runner.emitInput(prompt);
    if (input?.action === "handled") return 0;
    const text = input?.action === "transform" ? input.text : prompt;

    // 将用户消息追加到会话
    session.append({ type: "user", role: "user", text });

    // 让扩展在 Agent 开始前修改系统提示词
    const before = await runner.emitBeforeAgentStart(text, systemPrompt);
    if (before?.systemPrompt) {
      systemPrompt = before.systemPrompt;
      runner.setSystemPrompt(systemPrompt);
    }

    // 构造用户消息并加入历史
    const user: AgentMessage = { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
    history.push(user);

    // 设置 Agent 为活跃状态
    runner.setIdle(false);
    const controller = new AbortController();
    runner.setSignal(controller);

    try {
      // 运行 Agent 循环（LLM 推理 + 工具调用的迭代）
      const produced = await runAgentLoop(
        [user],
        {
          systemPrompt,
          messages: history.slice(0, -1),
          tools,
        },
        {
          model,
          apiKey,
          // 允许扩展变换上下文消息
          transformContext: (messages) => runner.emitContext(messages),
          // 允许扩展修改发送给提供商的请求
          beforeProviderRequest: async (payload) => {
            const replaced = await runner.emitEvent({ type: "before_provider_request", payload });
            if (
              replaced
              && typeof replaced === "object"
              && "payload" in replaced
              && (replaced as { type?: string }).type === "before_provider_request"
            ) {
              return (replaced as { payload: unknown }).payload ?? payload;
            }
            return replaced ?? payload;
          },
        },
        // 事件回调：将 Agent 事件转发给扩展，并在终端输出
        async (event) => {
          await runner.emitEvent(event as never);
          if (event.type === "message_update") {
            const delta = event.assistantMessageEvent;
            if (delta.type === "text") process.stdout.write(delta.delta);
          }
          if (event.type === "message_end" && event.message.role === "assistant") {
            process.stdout.write("\n");
          }
          if (event.type === "tool_execution_start") {
            process.stderr.write(`\n➜ ${event.toolName}\n`);
          }
        },
        controller.signal,
      );

      // 将新产生的消息加入历史（排除重复的用户消息）
      history.push(...produced.filter((message) => message !== user));
      session.append({ type: "turn", messages: produced });

      // 通知扩展 Agent 已稳定（无更多工具调用）
      await runner.emitEvent({ type: "agent_settled" });
      return 0;
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
      return 1;
    } finally {
      // 恢复空闲状态并清理信号
      runner.setIdle(true);
      runner.setSignal(undefined);
    }
  }
}
