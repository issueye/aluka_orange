/**
 * Aluka GUI bridge — mirrors Zeno renderer host calls via window.aluka.
 */

export type AlukaBridge = {
  window: {
    minimize: () => void;
    toggleMaximize: () => void;
    close: () => void;
  };
  events: {
    on: (name: string, handler: (data: unknown) => void) => void;
    off: (name: string, handler: (data: unknown) => void) => void;
    emit: (name: string, data?: unknown) => void;
  };
  rpc: {
    call: (method: string, params?: unknown) => Promise<unknown>;
  };
};

export function bridge(): AlukaBridge {
  if (!window.aluka) throw new Error("window.aluka unavailable");
  return window.aluka;
}

export async function rpc<T = unknown>(method: string, params?: unknown): Promise<T> {
  return (await bridge().rpc.call(method, params ?? {})) as T;
}

declare global {
  interface Window {
    aluka?: AlukaBridge;
  }
}
