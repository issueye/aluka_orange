/**
 * Agent 循环核心模块
 *
 * 实现 LLM 推理与工具调用的迭代循环：
 * 1. 将消息发送给 LLM 获取响应
 * 2. 如果响应包含工具调用，执行工具并获取结果
 * 3. 将工具结果加入消息历史，继续循环
 * 4. 直到 LLM 不再发起工具调用，循环结束
 */

import type { AssistantMessage, Context, ToolCallContent, ToolResultMessage } from "../ai/types.ts";
import { streamModel, type StreamFn } from "../ai/stream.ts";
import { convertToLlm, type AgentContext, type AgentEventSink, type AgentLoopConfig, type AgentMessage } from "./types.ts";

/**
 * 运行 Agent 循环
 *
 * @param prompts - 初始用户提示词消息
 * @param context - Agent 运行上下文（消息历史、工具、系统提示词）
 * @param config - 循环配置（模型、API Key、钩子等）
 * @param emit - 事件回调，用于通知外部状态变化
 * @param signal - 中止信号
 * @param streamFn - 流式调用函数（可注入用于测试）
 * @returns 所有产生的消息（包括助手回复和工具结果）
 */
export async function runAgentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal: AbortSignal | undefined,
  streamFn: StreamFn = streamModel,
): Promise<AgentMessage[]> {
  // 累积所有产生的消息
  const produced: AgentMessage[] = [...prompts];
  const current: AgentContext = {
    ...context,
    messages: [...context.messages, ...prompts],
  };

  // 发送 Agent 生命周期事件
  await emit({ type: "agent_start" });
  await emit({ type: "turn_start", turnIndex: 0, timestamp: Date.now() });
  try {
    for (const prompt of prompts) {
      await emit({ type: "message_start", message: prompt });
      await emit({ type: "message_end", message: prompt });
    }
    await loop(current, produced, config, emit, signal, streamFn);
  } finally {
    // 出错也要发 agent_end，否则桌面壳会一直认为 Agent 忙碌
    await emit({ type: "agent_end", messages: produced });
  }
  return produced;
}

/**
 * 核心迭代循环
 *
 * 每轮迭代：
 * 1. 调用 LLM 获取助手响应
 * 2. 检查是否包含工具调用
 * 3. 若有工具调用，逐个执行并收集结果
 * 4. 将结果加入消息历史，继续下一轮
 * 5. 若无工具调用，结束循环
 */
async function loop(
  context: AgentContext,
  produced: AgentMessage[],
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal: AbortSignal | undefined,
  streamFn: StreamFn,
): Promise<void> {
  let turnIndex = 0;

  while (true) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    // 可选：让扩展变换消息上下文（如注入系统信息）
    const messages = config.transformContext
      ? await config.transformContext(context.messages)
      : context.messages;

    // 构建 LLM 请求上下文
    const llmContext: Context = {
      system: context.systemPrompt,
      messages: convertToLlm(messages),
      tools: context.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
    };

    // 调用 LLM 流式接口
    const stream = streamFn(config.model, llmContext, {
      apiKey: config.apiKey,
      signal,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      thinkingLevel: config.thinkingLevel,
      onPayload: config.beforeProviderRequest,
      onResponse: config.afterProviderResponse,
    });

    // 收集流式响应（abort 时立即中断）
    let assistant: AssistantMessage | undefined;
    for await (const event of stream) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (event.type === "start") {
        // 开始新的助手消息
        assistant = { role: "assistant", content: [], model: config.model.id };
        await emit({ type: "message_start", message: assistant });
      } else if (event.type === "done") {
        // 流式响应完成
        assistant = event.message;
      } else if (event.type === "error") {
        throw event.error;
      } else if (assistant) {
        // 处理文本和工具调用事件
        if (event.type === "text") {
          const last = assistant.content[assistant.content.length - 1];
          if (last?.type === "text") last.text = event.content.text;
          else assistant.content.push({ ...event.content });
        } else if (event.type === "toolcall_end") {
          assistant.content.push(event.content);
        }
        // 转发消息更新事件
        await emit({
          type: "message_update",
          message: assistant,
          assistantMessageEvent: event,
        });
      }
    }
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    if (!assistant) throw new Error("Provider returned no assistant message");

    // 将助手消息加入历史
    context.messages.push(assistant);
    produced.push(assistant);
    await emit({ type: "message_end", message: assistant });

    // 提取工具调用
    const calls = assistant.content.filter((part): part is ToolCallContent => part.type === "toolCall");
    if (calls.length === 0) {
      // 无工具调用，本轮结束
      await emit({ type: "turn_end", turnIndex, message: assistant, toolResults: [] });
      return;
    }

    // 逐个执行工具调用（abort 时立即中断并抛出）
    const toolResults: ToolResultMessage[] = [];
    for (const call of calls) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const tool = context.tools.find((item) => item.name === call.name);
      await emit({
        type: "tool_execution_start",
        toolCallId: call.id,
        toolName: call.name,
        args: call.arguments,
      });

      let result: ToolResultMessage;
      if (!tool) {
        // 未知工具：返回错误
        result = {
          role: "toolResult",
          toolCallId: call.id,
          toolName: call.name,
          isError: true,
          content: [{ type: "text", text: `Unknown tool: ${call.name}` }],
        };
      } else {
        try {
          // 执行工具并收集结果
          const executed = await tool.execute(call.id, call.arguments, signal, (partial) => {
            // 转发工具执行的部分更新
            void emit({
              type: "tool_execution_update",
              toolCallId: call.id,
              toolName: call.name,
              args: call.arguments,
              partialResult: partial,
            });
          });
          if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
          result = {
            role: "toolResult",
            toolCallId: call.id,
            toolName: call.name,
            content: executed.content,
            details: executed.details,
            isError: executed.isError,
          };
        } catch (error) {
          if ((error as Error)?.name === "AbortError" || signal?.aborted) throw error;
          // 工具执行异常：返回错误结果
          result = {
            role: "toolResult",
            toolCallId: call.id,
            toolName: call.name,
            isError: true,
            content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          };
        }
      }

      toolResults.push(result);
      context.messages.push(result);
      produced.push(result);
      await emit({
        type: "tool_execution_end",
        toolCallId: call.id,
        toolName: call.name,
        result,
        isError: Boolean(result.isError),
      });
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    }

    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    // 本轮结束，进入下一轮
    await emit({ type: "turn_end", turnIndex, message: assistant, toolResults });
    turnIndex += 1;
    await emit({ type: "turn_start", turnIndex, timestamp: Date.now() });
  }
}
