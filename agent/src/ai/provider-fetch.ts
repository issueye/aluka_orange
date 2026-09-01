/**
 * 供应商 HTTP 请求：把 proxy 传给运行时 fetch。
 *
 * Aluka 的 fetch 读取 init.proxy（http / https / socks5）。
 * Node 自带 fetch 会忽略该字段。
 *
 * 空闲超时：网关偶发 502 后可能接受连接却不返回任何数据，
 * 没有超时会让会话永远停留在「处理中」。超时抛 ProviderStallError
 * （区别于用户中止的 AbortError，属于可重试的真实错误）。
 */

export type ProviderFetchInit = RequestInit & { proxy?: string };

/** 空闲超时阶段：headers = 迟迟无响应头；stream = SSE 中途断流；body = 响应体未读完 */
export type ProviderStallPhase = "headers" | "stream" | "body";

export class ProviderStallError extends Error {
  readonly phase: ProviderStallPhase;
  readonly timeoutMs: number;

  constructor(phase: ProviderStallPhase, timeoutMs: number) {
    const seconds = Math.max(1, Math.round(timeoutMs / 1000));
    super(
      phase === "headers"
        ? `Provider request timed out: no response within ${seconds}s (provider or network may be down)`
        : phase === "stream"
          ? `Provider stream timed out: no data received for ${seconds}s`
          : `Provider response timed out: body not completed within ${seconds}s`,
    );
    this.name = "ProviderStallError";
    this.phase = phase;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * 请求空闲超时（毫秒）：env ALUKA_STALL_TIMEOUT_MS 可覆盖。
 * 未设置/非法 → 默认 120s；显式设为 <=0（含 0）→ 禁用（返回 0，调用方按无超时处理）。
 * 只约束「无任何数据到达」的窗口，正常流式输出不受影响。
 */
export function providerStallTimeoutMs(): number {
  const raw = process.env.ALUKA_STALL_TIMEOUT_MS?.trim();
  if (!raw) return 120_000;
  const value = Number(raw);
  if (!Number.isFinite(value)) return 120_000;
  return value > 0 ? value : 0;
}

export function withProxy(init: RequestInit, proxy?: string): ProviderFetchInit {
  const value = proxy?.trim();
  if (!value) return init;
  return { ...init, proxy: value };
}

/**
 * 带空闲超时的 fetch：timeoutMs 内未收到响应头则中止底层请求并抛 ProviderStallError。
 * 外部 signal（用户中止）原样透传，优先于超时。timeoutMs 缺省或 <=0 时不加超时。
 * 响应头到达后底层请求仍挂在内部 controller 上：后续用户中止可继续掐断响应体。
 */
export async function providerFetch(
  url: string,
  init: ProviderFetchInit = {},
  proxy?: string,
  timeoutMs?: number,
): Promise<Response> {
  const outer = init.signal;
  if (!timeoutMs || timeoutMs <= 0) return fetch(url, withProxy(init, proxy));

  const controller = new AbortController();
  const relayAbort = () => controller.abort(outer?.reason);
  if (outer?.aborted) controller.abort(outer?.reason);
  else outer?.addEventListener("abort", relayAbort);
  const timer = setTimeout(() => controller.abort(new ProviderStallError("headers", timeoutMs)), timeoutMs);
  try {
    return await fetch(url, withProxy({ ...init, signal: controller.signal }, proxy));
  } catch (error) {
    if (outer?.aborted) throw error;
    if (error instanceof ProviderStallError) throw error;
    // 部分运行时把自定义 abort reason 吞成 AbortError：按超时还原
    if (controller.signal.aborted) throw new ProviderStallError("headers", timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 给任意 Promise（如 response.json()）加空闲超时；超时先触发 onCancel（掐断响应体）再抛错。
 */
export async function raceStall<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  phase: ProviderStallPhase,
  onCancel?: () => void,
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stall = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        onCancel?.();
      } catch {
        /* ignore */
      }
      reject(new ProviderStallError(phase, timeoutMs));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, stall]);
  } finally {
    clearTimeout(timer);
  }
}
