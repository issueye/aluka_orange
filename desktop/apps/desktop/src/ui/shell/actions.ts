/**
 * 壳层业务动作（会话 / 工作区 / 设置 / 贡献 / 发送）
 *
 * 全部动作经 shell/session store 更新状态，RPC 经 bridge；
 * 事件路由见 events.ts，启动时序见 init.ts。
 */
import { startTransition } from "react";
import { rpc } from "../bridge.ts";
import { pathsEqual, preferTimeline, readTimelinePayload, sessionKey } from "../lib/utils.ts";
import type {
  ChooseWorkspaceResult,
  ExtensionUiResponse,
  ImageAttachment,
  ModelOption,
  OpenedSession,
  SessionSummary,
  SessionUsageView,
  SettingsView,
  ShellView,
  TimelineItem,
  UiContribution,
} from "../types.ts";
import type { WorkspaceItem } from "../WorkspaceSidebar.tsx";
import {
  pickingFolderRef,
  rememberTimeline,
  sessionStore,
  shellStore,
  sidebarAnimTimer,
  streamingRef,
  timelineCache,
  toast,
} from "./store.ts";

/** 刷新会话列表与工作区树 */
export async function refreshSessions(): Promise<void> {
  const [list, tree] = await Promise.all([
    rpc<SessionSummary[]>("listSessions"),
    rpc<WorkspaceItem[]>("listWorkspaces"),
  ]);
  sessionStore.set({ sessions: list ?? [], workspaces: tree ?? [] });
}

/** 刷新当前会话的 token 用量统计 */
export async function refreshUsage(id?: string): Promise<void> {
  const view = await rpc<SessionUsageView>("getSessionUsage", { id });
  if (view) sessionStore.set({ usage: view });
}

/**
 * 加载全局设置与模型选项。
 * 同时把主题写入 data-theme 属性。
 */
export async function loadSettings(): Promise<void> {
  const s = await rpc<SettingsView>("getSettings");
  shellStore.set({ settings: s ?? {} });
  document.documentElement.setAttribute("data-theme", s?.theme === "light" ? "light" : "dark");
  const options = (await rpc<ModelOption[]>("listModelOptions")) ?? [];
  shellStore.set({ modelOptions: options });
}

/** 拉取 host 时间线，失败时回退本地缓存 */
export async function fetchHostTimeline(cwd?: string, id?: string): Promise<TimelineItem[]> {
  try {
    const raw = await rpc<unknown>("getTimeline");
    return preferTimeline(
      readTimelinePayload(raw),
      timelineCache[sessionKey(cwd, id)] ?? [],
    );
  } catch {
    return timelineCache[sessionKey(cwd, id)] ?? [];
  }
}

/**
 * 打开指定会话：加载时间线、切换到对话视图、刷新列表和用量
 */
export async function applyOpened(opened: OpenedSession): Promise<void> {
  sessionStore.set({ sessionLoading: true });
  try {
    const leftover = streamingRef.current.trim();
    if (leftover) {
      const prevKey = sessionKey(sessionStore.get().sessionRef.cwd, sessionStore.get().sessionRef.id);
      if (prevKey) {
        const prev = timelineCache[prevKey] ?? [];
        const last = prev[prev.length - 1];
        if (!(last?.role === "assistant" && last.text === leftover)) {
          timelineCache[prevKey] = [
            ...prev,
            {
              id: `a-${Date.now()}-park`,
              role: "assistant",
              text: leftover,
              timestamp: Date.now(),
            },
          ];
        }
      }
    }
    sessionStore.set({
      attachments: [],
      activeId: opened.id || undefined,
      sessionRef: { cwd: opened.cwd, id: opened.id || undefined },
    });
    // openSession 已带回时间线，不再重复拉 getTimeline；回退本地缓存
    const next = preferTimeline(
      opened.timeline ?? [],
      timelineCache[sessionKey(opened.cwd, opened.id)] ?? [],
    );
    rememberTimeline(opened.cwd, opened.id, next);
    streamingRef.current = "";
    sessionStore.set({ streaming: "" });
    shellStore.set({ view: "chat" });
    shellStore.set((prev) => ({ settings: { ...prev.settings, cwd: opened.cwd } }));
    // 长会话时间线渲染量大：放进 transition，让侧栏高亮等紧急更新先上屏
    startTransition(() => {
      sessionStore.set({ timeline: next });
    });
    // 剩余数据并行拉取（此前逐个 await 串行等待）
    const [busyState] = await Promise.all([
      rpc<{ busy?: boolean }>("isBusy").catch(() => ({ busy: false })),
      refreshSessions(),
      refreshUsage(opened.id),
    ]);
    sessionStore.set({ busy: Boolean(busyState?.busy) });
  } finally {
    sessionStore.set({ sessionLoading: false });
  }
}

export async function showChat(): Promise<void> {
  shellStore.set({ view: "chat" });
  const { cwd, id } = sessionStore.get().sessionRef;
  const items = await fetchHostTimeline(cwd, id);
  if (items.length) {
    rememberTimeline(cwd, id, items);
    sessionStore.set({ timeline: items });
  }
}

/** 切换壳视图（注册表驱动）：设置页打开时同步刷新设置与用量 */
export function openView(next: ShellView): void {
  shellStore.set({ view: next });
  if (next === "settings") {
    void loadSettings();
    void refreshUsage(sessionStore.get().activeId);
  }
}

export async function openSession(id: string, cwd?: string): Promise<void> {
  const opened = await rpc<OpenedSession>("openSession", { id, cwd });
  await applyOpened(opened);
}

export async function createNewChat(): Promise<void> {
  const created = await rpc<OpenedSession>("createSession", { cwd: shellStore.get().settings.cwd });
  await applyOpened({ ...created, timeline: [] });
}

/** 在指定工作区新建会话并切换到该会话（侧栏工作区项“+”按钮） */
export async function createNewChatIn(cwd: string): Promise<void> {
  const created = await rpc<OpenedSession>("createSession", { cwd });
  await applyOpened({ ...created, timeline: [] });
}

export async function selectWorkspace(dir: string, mode: "latest" | "new" = "latest"): Promise<void> {
  const opened = await rpc<OpenedSession>("selectWorkspace", { path: dir, mode });
  await applyOpened(opened);
}

/** 删除会话（破坏性操作，先弹确认框）：从会话树计算展示标题 */
export function requestDeleteSession(id: string, cwd: string): void {
  const title = (() => {
    for (const ws of sessionStore.get().workspaces) {
      if (!pathsEqual(ws.path, cwd)) continue;
      const s = ws.sessions.find((x) => x.id === id);
      if (s) return s.title || s.id;
    }
    const s = sessionStore.get().sessions.find((x) => x.id === id);
    return (s && (s.title || s.id)) || id;
  })();
  shellStore.set({ deleteConfirm: { id, cwd, title } });
}

/** 确认删除后真正执行 */
export async function confirmDeleteSession(): Promise<void> {
  const target = shellStore.get().deleteConfirm;
  if (!target) return;
  shellStore.set({ deleteConfirm: undefined });
  try {
    const opened = await rpc<OpenedSession>("deleteSession", { id: target.id, cwd: target.cwd });
    if (
      target.id === sessionStore.get().activeId
      && pathsEqual(target.cwd, shellStore.get().settings.cwd ?? "")
    ) {
      await applyOpened(opened);
    } else {
      await refreshSessions();
    }
    toast("会话已删除", "info");
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), "error");
  }
}

/** 手动热重载扩展（全局 header 按钮）：重扫扩展目录 + 重建工具，并刷新相关状态 */
export async function reloadExtensions(): Promise<void> {
  shellStore.set({ extReloading: true });
  try {
    const inv = await rpc<{ extensions?: unknown[]; errors?: unknown[] }>("reloadExtensions");
    const extCount = inv?.extensions?.length ?? 0;
    const errCount = inv?.errors?.length ?? 0;
    await loadSettings();
    // 通知已挂载的扩展 / 技能页面刷新列表
    window.dispatchEvent(new CustomEvent("aluka:extensions-reloaded"));
    shellStore.set({
      status: `已重载扩展：${extCount} 个生效${errCount ? `，${errCount} 个错误` : ""}`,
    });
    setTimeout(() => shellStore.set({ status: shellStore.get().idleStatus }), 2500);
    toast(
      errCount
        ? `扩展已重载：${extCount} 个生效，${errCount} 个加载错误`
        : `已重载扩展（${extCount} 个生效）`,
      errCount ? "warning" : "info",
    );
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), "error");
  } finally {
    shellStore.set({ extReloading: false });
  }
}

/** 从工作区列表移除目录（不删除磁盘文件）；移除当前工作区时切到回退工作区 */
export async function removeWorkspace(dir: string): Promise<void> {
  try {
    const removingActive = pathsEqual(dir, shellStore.get().settings.cwd ?? "");
    const result = await rpc<{ cwd: string; workspaces: WorkspaceItem[] }>("removeWorkspace", {
      path: dir,
    });
    if (removingActive && result?.cwd) {
      // runtime 已切到回退工作区；重新 selectWorkspace 取回 OpenedSession 同步界面
      await selectWorkspace(result.cwd, "latest");
    } else {
      await refreshSessions();
      await loadSettings();
    }
    toast("已从列表移除工作区（未删除磁盘文件）", "info");
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), "error");
  }
}

/** 在系统文件管理器中打开工作区所在文件夹 */
export async function revealFolder(dir: string): Promise<void> {
  try {
    // 兜底：若主进程未注册该方法（如运行的是旧实例），rpc 会永久挂起，超时后给出可见提示
    await Promise.race([
      rpc("revealFolder", { path: dir }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("打开文件夹请求超时，请重启应用后重试")), 3000),
      ),
    ]);
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), "error");
  }
}

/** 侧栏收起/展开动画窗口：切换期间挂过渡类，结束后移除 */
export function toggleSidebar(next?: boolean): void {
  shellStore.set((prev) => {
    const collapsed = next ?? !prev.sidebarCollapsed;
    try {
      localStorage.setItem("aluka.sidebarCollapsed", collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
    return { sidebarCollapsed: collapsed };
  });
  window.clearTimeout(sidebarAnimTimer.current);
  shellStore.set({ sidebarAnimating: true });
  sidebarAnimTimer.current = window.setTimeout(() => shellStore.set({ sidebarAnimating: false }), 320);
}

export async function createTempWorkspace(): Promise<void> {
  const opened = await rpc<OpenedSession>("createTempWorkspace", {
    mode: "new",
  });
  await applyOpened(opened);
  toast("已使用临时工作区", "info");
}

export async function addWorkspaceByPath(dir: string, mode: "latest" | "new" = "latest"): Promise<void> {
  const opened = await rpc<OpenedSession>("addWorkspace", {
    path: dir,
    mode,
  });
  await applyOpened(opened);
}

/** 打开「输入路径」弹窗（对话空态 / 设置页共用） */
export function openPathDialog(mode: "latest" | "new"): void {
  shellStore.set({ wsPickMode: mode });
  shellStore.set({ wsPathDraft: shellStore.get().settings.cwd ?? "" });
  shellStore.set({ wsPathOpen: true });
}

/** 发起系统文件夹选择（失败/取消时回退路径输入弹窗） */
export function chooseWorkspace(mode: "latest" | "new"): void {
  if (pickingFolderRef.current) return;
  pickingFolderRef.current = true;
  shellStore.set({ wsPickMode: mode });
  void rpc<{ pending?: boolean }>("chooseWorkspace", { mode }).catch((err) => {
    pickingFolderRef.current = false;
    toast(err instanceof Error ? err.message : String(err), "error");
    shellStore.set({ wsPathDraft: shellStore.get().settings.cwd ?? "" });
    shellStore.set({ wsPathOpen: true });
  });
}

/** 拉取扩展声明的 UI 贡献（挂载 + 扩展重载后刷新），告警以 Toast 播报 */
export async function loadUiContributions(): Promise<void> {
  try {
    const result = await rpc<{ contributions?: UiContribution[]; warnings?: string[] }>(
      "listUiContributions",
    );
    shellStore.set({ uiContributions: result?.contributions ?? [] });
    for (const warning of result?.warnings ?? []) toast(warning, "warning");
  } catch (err) {
    // 非致命：贡献面板缺席不影响主流程
    console.warn("[app] listUiContributions failed", err);
  }
}

export async function respondUi(response: ExtensionUiResponse): Promise<void> {
  await rpc("respondExtensionUi", response);
  shellStore.set({ modal: undefined });
}

/** 发送 prompt（可附图片）；无会话时先创建 */
export async function onSend(e?: { preventDefault: () => void }): Promise<void> {
  e?.preventDefault();
  const { prompt, attachments, sessionRef, busy } = sessionStore.get();
  const text = prompt.trim();
  const pending = attachments;
  // 纯图片（无文字）也允许发送
  if ((!text && pending.length === 0) || busy) return;
  try {
    if (!sessionRef.id) {
      await createNewChat();
    }
    sessionStore.set({ prompt: "", attachments: [] });
    sessionStore.set({ busy: true });
    await rpc("sendPrompt", {
      text,
      images: pending.map((a) => ({ data: a.base64, mimeType: a.mimeType })),
    });
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), "error");
    sessionStore.set({ busy: false });
    // 发送失败时还原输入内容，避免用户丢失草稿
    sessionStore.set((prev) => ({
      prompt: prev.prompt ? (text ? `${text}\n${prev.prompt}` : prev.prompt) : text,
    }));
    sessionStore.set({ attachments: pending });
  }
}

/** 启用/禁用贡献（localStorage 持久化；SlotOutlet 与菜单同步过滤） */
export function toggleContribution(id: string): void {
  const current = shellStore.get().disabledContributions;
  const next = current.includes(id)
    ? current.filter((item) => item !== id)
    : [...current, id];
  shellStore.set({ disabledContributions: next });
  try {
    localStorage.setItem("aluka.disabledContributions", JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

// ── 视图 props 兼容动作（ChatView 直接调用） ──

export function setPromptView(text: string): void {
  sessionStore.set({ prompt: text });
}

export function setAttachmentsView(
  next: ImageAttachment[] | ((prev: ImageAttachment[]) => ImageAttachment[]),
): void {
  sessionStore.set((prev) => ({
    attachments: typeof next === "function" ? next(prev.attachments) : next,
  }));
}

export function setSettingsView(
  next: SettingsView | ((prev: SettingsView) => SettingsView),
): void {
  shellStore.set((prev) => ({
    settings: typeof next === "function" ? next(prev.settings) : next,
  }));
}

// ── 类型再导出（供视图/事件模块引用） ──
export type { ChooseWorkspaceResult };
