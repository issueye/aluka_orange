/**
 * 扩展运行器
 *
 * ExtensionRunner 是扩展系统的核心运行时管理器，负责：
 * - 管理扩展的生命周期状态（空闲、中止、关闭等）
 * - 事件分发：将 Agent 事件广播给所有已注册的扩展
 * - 工具包装：将扩展注册的工具包装为 Agent 可用的工具格式
 * - 上下文创建：为扩展命令提供完整的运行上下文
 * - 绑定回调：将 Agent 的行为方法（消息发送、工具管理等）连接到扩展系统
 */

import type { AgentMessage, AgentTool, AgentToolResult } from "../agent/types.ts";
import { validateArgs } from "../ai/schema.ts";
import type { Model, ThinkingLevel } from "../ai/types.ts";
import type { SessionManager } from "../session/manager.ts";
import type { EventBus } from "./event-bus.ts";
import { createEventBus } from "./event-bus.ts";
import { createConsoleUI } from "./ui.ts";
import type {
  BeforeAgentStartEventResult,
  ContextEventResult,
  Extension,
  ExtensionActions,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionError,
  ExtensionEvent,
  ExtensionHandler,
  ExtensionMode,
  ExtensionRuntime,
  InputEventResult,
  ToolCallEvent,
  ToolCallEventResult,
  ToolDefinition,
  ToolResultEvent,
  ToolResultEventResult,
} from "./types.ts";

/**
 * 扩展运行器
 *
 * 管理所有已加载扩展的运行状态，提供事件分发和工具包装能力。
 */
export class ExtensionRunner {
  /** 加载过程中产生的错误 */
  readonly errors: ExtensionError[] = [];
  /** 当前思考深度等级 */
  private thinkingLevel: ThinkingLevel = "off";
  /** 当前会话名称 */
  private sessionName: string | undefined;
  /** Agent 是否处于空闲状态 */
  private idle = true;
  /** 当前的中止控制器 */
  private abortController: AbortController | undefined;
  /** 是否有待处理的消息 */
  private pending = false;
  /** 是否已请求关闭 */
  private shutdownRequested = false;
  /** 当前系统提示词 */
  private systemPrompt = "";
  /** 工具是否展开显示 */
  private toolsExpanded = true;

  constructor(
    /** 已加载的扩展列表 */
    readonly extensions: Extension[],
    /** 扩展运行时 */
    readonly runtime: ExtensionRuntime,
    /** 工作目录 */
    readonly cwd: string,
    /** 运行模式 */
    readonly mode: ExtensionMode,
    /** 事件总线 */
    readonly events: EventBus = createEventBus(),
    /** UI 实例 */
    private readonly ui = createConsoleUI(),
    /** 会话管理器 */
    private session?: SessionManager,
    /** 当前模型 */
    private model?: Model,
    /** 可用模型列表 */
    private models: Model[] = [],
  ) {}

  /**
   * 绑定 Agent 行为回调
   *
   * 将 Agent 的行为方法（消息发送、工具管理、模型切换等）
   * 连接到扩展运行时，使扩展能够调用这些方法。
   * 如果未提供回调，则使用默认的空实现。
   */
  bind(actions: Partial<ExtensionActions> & { getSystemPrompt?: () => string } = {}): void {
    const runtime = this.runtime;
    // 消息发送：将用户消息加入队列
    runtime.sendMessage = actions.sendMessage ?? runtime.sendMessage;
    runtime.sendUserMessage = actions.sendUserMessage ?? runtime.sendUserMessage;
    // 条目追加：将自定义条目写入会话
    runtime.appendEntry = actions.appendEntry ?? ((customType, data) => {
      this.session?.append({ type: "custom", customType, data, timestamp: Date.now() });
    });
    // 会话名称管理
    runtime.setSessionName = actions.setSessionName ?? ((name) => {
      this.sessionName = name;
    });
    runtime.getSessionName = actions.getSessionName ?? (() => this.sessionName);
    runtime.setLabel = actions.setLabel ?? (() => undefined);
    // 工具管理
    runtime.getActiveTools = actions.getActiveTools ?? (() => this.getActiveToolNames());
    runtime.getAllTools = actions.getAllTools ?? (() =>
      this.getRegisteredTools().map((tool) => ({
        name: tool.definition.name,
        description: tool.definition.description,
        parameters: tool.definition.parameters,
        promptGuidelines: tool.definition.promptGuidelines,
        sourceInfo: tool.sourceInfo,
      })));
    runtime.setActiveTools = actions.setActiveTools ?? (() => undefined);
    runtime.refreshTools = actions.refreshTools ?? (() => undefined);
    // 命令列表
    runtime.getCommands = actions.getCommands ?? (() =>
      this.getCommands().map((command) => ({
        name: command.name,
        description: command.description,
        source: "extension" as const,
      })));
    // 模型和思考等级管理
    runtime.setModel = actions.setModel ?? (async (model) => {
      this.model = model;
      return true;
    });
    runtime.getThinkingLevel = actions.getThinkingLevel ?? (() => this.thinkingLevel);
    runtime.setThinkingLevel = actions.setThinkingLevel ?? ((level) => {
      this.thinkingLevel = level;
    });
    // 系统提示词获取
    if (actions.getSystemPrompt) {
      this.getSystemPrompt = actions.getSystemPrompt;
    }
  }

  /** 设置当前模型 */
  setModel(model: Model): void {
    this.model = model;
  }

  /** 设置当前会话 */
  setSession(session: SessionManager): void {
    this.session = session;
  }

  /** 设置 Agent 空闲状态 */
  setIdle(idle: boolean): void {
    this.idle = idle;
  }

  /** 设置中止控制器 */
  setSignal(controller: AbortController | undefined): void {
    this.abortController = controller;
  }

  /** 获取当前系统提示词 */
  getSystemPrompt = (): string => this.systemPrompt;

  /** 设置系统提示词 */
  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  /**
   * 获取所有扩展注册的工具（去重，后注册的覆盖先注册的）
   */
  getRegisteredTools(): Array<{ definition: ToolDefinition; sourceInfo: Extension["sourceInfo"] }> {
    const tools = new Map<string, { definition: ToolDefinition; sourceInfo: Extension["sourceInfo"] }>();
    for (const extension of this.extensions) {
      for (const [name, tool] of extension.tools) {
        tools.set(name, tool);
      }
    }
    return [...tools.values()];
  }

  /** 获取所有活跃工具的名称列表 */
  getActiveToolNames(): string[] {
    return this.getRegisteredTools().map((tool) => tool.definition.name);
  }

  /**
   * 获取所有扩展注册的命令（去重）
   */
  getCommands() {
    const commands = new Map<string, Extension["commands"] extends Map<string, infer V> ? V : never>();
    for (const extension of this.extensions) {
      for (const [name, command] of extension.commands) commands.set(name, command);
    }
    return [...commands.values()];
  }

  /**
   * 将内置工具和扩展工具合并为 Agent 工具列表
   * 扩展工具可以覆盖同名的内置工具
   */
  wrapTools(builtins: AgentTool[], ctx: ExtensionContext): AgentTool[] {
    const byName = new Map(builtins.map((tool) => [tool.name, tool]));
    for (const registered of this.getRegisteredTools()) {
      byName.set(registered.definition.name, this.wrapTool(registered.definition, ctx));
    }
    return [...byName.values()];
  }

  /**
   * 将扩展工具定义包装为 Agent 可用的工具
   *
   * 包装后的工具会在执行前：
   * 1. 参数预处理（prepareArguments）
   * 2. 参数校验（validateArgs）
   * 3. 触发 tool_call 事件（扩展可以拦截/阻止工具调用）
   *
   * 执行后：
   * 4. 触发 tool_result 事件（扩展可以修改结果）
   */
  wrapTool(definition: ToolDefinition, ctx: ExtensionContext): AgentTool {
    return {
      name: definition.name,
      label: definition.label,
      description: definition.description,
      parameters: definition.parameters,
      executionMode: definition.executionMode,
      execute: async (toolCallId, params, signal, onUpdate) => {
        // 参数预处理和校验
        const prepared = definition.prepareArguments ? definition.prepareArguments(params) : params;
        const valid = validateArgs(definition.parameters, prepared);

        // 触发工具调用事件，扩展可以拦截
        const callEvent = {
          type: "tool_call",
          toolCallId,
          toolName: definition.name,
          input: valid as Record<string, unknown>,
        } as ToolCallEvent;
        const gate = await this.emit<ToolCallEvent, ToolCallEventResult>("tool_call", callEvent);
        if (gate?.block) {
          return {
            content: [{ type: "text", text: gate.reason ?? `Tool ${definition.name} blocked by extension` }],
            isError: true,
          };
        }

        // 执行工具
        const result = await definition.execute(toolCallId, callEvent.input as never, signal, onUpdate, ctx);

        // 触发工具结果事件，扩展可以修改结果
        const resultEvent = {
          type: "tool_result",
          toolCallId,
          toolName: definition.name,
          input: callEvent.input as Record<string, unknown>,
          content: result.content,
          isError: Boolean(result.isError),
          details: result.details,
        } as ToolResultEvent;
        const patched = await this.emit<ToolResultEvent, ToolResultEventResult>("tool_result", resultEvent);

        // 返回最终结果（扩展可能已修改）
        const finalResult: AgentToolResult = {
          content: patched?.content ?? result.content,
          details: patched?.details ?? result.details,
          isError: patched?.isError ?? result.isError,
          usage: patched?.usage ?? result.usage,
        };
        return finalResult;
      },
    };
  }

  /**
   * 创建扩展命令上下文
   *
   * 为扩展的命令处理器提供完整的运行环境，
   * 包括 UI、模型、会话、中止信号等。
   */
  createContext(): ExtensionCommandContext {
    const self = this;
    const ctx: ExtensionCommandContext = {
      ui: this.ui,
      mode: this.mode,
      hasUI: this.mode === "tui" || this.mode === "rpc",
      cwd: this.cwd,
      sessionManager: this.session ?? {
        file: "",
        getEntries: () => [],
      },
      modelRegistry: {
        getModels: () => this.models,
        resolveApiKey: (model) => process.env[`${model.provider.toUpperCase()}_API_KEY`] ?? process.env.ALUKA_API_KEY,
      },
      model: this.model,
      scopedModels: this.models.map((model) => ({ model })),
      thinkingLevel: this.thinkingLevel,
      isIdle: () => this.idle,
      isProjectTrusted: () => true,
      get signal() {
        return self.abortController?.signal;
      },
      abort: () => this.abortController?.abort(),
      hasPendingMessages: () => this.pending,
      shutdown: () => {
        this.shutdownRequested = true;
      },
      getContextUsage: () =>
        this.model
          ? { tokens: null, contextWindow: this.model.contextWindow, percent: null }
          : undefined,
      compact: () => undefined,
      getSystemPrompt: () => this.getSystemPrompt(),
      getSystemPromptOptions: () => ({ cwd: this.cwd }),
      waitForIdle: async () => undefined,
      newSession: async () => ({ cancelled: false }),
      fork: async () => ({ cancelled: false }),
      navigateTree: async () => ({ cancelled: false }),
      switchSession: async () => ({ cancelled: false }),
      reload: async () => undefined,
    };
    return ctx;
  }

  /** 检查是否已请求关闭 */
  wantsShutdown(): boolean {
    return this.shutdownRequested;
  }

  /**
   * 广播事件到所有扩展
   *
   * 按扩展注册顺序依次调用事件处理器。
   * 某些事件可以返回结果（如拦截工具调用、修改消息等），
   * 最后一个非空结果会被返回。
   */
  async emit<E extends { type: string }, R = undefined>(type: string, event: E): Promise<R | undefined> {
    const ctx = this.createContext();
    let result: R | undefined;
    for (const extension of this.extensions) {
      const handlers = extension.handlers.get(type) ?? [];
      for (const handler of handlers) {
        try {
          const next = await (handler as ExtensionHandler<E, R>)(event, ctx);
          if (next !== undefined && next !== null) result = next as R;
        } catch (error) {
          this.errors.push({
            extensionPath: extension.path,
            event: type,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
      }
    }
    return result;
  }

  /**
   * 触发上下文事件
   * 允许扩展修改发送给 LLM 的消息列表
   */
  async emitContext(messages: AgentMessage[]): Promise<AgentMessage[]> {
    const result = await this.emit<{ type: "context"; messages: AgentMessage[] }, ContextEventResult>(
      "context",
      { type: "context", messages },
    );
    return result?.messages ?? messages;
  }

  /**
   * 触发输入事件
   * 扩展可以拦截、转换或处理用户输入
   */
  async emitInput(text: string): Promise<InputEventResult | undefined> {
    return this.emit("input", { type: "input", text, source: this.mode === "print" ? "rpc" : "interactive" });
  }

  /**
   * 触发 Agent 启动前事件
   * 扩展可以在此阶段修改系统提示词或注入额外消息
   */
  async emitBeforeAgentStart(prompt: string, systemPrompt: string): Promise<BeforeAgentStartEventResult | undefined> {
    return this.emit("before_agent_start", {
      type: "before_agent_start",
      prompt,
      systemPrompt,
      systemPromptOptions: { cwd: this.cwd },
    });
  }

  /** 触发任意扩展事件 */
  async emitEvent(event: ExtensionEvent): Promise<unknown> {
    return this.emit(event.type, event);
  }
}
