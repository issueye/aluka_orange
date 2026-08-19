/**
 * 事件总线模块
 *
 * 提供发布-订阅模式的事件系统，用于扩展间的通信。
 * 支持事件订阅、取消订阅和异步事件分发。
 */

/** 事件处理函数类型 */
export type EventBusHandler = (payload: unknown) => void | Promise<void>;

/**
 * 事件总线接口
 * 定义了事件订阅和发布的标准 API
 */
export interface EventBus {
  /** 订阅事件，返回取消订阅函数 */
  on(event: string, handler: EventBusHandler): () => void;
  /** 取消订阅事件 */
  off(event: string, handler: EventBusHandler): void;
  /** 发布事件，依次调用所有订阅者 */
  emit(event: string, payload?: unknown): Promise<void>;
}

/** 可控制的事件总线（额外提供清空功能） */
export interface EventBusController extends EventBus {
  /** 清空所有事件订阅 */
  clear(): void;
}

/**
 * 创建事件总线实例
 *
 * 使用 Map 存储事件名到处理函数集合的映射。
 * emit 时按订阅顺序依次调用所有处理器。
 */
export function createEventBus(): EventBusController {
  const handlers = new Map<string, Set<EventBusHandler>>();
  return {
    /** 订阅事件 */
    on(event, handler) {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(handler);
      return () => this.off(event, handler);
    },
    /** 取消订阅 */
    off(event, handler) {
      handlers.get(event)?.delete(handler);
    },
    /** 异步发布事件，依次调用所有处理器 */
    async emit(event, payload) {
      const set = handlers.get(event);
      if (!set) return;
      for (const handler of [...set]) {
        await handler(payload);
      }
    },
    /** 清空所有订阅 */
    clear() {
      handlers.clear();
    },
  };
}
