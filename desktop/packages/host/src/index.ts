import {
  PROTOCOL_VERSION,
  type PingResult,
  type RuntimeInfo,
} from "@aluka/desktop-contracts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** 产品版本号，与 aluka_pi 保持同步 */
const PRODUCT_VERSION = "0.1.0";

/** 获取默认的 Agent 数据目录：~/.aluka/agent */
function defaultAgentDir(): string {
  return path.join(os.homedir(), ".aluka", "agent");
}

/**
 * Phase 0 Host：无 Agent，仅健康检查与运行时信息。
 * 这是最简形态的 Host，提供 ping 和 getRuntimeInfo 两个基础 RPC。
 * 后续阶段（Phase 1+）会在此基础上扩展会话管理、Prompt 发送等能力。
 */
export function createPhase0Host() {
  return {
    /** 健康检查：返回协议版本、时间戳，确认 Host 在线 */
    ping(): PingResult {
      return { ok: true, ts: Date.now(), protocolVersion: PROTOCOL_VERSION };
    },
    /** 获取运行时信息：协议版本、产品名、平台架构、Agent 目录等 */
    getRuntimeInfo(): RuntimeInfo {
      const agentDir = defaultAgentDir();
      // 确保 Agent 数据目录存在
      try {
        fs.mkdirSync(agentDir, { recursive: true });
      } catch {
        /* 忽略创建失败，目录可能已存在 */
      }
      return {
        protocolVersion: PROTOCOL_VERSION,
        product: "aluka-desktop",
        productVersion: PRODUCT_VERSION,
        platform: process.platform,
        arch: process.arch,
        agentDirHint: agentDir,
        phase: "0",
      };
    },
  };
}

/** Phase0Host 的类型别名 */
export type Phase0Host = ReturnType<typeof createPhase0Host>;
