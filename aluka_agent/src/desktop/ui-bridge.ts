/**
 * 桌面扩展 UI：confirm/select/input/notify 经事件桥到 WebView，
 * 由前端 respondExtensionUi 回填 Promise。
 */

import { createConsoleUI } from "../extensions/ui.ts";
import type { ExtensionUIContext } from "../extensions/types.ts";

export type ExtensionUiRequest =
  | { id: string; kind: "notify"; message: string; level: "info" | "warning" | "error" }
  | { id: string; kind: "confirm"; title: string; message: string }
  | { id: string; kind: "select"; title: string; options: string[] }
  | { id: string; kind: "input"; title: string; placeholder?: string };

export type ExtensionUiResponse =
  | { id: string; kind: "confirm"; value: boolean }
  | { id: string; kind: "select"; value?: string }
  | { id: string; kind: "input"; value?: string };

type Pending = {
  kind: "confirm" | "select" | "input";
  resolve: (value: unknown) => void;
};

export interface DesktopUI extends ExtensionUIContext {
  respond(response: ExtensionUiResponse): void;
}

export function createDesktopUI(onRequest: (request: ExtensionUiRequest) => void): DesktopUI {
  const base = createConsoleUI();
  const pending = new Map<string, Pending>();
  let seq = 0;
  const nextId = () => `extui_${++seq}_${Date.now()}`;

  return {
    ...base,
    notify(message, type = "info") {
      onRequest({ id: nextId(), kind: "notify", message, level: type });
    },
    confirm(title, message) {
      return new Promise<boolean>((resolve) => {
        const id = nextId();
        pending.set(id, { kind: "confirm", resolve: resolve as (value: unknown) => void });
        onRequest({ id, kind: "confirm", title, message });
      });
    },
    select(title, options) {
      return new Promise<string | undefined>((resolve) => {
        const id = nextId();
        pending.set(id, { kind: "select", resolve: resolve as (value: unknown) => void });
        onRequest({ id, kind: "select", title, options });
      });
    },
    input(title, placeholder) {
      return new Promise<string | undefined>((resolve) => {
        const id = nextId();
        pending.set(id, { kind: "input", resolve: resolve as (value: unknown) => void });
        onRequest({ id, kind: "input", title, placeholder });
      });
    },
    respond(response) {
      const wait = pending.get(response.id);
      if (!wait) return;
      pending.delete(response.id);
      if (response.kind === "confirm" && wait.kind === "confirm") {
        wait.resolve(Boolean(response.value));
        return;
      }
      if (response.kind === "select" && wait.kind === "select") {
        wait.resolve(response.value);
        return;
      }
      if (response.kind === "input" && wait.kind === "input") {
        wait.resolve(response.value);
      }
    },
  };
}
