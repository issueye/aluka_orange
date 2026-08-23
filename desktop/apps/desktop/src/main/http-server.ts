/**
 * 主进程内嵌 HTTP 服务（M2，见 docs/http-and-plugin-roadmap.md）
 *
 * 基于运行时 Aluka.serve（fetch 风格 handler；同步文本响应，无 WS upgrade）：
 * - GET  /            静态目录（dist/ui；打包态无磁盘资产时不注册静态）
 * - POST /rpc/<name>  复用主进程 RPC handler 表（与 window.aluka.rpc 双注册同源）
 * - GET  /events      事件长轮询（?since=<seq>，挂起至有新事件或 20s 超时）
 *
 * 安全（本地威胁模型）：
 * - 只绑 127.0.0.1，端口随机；
 * - RPC 与事件必须携带启动 token（query `token` 或 `x-aluka-token` 头）；
 * - 校验 Host 头（防 DNS rebinding）与 Origin（防浏览器跨站）。
 *
 * 限制：响应体经字符串写入，仅服务文本资产（html/js/css/svg/json/map）；
 * 打包 exe 的资产内嵌于 aluka:// 虚拟协议，静态走磁盘目录的场景为开发态。
 */
import fs from "node:fs";
import path from "node:path";

/** 与 app.registerRPC 注册的同一 handler 形状 */
export type RpcHandler = (params: unknown) => unknown;

export type HttpServerOptions = {
  /** 静态目录（dist/ui）；缺省或不存在则不提供静态文件 */
  staticDir?: string;
  /** RPC 处理表（与 app.registerRPC 双注册维护） */
  rpcHandlers: Map<string, RpcHandler>;
  /** 固定端口（开发态；缺省随机分配） */
  port?: number;
  /** 固定 token（开发态配合 vite 代理；缺省随机生成） */
  token?: string;
};

export type HttpBridgeServer = {
  /** 实际监听端口（随机分配） */
  port: number;
  /** 是否在提供静态页面 */
  servingStatic: boolean;
  /** 带 token 的首页地址（servingStatic 时供 GUI createWindow / 浏览器直开） */
  pageUrl: string;
  /** 事件扇出：写入长轮询队列并唤醒挂起的轮询 */
  emit: (name: string, data: unknown) => void;
  stop: () => void;
};

/** —— 运行时 Aluka.serve 的最小契约（Go 运行时注入的 globalThis.Aluka） —— */
type ServeRequest = {
  method: string;
  /** 请求 URI（含查询串） */
  url: string;
  headers: Record<string, string>;
  body?: string;
};
type AlukaGlobal = {
  serve(opts: {
    port?: number;
    hostname?: string;
    fetch: (req: ServeRequest) => unknown;
  }): { port: number; url: string; stop: () => Promise<void> };
};

const POLL_HANG_MS = 20_000;
const EVENT_RING_SIZE = 500;

type QueuedEvent = { seq: number; name: string; data: unknown };
type Poller = {
  since: number;
  finish: (events: QueuedEvent[]) => void;
  timer: ReturnType<typeof setTimeout>;
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".map": "application/json",
};

function jsonResponse(payload: unknown, status = 200): unknown {
  // 运行时 Response.json：JSON.stringify + Content-Type（DOM Response 类型仅供编辑器提示）
  return (Response as unknown as {
    json: (data: unknown, init?: { status?: number }) => unknown;
  }).json(payload, { status });
}

function textResponse(body: string, status: number, contentType: string): unknown {
  return new Response(body, {
    status,
    headers: { "content-type": contentType },
  } as ResponseInit);
}

/** 生成 256bit 级随机 token（本地威胁模型：Math.random 混合时间戳即可，不依赖 node:crypto） */
function makeToken(): string {
  let out = "";
  for (let i = 0; i < 8; i++) out += Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, "0");
  return out + Date.now().toString(16);
}

/** 手工解析查询串（避免依赖运行时 URL/URLSearchParams 的覆盖度） */
function parseQuery(query: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const key = decodeURIComponent(eq >= 0 ? pair.slice(0, eq) : pair);
    out[key] = eq >= 0 ? decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, " ")) : "";
  }
  return out;
}

export function startHttpServer(opts: HttpServerOptions): HttpBridgeServer {
  const runtime = (globalThis as { Aluka?: AlukaGlobal }).Aluka;
  if (!runtime) throw new Error("Aluka.serve unavailable（需要 aluka 运行时）");

  const token = opts.token?.trim() || makeToken();
  const staticRoot = opts.staticDir && fs.existsSync(path.join(opts.staticDir, "index.html"))
    ? path.resolve(opts.staticDir)
    : undefined;

  // —— 事件队列与长轮询 ——
  let seq = 0;
  const events: QueuedEvent[] = [];
  const pollers = new Set<Poller>();

  function emit(name: string, data: unknown): void {
    const event = { seq: ++seq, name, data };
    events.push(event);
    if (events.length > EVENT_RING_SIZE) events.splice(0, events.length - EVENT_RING_SIZE);
    flushPollers();
  }

  function flushPollers(): void {
    for (const poller of [...pollers]) {
      const pending = events.filter((event) => event.seq > poller.since);
      if (pending.length) settlePoller(poller, pending);
    }
  }

  function settlePoller(poller: Poller, pending: QueuedEvent[]): void {
    pollers.delete(poller);
    clearTimeout(poller.timer);
    poller.finish(pending);
  }

  function pollEvents(since: number): Promise<unknown> {
    const pending = events.filter((event) => event.seq > since);
    if (pending.length) return Promise.resolve(jsonResponse({ events: pending, last: seq }));
    return new Promise((resolve) => {
      const poller: Poller = {
        since,
        finish: (delivered) => resolve(jsonResponse({ events: delivered, last: seq })),
        timer: setTimeout(() => settlePoller(poller, []), POLL_HANG_MS),
      };
      pollers.add(poller);
    });
  }

  function serveStatic(pathname: string): unknown {
    const rel = pathname === "/" ? "index.html" : pathname.slice(1);
    const full = path.resolve(staticRoot!, rel);
    // 防目录穿越：解析后必须仍在静态根内
    if (full !== staticRoot && !full.startsWith(staticRoot! + path.sep)) {
      return textResponse("forbidden", 403, "text/plain; charset=utf-8");
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      return textResponse("not found", 404, "text/plain; charset=utf-8");
    }
    if (!stat.isFile()) return textResponse("not found", 404, "text/plain; charset=utf-8");
    const type = MIME[path.extname(full).toLowerCase()];
    if (!type) return textResponse("unsupported asset type", 415, "text/plain; charset=utf-8");
    return textResponse(fs.readFileSync(full, "utf8"), 200, type);
  }

  function authorized(query: Record<string, string>, req: ServeRequest): boolean {
    const provided = query.token
      ?? req.headers["x-aluka-token"]
      ?? req.headers["X-Aluka-Token"]
      ?? "";
    return provided === token;
  }

  async function handleRequest(req: ServeRequest): Promise<unknown> {
    const qIndex = req.url.indexOf("?");
    const pathname = qIndex >= 0 ? req.url.slice(0, qIndex) : req.url;
    const query = parseQuery(qIndex >= 0 ? req.url.slice(qIndex + 1) : "");

    // Host 校验（防 DNS rebinding）
    const host = (req.headers["Host"] ?? req.headers["host"] ?? "").split(",")[0].trim().toLowerCase();
    if (host !== `127.0.0.1:${server.port}` && host !== `localhost:${server.port}`) {
      return jsonResponse({ error: "bad host" }, 403);
    }

    if (req.method === "POST" && pathname.startsWith("/rpc/")) {
      if (!authorized(query, req)) return jsonResponse({ error: "unauthorized" }, 403);
      // Origin 校验（防浏览器跨站；非浏览器客户端无 Origin，凭 token 放行）
      const origin = req.headers["Origin"] ?? req.headers["origin"];
      if (origin && origin !== `http://127.0.0.1:${server.port}` && origin !== `http://localhost:${server.port}`) {
        return jsonResponse({ error: "bad origin" }, 403);
      }
      const name = decodeURIComponent(pathname.slice("/rpc/".length));
      const handler = opts.rpcHandlers.get(name);
      if (!handler) return jsonResponse({ error: `unknown method: ${name}` }, 404);
      let params: unknown = {};
      if (req.body && req.body.trim()) {
        try {
          params = JSON.parse(req.body);
        } catch {
          return jsonResponse({ error: "invalid json body" }, 400);
        }
      }
      try {
        return jsonResponse({ result: await handler(params) }, 200);
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    if (req.method === "GET" && pathname === "/events") {
      if (!authorized(query, req)) return jsonResponse({ error: "unauthorized" }, 403);
      const since = Number.parseInt(query.since ?? "0", 10) || 0;
      return pollEvents(since);
    }

    if (staticRoot && req.method === "GET") {
      return serveStatic(pathname);
    }

    return textResponse("not found", 404, "text/plain; charset=utf-8");
  }

  const server = runtime.serve({
    port: opts.port ?? 0,
    hostname: "127.0.0.1",
    fetch: (req) => handleRequest(req),
  });

  return {
    port: server.port,
    servingStatic: Boolean(staticRoot),
    pageUrl: `http://127.0.0.1:${server.port}/?token=${token}`,
    emit,
    stop: () => void server.stop(),
  };
}
