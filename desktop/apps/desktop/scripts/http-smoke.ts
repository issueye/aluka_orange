/**
 * http-server 无头冒烟（M2 验证用，不经 GUI）：
 *
 *   aluka.exe run scripts/http-smoke.ts
 *
 * 启动后打印带 token 的页面地址；内置验证 RPC：
 * - ping / echo：常规 RPC 往返
 * - __testEmit：向事件通道注入一条 runtime.event（验证长轮询推送）
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { startHttpServer, type RpcHandler, type HttpBridgeServer } from "../src/main/http-server.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(__dirname, "../dist/ui");

let server: HttpBridgeServer;

const rpcHandlers = new Map<string, RpcHandler>();
rpcHandlers.set("ping", () => ({ ok: true, ts: Date.now() }));
rpcHandlers.set("echo", (p) => p);
rpcHandlers.set("__testEmit", (p) => {
  server.emit("runtime.event", p);
  return { ok: true };
});
// —— UI 启动所需的最小 RPC 集（纯假数据） ——
rpcHandlers.set("getRuntimeInfo", () => ({
  protocolVersion: 1,
  product: "aluka-desktop",
  productVersion: "0.0.0-smoke",
  platform: process.platform,
  arch: process.arch,
  agentDirHint: "",
  phase: "5",
  hostReady: true,
}));
rpcHandlers.set("getActiveSessionId", () => ({ }));
rpcHandlers.set("getTimeline", () => ({ items: [] }));
rpcHandlers.set("listSessions", () => []);
rpcHandlers.set("listWorkspaces", () => []);
rpcHandlers.set("getSettings", () => ({}));
rpcHandlers.set("listModelOptions", () => []);
rpcHandlers.set("getSessionUsage", () => null);
rpcHandlers.set("listExtensions", () => ({ extensions: [], errors: [] }));
rpcHandlers.set("listPrompts", () => []);
rpcHandlers.set("listSkills", () => []);

server = startHttpServer({ staticDir, rpcHandlers });

console.log(`[http-smoke] pageUrl=${server.pageUrl}`);
console.log(`[http-smoke] port=${server.port} servingStatic=${server.servingStatic}`);

// 保持进程存活（serve 本身持有引用，这里兜底；延时勿用超大值，运行时定时器按 int 处理会溢出成忙循环）
setInterval(() => {}, 60_000);
