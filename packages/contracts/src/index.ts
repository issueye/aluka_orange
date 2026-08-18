/** Host ↔ UI 协议版本（破坏性变更必须 bump）。 */
export const PROTOCOL_VERSION = 1 as const;

export interface PingResult {
  ok: true;
  ts: number;
  protocolVersion: typeof PROTOCOL_VERSION;
}

export interface RuntimeInfo {
  protocolVersion: typeof PROTOCOL_VERSION;
  product: "aluka-desktop";
  productVersion: string;
  platform: string;
  arch: string;
  agentDirHint: string;
  phase: "0" | "1" | "2" | "3" | "4";
}

/** Phase 0 RPC 方法名。 */
export type Phase0RpcMethod = "ping" | "getRuntimeInfo";
