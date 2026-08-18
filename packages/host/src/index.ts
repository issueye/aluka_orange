import {
  PROTOCOL_VERSION,
  type PingResult,
  type RuntimeInfo,
} from "@aluka/desktop-contracts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PRODUCT_VERSION = "0.1.0";

function defaultAgentDir(): string {
  return path.join(os.homedir(), ".aluka", "agent");
}

/** Phase 0 Host：无 Agent，仅健康检查与运行时信息。 */
export function createPhase0Host() {
  return {
    ping(): PingResult {
      return { ok: true, ts: Date.now(), protocolVersion: PROTOCOL_VERSION };
    },
    getRuntimeInfo(): RuntimeInfo {
      const agentDir = defaultAgentDir();
      try {
        fs.mkdirSync(agentDir, { recursive: true });
      } catch {
        /* ignore */
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

export type Phase0Host = ReturnType<typeof createPhase0Host>;
