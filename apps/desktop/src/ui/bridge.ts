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

/**
 * 获取全局桥接对象
 * @throws 当 window.aluka 未注入时抛出错误
 */
export function bridge(): AlukaBridge {
  if (!window.aluka) throw new Error("window.aluka unavailable");
  return window.aluka;
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
