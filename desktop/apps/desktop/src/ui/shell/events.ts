/**
 * 壳层运行时事件路由
 *
 * 处理 agent_start/end、text_delta、message_end、tool_start/end、
 * extension_ui、usage、error 等 runtime.event，以及 prompt.result、
 * session.share、workspace.choose、update.check 桥接事件。
 * 多会话并行：事件按 sessionId 分流，非活跃会话只更新运行标记与列表。
 */
import { bridge } from "../bridge.ts";
import type { ChooseWorkspaceResult, ExtensionUiRequest, SessionUsageView, TimelineItem } from "../types.ts";
import { applyOpened, refreshSessions } from "./actions.ts";
import {
  rememberTimeline,
  sessionStore,
  shellStore,
  streamingRef,
  streamingThinkingRef,
  streamingThinkingStartRef,
  timelineCache,
  toast,
} from "./store.ts";

/** 时间线提交：更新 store 并同步本地缓存 */
function commitTimeline(updater: (prev: TimelineItem[]) => TimelineItem[]): void {
  const next = updater(sessionStore.get().timeline);
  const { cwd, id } = sessionStore.get().sessionRef;
  rememberTimeline(cwd, id, next);
  sessionStore.set({ timeline: next });
}

/** 会话运行标记（含后台会话） */
function markBusy(id: string, on: boolean): void {
  sessionStore.set((prev) => {
    const next = new Set(prev.busyIds);
    if (on) next.add(id);
    else next.delete(id);
    return { busyIds: next };
  });
}

function onRuntime(raw: unknown): void {
  const event = raw as {
    type: string;
    sessionId?: string;
    text?: string;
    thinking?: string;
    role?: string;
    toolName?: string;
    toolCallId?: string;
    args?: unknown;
    resultText?: string;
    isError?: boolean;
    message?: string;
    request?: ExtensionUiRequest;
    usage?: SessionUsageView;
    images?: TimelineItem["images"];
    customType?: string;
    data?: unknown;
  };
  if (!event || typeof event !== "object") return;
  const sid = event.sessionId;
  const activeId = sessionStore.get().activeId;
  const isActiveEvent = !sid || sid === activeId;
  if (event.type === "agent_start") {
    if (sid) markBusy(sid, true);
    if (!isActiveEvent) return;
    streamingThinkingRef.current = "";
    streamingThinkingStartRef.current = 0;
    sessionStore.set({ busy: true, streaming: "", thinking: "" });
    return;
  }
  if (event.type === "agent_end") {
    if (sid) markBusy(sid, false);
    if (!isActiveEvent) {
      // 后台会话完成：刷新列表标题/时间
      void refreshSessions();
      return;
    }
    sessionStore.set({ busy: false });
    const leftover = streamingRef.current.trim();
    const leftoverThinking = streamingThinkingRef.current.trim();
    const thinkingMs =
      leftoverThinking && streamingThinkingStartRef.current
        ? Date.now() - streamingThinkingStartRef.current
        : undefined;
    streamingRef.current = "";
    streamingThinkingRef.current = "";
    streamingThinkingStartRef.current = 0;
    sessionStore.set({ streaming: "", thinking: "" });
    if (leftover || leftoverThinking) {
      commitTimeline((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last.text === leftover) {
          if (leftoverThinking && !last.thinking) {
            return [...prev.slice(0, -1), { ...last, thinking: leftoverThinking, thinkingMs }];
          }
          return prev;
        }
        return [
          ...prev,
          {
            id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            role: "assistant",
            text: leftover,
            thinking: leftoverThinking || undefined,
            thinkingMs,
            timestamp: Date.now(),
          },
        ];
      });
    }
    void refreshSessions();
    return;
  }
  // 其余事件只作用于当前活跃会话的时间线
  if (!isActiveEvent) return;
  if (event.type === "text_delta" && event.text) {
    streamingRef.current += event.text;
    sessionStore.set({ streaming: streamingRef.current });
    return;
  }
  if (event.type === "thinking_delta" && event.text) {
    if (!streamingThinkingStartRef.current) streamingThinkingStartRef.current = Date.now();
    streamingThinkingRef.current += event.text;
    sessionStore.set({ thinking: streamingThinkingRef.current });
    return;
  }
  if (event.type === "entry_added" && event.customType) {
    commitTimeline((prev) => [
      ...prev,
      {
        id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role: "custom",
        text: "",
        customType: event.customType,
        customData: event.data,
        timestamp: Date.now(),
      },
    ]);
    return;
  }
  if (event.type === "message_end" && event.role === "user" && event.text != null) {
    const images = event.images;
    commitTimeline((prev) => [
      ...prev,
      {
        id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role: "user",
        text: event.text!,
        images,
        timestamp: Date.now(),
      },
    ]);
    return;
  }
  if (event.type === "message_end" && event.role === "assistant" && event.text != null) {
    streamingRef.current = "";
    sessionStore.set({ streaming: "" });
    const thinking = (event.thinking ?? streamingThinkingRef.current).trim();
    const thinkingMs =
      thinking && streamingThinkingStartRef.current
        ? Date.now() - streamingThinkingStartRef.current
        : undefined;
    streamingThinkingRef.current = "";
    streamingThinkingStartRef.current = 0;
    sessionStore.set({ thinking: "" });
    if (!event.text.trim() && !thinking) return;
    const item: TimelineItem = {
      id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      role: "assistant",
      text: event.text!,
      thinking: thinking || undefined,
      thinkingMs,
      timestamp: Date.now(),
    };
    commitTimeline((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === "assistant" && last.text === event.text) {
        if (thinking && !last.thinking) {
          return [...prev.slice(0, -1), { ...last, thinking, thinkingMs }];
        }
        return prev;
      }
      return [...prev, item];
    });
    return;
  }
  if (event.type === "tool_start") {
    const toolCallId = event.toolCallId;
    commitTimeline((prev) => [
      ...prev,
      {
        id: toolCallId || `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role: "tool",
        text: "",
        toolName: event.toolName,
        timestamp: Date.now(),
        toolCallId,
        args: event.args,
        toolStatus: "running",
      },
    ]);
    return;
  }
  if (event.type === "tool_end") {
    const toolCallId = event.toolCallId;
    const resultText = String(event.resultText ?? "");
    commitTimeline((prev) => {
      const index = toolCallId ? prev.findIndex((item) => item.toolCallId === toolCallId) : -1;
      const patch: Partial<TimelineItem> = {
        text: resultText,
        resultText,
        isError: event.isError,
        toolStatus: event.isError ? "error" : "done",
        toolName: event.toolName,
      };
      if (index >= 0) {
        const next = [...prev];
        next[index] = { ...next[index], ...patch };
        return next;
      }
      return [
        ...prev,
        {
          id: toolCallId || `tr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          role: "tool",
          timestamp: Date.now(),
          toolCallId,
          ...patch,
          text: resultText,
        },
      ];
    });
    return;
  }
  if (event.type === "extension_ui" && event.request) {
    if (event.request.kind === "notify") {
      toast(event.request.message, event.request.level);
      return;
    }
    shellStore.set({ modal: event.request, selectChoice: undefined, modalInput: "" });
    return;
  }
  if (event.type === "usage" && event.usage) {
    sessionStore.set({ usage: event.usage });
    return;
  }
  if (event.type === "error" && event.message) {
    if (sid) markBusy(sid, false);
    commitTimeline((prev) => [
      ...prev,
      {
        id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role: "system",
        text: event.message!,
        timestamp: Date.now(),
      },
    ]);
    if (isActiveEvent) sessionStore.set({ busy: false });
  }
}

function onPromptResult(raw: unknown): void {
  const result = raw as { ok?: boolean; error?: string; sessionId?: string };
  const sid = result?.sessionId;
  if (sid) {
    sessionStore.set((prev) => {
      const next = new Set(prev.busyIds);
      next.delete(sid);
      return { busyIds: next };
    });
  }
  if (sid && sid !== sessionStore.get().activeId) {
    // 后台会话的请求结束：只刷新列表
    void refreshSessions();
    return;
  }
  if (result?.ok === false && result.error) toast(result.error, "error");
  sessionStore.set({ busy: false });
  void refreshSessions();
}

function onShare(raw: unknown): void {
  const result = raw as { ok?: boolean; error?: string; gistUrl?: string; gistId?: string };
  if (result?.ok && result.gistUrl) {
    toast(`已分享 Gist ${result.gistId ?? ""}`, "info");
    shellStore.set({ status: `已分享 → ${result.gistUrl}` });
    setTimeout(() => shellStore.set({ status: shellStore.get().idleStatus }), 4000);
    return;
  }
  toast(result?.error ?? "分享失败", "error");
  shellStore.set({ status: shellStore.get().idleStatus });
}

function onWorkspaceChoose(raw: unknown): void {
  const result = raw as ChooseWorkspaceResult & { error?: string };
  if (!result || typeof result !== "object") return;
  if (result.cancelled) {
    if (result.error) {
      toast(result.error, "error");
      shellStore.set({ wsPathDraft: sessionStore.get().sessionRef.cwd ?? "" });
      shellStore.set({ wsPathOpen: true });
    }
    return;
  }
  void applyOpened(result);
}

function onUpdateCheck(raw: unknown): void {
  const result = raw as {
    skipped?: boolean;
    reason?: string;
    error?: string;
    upToDate?: boolean;
    current?: string;
    latest?: string;
    url?: string;
  };
  if (result?.skipped) {
    shellStore.set({ updateHint: result.reason ?? "已跳过更新检查" });
    return;
  }
  if (result?.error) {
    shellStore.set({ updateHint: `更新检查失败：${result.error}` });
    return;
  }
  if (result?.upToDate) {
    shellStore.set({
      updateHint: `已是最新（当前 ${result.current}，最新 ${result.latest}）`,
    });
    return;
  }
  shellStore.set({
    updateHint: `发现新版本：${result?.latest}（当前 ${result?.current}）${result?.url ? ` · ${result.url}` : ""}`,
  });
}

/** 扩展页「提示词 → 插入输入框」：把提示词正文追加到对话输入框并切回对话视图 */
function onPromptInsert(event: Event): void {
  const detail = (event as CustomEvent<{ text?: string }>).detail;
  const text = detail?.text?.trim();
  if (!text) return;
  sessionStore.set((prev) => ({
    prompt: prev.prompt.trim() ? `${prev.prompt.trim()}\n\n${text}` : text,
  }));
  shellStore.set({ view: "chat" });
  toast("已插入提示词到输入框", "info");
}

/**
 * 挂载全部运行时事件监听，返回卸载函数（cleanup 幂等）。
 */
export function attachRuntimeEvents(): () => void {
  const bus = bridge().events;
  bus.on("runtime.event", onRuntime);
  bus.on("prompt.result", onPromptResult);
  bus.on("session.share", onShare);
  bus.on("workspace.choose", onWorkspaceChoose);
  bus.on("update.check", onUpdateCheck);
  window.addEventListener("aluka:prompt-insert", onPromptInsert);
  return () => {
    bus.off("runtime.event", onRuntime);
    bus.off("prompt.result", onPromptResult);
    bus.off("session.share", onShare);
    bus.off("workspace.choose", onWorkspaceChoose);
    bus.off("update.check", onUpdateCheck);
    window.removeEventListener("aluka:prompt-insert", onPromptInsert);
  };
}
