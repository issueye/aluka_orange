/**
 * Agent 模块入口
 *
 * 导出 Agent 核心类型和循环控制函数。
 */

// 类型和工具函数
export {
  convertToLlm,
  textFrom,
  type AgentContext,
  type AgentEvent,
  type AgentEventSink,
  type AgentLoopConfig,
  type AgentMessage,
  type AgentTool,
  type AgentToolCall,
  type AgentToolResult,
  type AgentToolUpdateCallback,
  type CustomMessage,
} from "./types.ts";

// Agent 主循环
export { runAgentLoop } from "./loop.ts";
