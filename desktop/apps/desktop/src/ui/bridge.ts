/**
 * Aluka GUI Bridge 模块
 *
 * 提供渲染进程（UI）与主进程之间的通信桥接：
 * - window.aluka：由原生 GUI 框架注入的全局桥接对象
 * - events：发布/订阅事件总线，用于接收运行时事件
 * - rpc：远程过程调用，用于调用主进程注册的 RPC 方法
 */

/**
 * Aluka 桥接对象类型定义
 * 对应 Zeno 风格的 renderer → host 调用接口
 */
export type AlukaBridge = {
  /** 窗口控制：最小化、最大化切换、关闭 */
  window: {
    minimize: () => void;
    toggleMaximize: () => void;
    close: () => void;
    /** 调整窗口尺寸（无边框窗口用于拖角缩放；部分运行时可能不提供） */
    setSize?: (width: number, height: number) => void;
    /** 查询窗口尺寸：回包 [width, height] 或 { width, height } */
    getSize?: () => Promise<unknown>;
  };
  /** 事件总线：支持发布/订阅模式 */
  events: {
    on: (name: string, handler: (data: unknown) => void) => void;
    off: (name: string, handler: (data: unknown) => void) => void;
    emit: (name: string, data?: unknown) => void;
  };
  /** RPC 调用：向主进程发起远程调用 */
  rpc: {
    call: (method: string, params?: unknown) => Promise<unknown>;
  };
};

let httpBridge: AlukaBridge | undefined;

/**
 * HTTP 降级传输：浏览器直开 http://127.0.0.1:<port>/?token=… 时启用（无 window.aluka 注入）。
 * - rpc：POST /rpc/<method>（x-aluka-token 头，见主进程 http-server.ts）
 * - events：/events 长轮询循环（有订阅者时启动；断线 1s 退避重连）
 * - 窗口控制为 no-op（浏览器无窗口控制能力）
 */
function createHttpBridge(): AlukaBridge {
  // token 优先取页面查询串（GUI/浏览器直开）；开发态（vite HMR）由 VITE_ALUKA_TOKEN 注入
  const envToken = (import.meta as { env?: { VITE_ALUKA_TOKEN?: string } }).env?.VITE_ALUKA_TOKEN;
  const token = new URLSearchParams(window.location.search).get("token") ?? envToken ?? "";
  const base = window.location.origin;
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  let since = 0;
  let polling = false;

  async function pump(): Promise<void> {
    if (polling) return;
    polling = true;
    while (listeners.size > 0) {
      try {
        const res = await fetch(`${base}/events?since=${since}`, {
          headers: { "x-aluka-token": token },
        });
        if (!res.ok) throw new Error(`events poll failed: ${res.status}`);
        const payload = (await res.json()) as {
          events?: Array<{ seq: number; name: string; data: unknown }>;
          last?: number;
        };
        for (const event of payload.events ?? []) {
          since = Math.max(since, event.seq);
          for (const handler of [...(listeners.get(event.name) ?? [])]) {
            try {
              handler(event.data);
            } catch {
              // 单个订阅者异常不中断轮询
            }
          }
        }
        if (typeof payload.last === "number") since = Math.max(since, payload.last);
      } catch {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
    }
    polling = false;
  }

  return {
    window: {
      minimize: () => console.warn("[aluka-bridge] 浏览器模式不支持窗口控制"),
      toggleMaximize: () => console.warn("[aluka-bridge] 浏览器模式不支持窗口控制"),
      close: () => console.warn("[aluka-bridge] 浏览器模式不支持窗口控制"),
    },
    events: {
      on(name, handler) {
        let set = listeners.get(name);
        if (!set) {
          set = new Set();
          listeners.set(name, set);
        }
        set.add(handler);
        void pump();
      },
      off(name, handler) {
        const set = listeners.get(name);
        if (!set) return;
        set.delete(handler);
        if (set.size === 0) listeners.delete(name);
      },
      emit(name, data) {
        // UI → 主进程方向（ui-ready 等）：HTTP 模式无对端，静默忽略
        console.debug("[aluka-bridge] emit ignored (http transport):", name, data);
      },
    },
    rpc: {
      async call(method, params) {
        const res = await fetch(`${base}/rpc/${encodeURIComponent(method)}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-aluka-token": token },
          body: JSON.stringify(params ?? {}),
        });
        const payload = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string };
        if (!res.ok) throw new Error(payload.error ?? `rpc ${method} failed: ${res.status}`);
        return payload.result;
      },
    },
  };
}

/**
 * 获取全局桥接对象
 *
 * 优先返回 GUI 壳注入的 window.aluka（窗口内，含原生窗口控制）；
 * 缺省时降级为 HTTP 传输（浏览器直开页面，见 createHttpBridge）。
 */
export function bridge(): AlukaBridge {
  if (window.aluka) return window.aluka;
  if (!httpBridge) httpBridge = createHttpBridge();
  return httpBridge;
}

/**
 * 便捷 RPC 调用封装
 * @param method - RPC 方法名
 * @param params - 可选参数
 * @returns 调用结果（已类型转换为 T）
 */
export async function rpc<T = unknown>(method: string, params?: unknown): Promise<T> {
  return (await bridge().rpc.call(method, params ?? {})) as T;
}

/** 全局类型声明：扩展 Window 接口以包含 aluka 桥接对象 */
declare global {
  interface Window {
    aluka?: AlukaBridge;
  }
}
