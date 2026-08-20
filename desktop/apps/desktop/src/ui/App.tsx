import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Minus,
  Square,
  X,
  Settings as SettingsIcon,
  Boxes,
  Share2,
  Download,
  PanelLeft,
  SquarePen,
} from "lucide-react";
import { bridge, rpc } from "./bridge.ts";
import { WorkspaceSidebar, type WorkspaceItem } from "./WorkspaceSidebar.tsx";
import { ChatView } from "./views/ChatView.tsx";
import { SettingsView } from "./views/SettingsView.tsx";
import { ExtensionsView } from "./views/ExtensionsView.tsx";
import { Button, Input } from "./components/index.ts";
import {
  ExtensionUiModal,
  type ExtensionUiResponse,
} from "./components/ExtensionUiModal.tsx";
import type {
  ChooseWorkspaceResult,
  ExtensionUiRequest,
  ModelOption,
  OpenedSession,
  SessionSummary,
  SessionUsageView,
  SettingsView as SettingsState,
  ShellView,
  TimelineItem,
  Toast,
} from "./types.ts";
import {
  pathsEqual,
  preferTimeline,
  readTimelinePayload,
  sessionKey,
  waitHostRuntime,
} from "./lib/utils.ts";
import "./components/ui.css";
import "./styles.css";

/**
 * Aluka Desktop 主应用组件（壳）
 *
 * 职责：应用骨架（侧栏 + 顶栏 + 视图切换）、会话与工作区状态、
 * runtime 事件路由（多会话并行按 sessionId 分流）、全局 Toast / 弹窗。
 * 各页面 UI 由 views/ 下的视图组件自持状态渲染。
 */
export function App() {
  // ── 状态管理 ──
  const [status, setStatus] = useState("连接中…"); // 底部状态栏文本
  const [idleStatus, setIdleStatus] = useState("就绪"); // 空闲时的状态文本
  const [view, setView] = useState<ShellView>("chat"); // 当前视图：对话/设置/扩展
  const [sessions, setSessions] = useState<SessionSummary[]>([]); // 当前工作区会话（标题回退）
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [wsPathOpen, setWsPathOpen] = useState(false); // 「输入路径」弹窗开关
  const [wsPathDraft, setWsPathDraft] = useState(""); // 弹窗路径草稿
  const [wsPickMode, setWsPickMode] = useState<"latest" | "new">("latest");
  const [activeId, setActiveId] = useState<string | undefined>(); // 当前活跃会话 ID
  const [timeline, setTimeline] = useState<TimelineItem[]>([]); // 当前会话时间线
  const [busy, setBusy] = useState(false); // 是否正在处理请求
  const [prompt, setPrompt] = useState(""); // 输入框内容
  const [streaming, setStreaming] = useState(""); // 正在流式输出的文本
  const [settings, setSettings] = useState<SettingsState>({}); // 用户设置
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]); // 可用模型列表
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set()); // 正在运行的会话（含后台）
  const [usage, setUsage] = useState<SessionUsageView | undefined>(); // 会话用量统计
  const [updateHint, setUpdateHint] = useState(
    "可选：设置环境变量 ALUKA_DESKTOP_RELEASES_URL 指向 GitHub releases/latest JSON。",
  );
  const [about, setAbout] = useState(""); // 关于信息
  const [toasts, setToasts] = useState<Toast[]>([]); // Toast 通知列表
  const [modal, setModal] = useState<ExtensionUiRequest | undefined>(); // 扩展 UI 弹窗请求
  const [selectChoice, setSelectChoice] = useState<string | undefined>(); // 弹窗选择结果
  const [modalInput, setModalInput] = useState(""); // 弹窗输入内容
  const toastSeq = useRef(0); // Toast 序列号
  const timelineCache = useRef<Record<string, TimelineItem[]>>({});
  const sessionRef = useRef<{ cwd?: string; id?: string }>({});
  const streamingRef = useRef("");
  /** 活跃会话 ID 的 ref 镜像：事件回调按它路由，后台会话事件不污染当前时间线 */
  const activeIdRef = useRef<string | undefined>(undefined);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("aluka.sidebarCollapsed") === "1";
    } catch {
      return false;
    }
  });

  // 当前主题（默认深色）
  const theme = settings.theme === "light" ? "light" : "dark";

  /** 显示 Toast 通知，4.5 秒后自动消失 */
  const toast = useCallback(
    (message: string, level: Toast["level"] = "info") => {
      const id = ++toastSeq.current;
      setToasts((prev) => [...prev, { id, message, level }]);
      setTimeout(
        () => setToasts((prev) => prev.filter((t) => t.id !== id)),
        4500,
      );
    },
    [],
  );

  /** 刷新会话列表与工作区树 */
  const refreshSessions = useCallback(async () => {
    const [list, tree] = await Promise.all([
      rpc<SessionSummary[]>("listSessions"),
      rpc<WorkspaceItem[]>("listWorkspaces"),
    ]);
    setSessions(list ?? []);
    setWorkspaces(tree ?? []);
  }, []);

  /** 刷新当前会话的 token 用量统计 */
  const refreshUsage = useCallback(async (id?: string) => {
    const view = await rpc<SessionUsageView>("getSessionUsage", { id });
    if (view) setUsage(view);
  }, []);

  /**
   * 加载全局设置与模型选项（页面局部数据由各视图自行加载）。
   * 同时更新主题属性。
   */
  const loadSettings = useCallback(async () => {
    const s = await rpc<SettingsState>("getSettings");
    setSettings(s ?? {});
    document.documentElement.setAttribute(
      "data-theme",
      s?.theme === "light" ? "light" : "dark",
    );
    const options = (await rpc<ModelOption[]>("listModelOptions")) ?? [];
    setModelOptions(options);
  }, []);

  /** 把时间线写回本地缓存（按 cwd + id 键） */
  const rememberTimeline = useCallback(
    (
      cwd: string | undefined,
      id: string | undefined,
      items: TimelineItem[],
    ) => {
      const key = sessionKey(cwd, id);
      if (key) timelineCache.current[key] = items;
    },
    [],
  );

  /** 拉取 host 时间线，失败时回退本地缓存 */
  const fetchHostTimeline = useCallback(async (cwd?: string, id?: string) => {
    try {
      const raw = await rpc<unknown>("getTimeline");
      return preferTimeline(
        readTimelinePayload(raw),
        timelineCache.current[sessionKey(cwd, id)] ?? [],
      );
    } catch {
      return timelineCache.current[sessionKey(cwd, id)] ?? [];
    }
  }, []);

  /**
   * 打开指定会话：加载时间线、切换到对话视图、刷新列表和用量
   */
  const applyOpened = useCallback(
    async (opened: OpenedSession) => {
      const leftover = streamingRef.current.trim();
      if (leftover) {
        const prevKey = sessionKey(
          sessionRef.current.cwd,
          sessionRef.current.id,
        );
        if (prevKey) {
          const prev = timelineCache.current[prevKey] ?? [];
          const last = prev[prev.length - 1];
          if (!(last?.role === "assistant" && last.text === leftover)) {
            timelineCache.current[prevKey] = [
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
      setActiveId(opened.id || undefined);
      const s = await rpc<SettingsState>("getSettings");
      setSettings({ ...s, cwd: opened.cwd });
      sessionRef.current = { cwd: opened.cwd, id: opened.id || undefined };
      const next = preferTimeline(
        await fetchHostTimeline(opened.cwd, opened.id),
        preferTimeline(
          opened.timeline ?? [],
          timelineCache.current[sessionKey(opened.cwd, opened.id)] ?? [],
        ),
      );
      rememberTimeline(opened.cwd, opened.id, next);
      setTimeline(next);
      streamingRef.current = "";
      setStreaming("");
      setView("chat");
      // 同步目标会话的忙碌状态（切回后台仍在运行会话时保持 composer 禁用）
      try {
        const busyState = await rpc<{ busy?: boolean }>("isBusy");
        setBusy(Boolean(busyState?.busy));
      } catch {
        setBusy(false);
      }
      await refreshSessions();
      await refreshUsage(opened.id);
    },
    [fetchHostTimeline, rememberTimeline, refreshSessions, refreshUsage],
  );

  const showChat = useCallback(async () => {
    setView("chat");
    const { cwd, id } = sessionRef.current;
    const items = await fetchHostTimeline(cwd, id);
    if (items.length) {
      rememberTimeline(cwd, id, items);
      setTimeline(items);
    }
  }, [fetchHostTimeline, rememberTimeline]);

  const openSession = useCallback(
    async (id: string, cwd?: string) => {
      const opened = await rpc<OpenedSession>("openSession", { id, cwd });
      await applyOpened(opened);
    },
    [applyOpened],
  );

  const createNewChat = useCallback(async () => {
    const created = await rpc<OpenedSession>("createSession", {
      cwd: settings.cwd,
    });
    await applyOpened({ ...created, timeline: [] });
  }, [applyOpened, settings.cwd]);

  const selectWorkspace = useCallback(
    async (dir: string, mode: "latest" | "new" = "latest") => {
      const opened = await rpc<OpenedSession>("selectWorkspace", {
        path: dir,
        mode,
      });
      await applyOpened(opened);
    },
    [applyOpened],
  );

  const deleteSession = useCallback(
    async (id: string, cwd: string) => {
      try {
        const opened = await rpc<OpenedSession>("deleteSession", { id, cwd });
        if (id === activeId && pathsEqual(cwd, settings.cwd ?? "")) {
          await applyOpened(opened);
        } else {
          await refreshSessions();
        }
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "error");
      }
    },
    [activeId, applyOpened, refreshSessions, settings.cwd, toast],
  );

  const toggleSidebar = useCallback((next?: boolean) => {
    setSidebarCollapsed((prev) => {
      const collapsed = next ?? !prev;
      try {
        localStorage.setItem("aluka.sidebarCollapsed", collapsed ? "1" : "0");
      } catch {
        /* ignore */
      }
      return collapsed;
    });
  }, []);

  const createTempWorkspace = useCallback(async () => {
    const opened = await rpc<OpenedSession>("createTempWorkspace", {
      mode: "new",
    });
    await applyOpened(opened);
    toast("已使用临时工作区", "info");
  }, [applyOpened, toast]);

  const addWorkspaceByPath = useCallback(
    async (dir: string, mode: "latest" | "new" = "latest") => {
      const opened = await rpc<OpenedSession>("addWorkspace", {
        path: dir,
        mode,
      });
      await applyOpened(opened);
    },
    [applyOpened],
  );

  const applyOpenedRef = useRef(applyOpened);
  applyOpenedRef.current = applyOpened;
  const pickingFolderRef = useRef(false);

  const chooseWorkspace = useCallback(
    (mode: "latest" | "new") => {
      if (pickingFolderRef.current) return;
      pickingFolderRef.current = true;
      setWsPickMode(mode);
      void rpc<{ pending?: boolean }>("chooseWorkspace", { mode }).catch(
        (err) => {
          pickingFolderRef.current = false;
          toast(err instanceof Error ? err.message : String(err), "error");
          setWsPathDraft(settings.cwd ?? "");
          setWsPathOpen(true);
        },
      );
    },
    [settings.cwd, toast],
  );

  /** 打开「输入路径」弹窗（对话空态 / 设置页共用） */
  const openPathDialog = useCallback(
    (mode: "latest" | "new") => {
      setWsPickMode(mode);
      setWsPathDraft(settings.cwd ?? "");
      setWsPathOpen(true);
    },
    [settings.cwd],
  );

  /**
   * 初始化 Effect：等待 Host 就绪，加载所有数据，发送 ui-ready 事件
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const info = await waitHostRuntime();
        if (cancelled) return;
        const idle = `v${info.productVersion} · 阶段 ${info.phase} · ${info.platform}`;
        setIdleStatus(idle);
        setStatus(idle);
        setAbout(`Aluka Desktop ${info.productVersion} · 阶段 ${info.phase}`);
        const active = await rpc<{ id?: string; cwd?: string }>(
          "getActiveSessionId",
        );
        setActiveId(active?.id || undefined);
        if (active?.cwd) setSettings((s) => ({ ...s, cwd: active.cwd }));
        sessionRef.current = { cwd: active?.cwd, id: active?.id || undefined };
        if (active?.id) {
          const items = await fetchHostTimeline(active.cwd, active.id);
          rememberTimeline(active.cwd, active.id, items);
          setTimeline(items);
        }
        await refreshSessions();
        await loadSettings();
        await refreshUsage(active?.id);
        bridge().events.emit("ui-ready", {
          at: Date.now(),
          phase: 5,
          ui: "zeno-react",
        });
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err));
        toast(String(err), "error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    fetchHostTimeline,
    loadSettings,
    rememberTimeline,
    refreshSessions,
    refreshUsage,
    toast,
  ]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  /**
   * 运行时事件监听 Effect
   * 处理 agent_start/end、text_delta、message_end、tool_start/end、
   * extension_ui、usage、error 等事件。
   * 多会话并行：事件按 sessionId 路由，非活跃会话只更新运行标记与列表。
   */
  useEffect(() => {
    const commitTimeline = (
      updater: (prev: TimelineItem[]) => TimelineItem[],
    ) => {
      setTimeline((prev) => {
        const next = updater(prev);
        rememberTimeline(sessionRef.current.cwd, sessionRef.current.id, next);
        return next;
      });
    };

    const markBusy = (id: string, on: boolean) => {
      setBusyIds((prev) => {
        const next = new Set(prev);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      });
    };

    const onRuntime = (raw: unknown) => {
      const event = raw as {
        type: string;
        sessionId?: string;
        text?: string;
        role?: string;
        toolName?: string;
        toolCallId?: string;
        args?: unknown;
        resultText?: string;
        isError?: boolean;
        message?: string;
        request?: ExtensionUiRequest;
        usage?: SessionUsageView;
      };
      if (!event || typeof event !== "object") return;
      const sid = event.sessionId;
      const isActiveEvent = !sid || sid === activeIdRef.current;
      if (event.type === "agent_start") {
        if (sid) markBusy(sid, true);
        if (!isActiveEvent) return;
        setBusy(true);
        setStreaming("");
        return;
      }
      if (event.type === "agent_end") {
        if (sid) markBusy(sid, false);
        if (!isActiveEvent) {
          // 后台会话完成：刷新列表标题/时间
          void refreshSessions();
          return;
        }
        setBusy(false);
        const leftover = streamingRef.current.trim();
        streamingRef.current = "";
        setStreaming("");
        if (leftover) {
          commitTimeline((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant" && last.text === leftover)
              return prev;
            return [
              ...prev,
              {
                id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                role: "assistant",
                text: leftover,
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
        setStreaming(streamingRef.current);
        return;
      }
      if (
        event.type === "message_end" &&
        event.role === "user" &&
        event.text != null
      ) {
        commitTimeline((prev) => [
          ...prev,
          {
            id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            role: "user",
            text: event.text!,
            timestamp: Date.now(),
          },
        ]);
        return;
      }
      if (
        event.type === "message_end" &&
        event.role === "assistant" &&
        event.text != null
      ) {
        streamingRef.current = "";
        setStreaming("");
        if (!event.text.trim()) return;
        commitTimeline((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last.text === event.text)
            return prev;
          return [
            ...prev,
            {
              id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              role: "assistant",
              text: event.text!,
              timestamp: Date.now(),
            },
          ];
        });
        return;
      }
      if (event.type === "tool_start") {
        const toolCallId = event.toolCallId;
        commitTimeline((prev) => [
          ...prev,
          {
            id:
              toolCallId ||
              `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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
          const index = toolCallId
            ? prev.findIndex((item) => item.toolCallId === toolCallId)
            : -1;
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
              id:
                toolCallId ||
                `tr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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
        setModal(event.request);
        setSelectChoice(undefined);
        setModalInput("");
        return;
      }
      if (event.type === "usage" && event.usage) {
        setUsage(event.usage);
        return;
      }
      if (event.type === "error" && event.message) {
        commitTimeline((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            role: "system",
            text: event.message!,
            timestamp: Date.now(),
          },
        ]);
        setBusy(false);
      }
    };

    const onPromptResult = (raw: unknown) => {
      const result = raw as {
        ok?: boolean;
        error?: string;
        sessionId?: string;
      };
      const sid = result?.sessionId;
      if (sid) {
        setBusyIds((prev) => {
          const next = new Set(prev);
          next.delete(sid);
          return next;
        });
      }
      if (sid && sid !== activeIdRef.current) {
        // 后台会话的请求结束：只刷新列表
        void refreshSessions();
        return;
      }
      if (result?.ok === false && result.error) toast(result.error, "error");
      setBusy(false);
      void refreshSessions();
    };

    const onShare = (raw: unknown) => {
      const result = raw as {
        ok?: boolean;
        error?: string;
        gistUrl?: string;
        gistId?: string;
      };
      if (result?.ok && result.gistUrl) {
        toast(`已分享 Gist ${result.gistId ?? ""}`, "info");
        setStatus(`已分享 → ${result.gistUrl}`);
        setTimeout(() => setStatus(idleStatus), 4000);
        return;
      }
      toast(result?.error ?? "分享失败", "error");
      setStatus(idleStatus);
    };

    const onWorkspaceChoose = (raw: unknown) => {
      pickingFolderRef.current = false;
      const result = raw as ChooseWorkspaceResult & { error?: string };
      if (!result || typeof result !== "object") return;
      if (result.cancelled) {
        if (result.error) {
          toast(result.error, "error");
          setWsPathDraft(sessionRef.current.cwd ?? "");
          setWsPathOpen(true);
        }
        return;
      }
      void applyOpenedRef.current(result);
    };
    const onPackageInstall = (raw: unknown) => {
      const result = raw as {
        ok?: boolean;
        error?: string;
        packageName?: string;
      };
      if (result?.ok) toast(`扩展包 ${result.packageName} 已安装`, "info");
      else toast(result?.error ?? "安装失败", "error");
    };

    const onUpdateCheck = (raw: unknown) => {
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
        setUpdateHint(result.reason ?? "已跳过更新检查");
        return;
      }
      if (result?.error) {
        setUpdateHint(`更新检查失败：${result.error}`);
        return;
      }
      if (result?.upToDate) {
        setUpdateHint(
          `已是最新（当前 ${result.current}，最新 ${result.latest}）`,
        );
        return;
      }
      setUpdateHint(
        `发现新版本：${result?.latest}（当前 ${result?.current}）${result?.url ? ` · ${result.url}` : ""}`,
      );
    };

    const bus = bridge().events;
    bus.on("runtime.event", onRuntime);
    bus.on("prompt.result", onPromptResult);
    bus.on("session.share", onShare);
    bus.on("workspace.choose", onWorkspaceChoose);
    bus.on("package.install", onPackageInstall);
    bus.on("update.check", onUpdateCheck);

    return () => {
      bus.off("runtime.event", onRuntime);
      bus.off("prompt.result", onPromptResult);
      bus.off("session.share", onShare);
      bus.off("workspace.choose", onWorkspaceChoose);
      bus.off("package.install", onPackageInstall);
      bus.off("update.check", onUpdateCheck);
    };
  }, [idleStatus, rememberTimeline, refreshSessions, toast]);

  const activeTitle = useMemo(() => {
    for (const ws of workspaces) {
      if (settings.cwd && !pathsEqual(ws.path, settings.cwd)) continue;
      const s = ws.sessions.find((x) => x.id === activeId);
      if (s) return s.title || s.id;
    }
    const s = sessions.find((x) => x.id === activeId);
    return s?.title || s?.id || "新对话";
  }, [workspaces, sessions, activeId, settings.cwd]);

  const activeWorkspace = useMemo(
    () => workspaces.find((ws) => pathsEqual(ws.path, settings.cwd)),
    [workspaces, settings.cwd],
  );

  async function respondUi(response: ExtensionUiResponse) {
    await rpc("respondExtensionUi", response);
    setModal(undefined);
  }

  async function onSend(e?: React.FormEvent) {
    e?.preventDefault();
    const text = prompt.trim();
    if (!text || busy) return;
    try {
      if (!sessionRef.current.id) {
        await createNewChat();
      }
      setPrompt("");
      setBusy(true);
      await rpc("sendPrompt", { text });
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
      setBusy(false);
    }
  }

  return (
    <div
      className={`app-shell ${view !== "chat" ? "settings-open" : ""} ${view === "settings" ? "settings-mode" : ""} ${sidebarCollapsed && view !== "settings" ? "sidebar-collapsed" : ""}`}
      data-theme={theme}
    >
      <aside
        className={`sidebar ${sidebarCollapsed ? "is-collapsed" : ""}`}
        data-aluka-drag="no-drag"
      >
        {sidebarCollapsed ? (
          <div className="sidebar-rail" data-aluka-drag>
            <button
              type="button"
              className="icon-btn"
              data-aluka-drag="no-drag"
              title="展开侧栏"
              onClick={() => toggleSidebar(false)}
            >
              <PanelLeft size={16} />
            </button>

            <button
              type="button"
              className="icon-btn"
              data-aluka-drag="no-drag"
              title="新建会话"
              onClick={() => void createNewChat()}
            >
              <SquarePen size={16} />
            </button>
          </div>
        ) : (
          <WorkspaceSidebar
            workspaces={workspaces}
            activeCwd={settings.cwd}
            activeSessionId={activeId}
            busySessionIds={busyIds}
            onNewChat={() => void createNewChat()}
            onOpenSession={(id, cwd) => void openSession(id, cwd)}
            onSelectWorkspace={(cwd) => void selectWorkspace(cwd, "latest")}
            onAddWorkspace={() => void chooseWorkspace("latest")}
            onCreateTemp={() => void createTempWorkspace()}
            onDeleteSession={(id, cwd) => void deleteSession(id, cwd)}
            onCollapseSidebar={() => toggleSidebar(true)}
          />
        )}

        <div className="sidebar-foot">
          <button
            type="button"
            className={`nav ghost-btn ${view === "extensions" ? "active" : ""}`}
            onClick={() => setView("extensions")}
          >
            <Boxes size={16} /> <span>扩展</span>
          </button>
          <button
            type="button"
            className={`nav ghost-btn ${view === "settings" ? "active" : ""}`}
            onClick={() => {
              setView("settings");
              void loadSettings();
              void refreshUsage(activeId);
            }}
          >
            <SettingsIcon size={16} /> <span>设置</span>
          </button>
          <div className="status-pill" title={status}>
            {status}
          </div>
        </div>
      </aside>

      <section className="main-col">
        <header className="thread-header" data-aluka-drag>
          {sidebarCollapsed && view === "chat" ? (
            <button
              type="button"
              className="icon-btn"
              data-aluka-drag="no-drag"
              title="展开侧栏"
              onClick={() => toggleSidebar(false)}
            >
              <PanelLeft size={16} />
            </button>
          ) : null}
          <div
            className="title"
            title={view === "chat" ? activeTitle : undefined}
          >
            {view === "chat"
              ? activeTitle
              : view === "settings"
                ? "设置"
                : "扩展与技能"}
          </div>
          {view === "chat" ? (
            <div className="thread-actions" data-aluka-drag="no-drag">
              <button
                type="button"
                className="header-action"
                title="导出会话"
                onClick={() =>
                  void (async () => {
                    const result = await rpc<{
                      ok?: boolean;
                      error?: string;
                      path?: string;
                      format?: string;
                      bytes?: number;
                    }>("exportSession", { format: "markdown", id: activeId });
                    if (result?.ok && result.path) {
                      toast(
                        `已导出 ${result.format}（${result.bytes ?? 0} 字节）`,
                        "info",
                      );
                      setStatus(`已导出 → ${result.path}`);
                      setTimeout(() => setStatus(idleStatus), 2500);
                    } else toast(result?.error ?? "导出失败", "error");
                  })()
                }
              >
                <Download size={15} />
              </button>
              <button
                type="button"
                className="header-action"
                title="分享会话"
                onClick={() => {
                  setStatus("正在通过 gh gist 分享…");
                  void rpc("shareSession", { id: activeId }).catch((err) => {
                    toast(
                      err instanceof Error ? err.message : String(err),
                      "error",
                    );
                    setStatus(idleStatus);
                  });
                }}
              >
                <Share2 size={15} />
              </button>
            </div>
          ) : null}
          <div className="window-controls" data-aluka-drag="no-drag">
            <button
              type="button"
              title="最小化"
              onClick={() => bridge().window.minimize()}
            >
              <Minus size={14} />
            </button>
            <button
              type="button"
              title="最大化"
              onClick={() => bridge().window.toggleMaximize()}
            >
              <Square size={11} />
            </button>
            <button
              type="button"
              className="close"
              title="退出"
              onClick={() =>
                void rpc("quitApp").catch(() => {
                  try {
                    bridge().window.close();
                  } catch {
                    /* ignore */
                  }
                })
              }
            >
              <X size={14} />
            </button>
          </div>
        </header>

        <ChatView
          hidden={view !== "chat"}
          timeline={timeline}
          streaming={streaming}
          busy={busy}
          prompt={prompt}
          setPrompt={setPrompt}
          onSend={onSend}
          settings={settings}
          setSettings={setSettings}
          modelOptions={modelOptions}
          usage={usage}
          workspaces={workspaces}
          activeWorkspace={activeWorkspace}
          chooseWorkspace={chooseWorkspace}
          createTempWorkspace={createTempWorkspace}
          selectWorkspace={selectWorkspace}
          onOpenPathDialog={openPathDialog}
          onToast={toast}
        />

        {view === "settings" && (
          <SettingsView
            settings={settings}
            setSettings={setSettings}
            theme={theme}
            workspaces={workspaces}
            usage={usage}
            about={about}
            updateHint={updateHint}
            onCheckUpdates={() => {
              setUpdateHint("正在检查…");
              void rpc("checkForUpdates");
            }}
            refreshUsage={refreshUsage}
            activeId={activeId}
            chooseWorkspace={chooseWorkspace}
            createTempWorkspace={createTempWorkspace}
            selectWorkspace={selectWorkspace}
            onBack={() => void showChat()}
            loadSettings={loadSettings}
            refreshSessions={refreshSessions}
            onToast={toast}
          />
        )}

        {view === "extensions" && (
          <ExtensionsView
            onToast={toast}
            onSettingsChanged={loadSettings}
            onBack={() => void showChat()}
          />
        )}
      </section>

      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.level}`}>
            {t.message}
          </div>
        ))}
      </div>

      <div
        className={`modal ${modal || wsPathOpen ? "" : "hidden"}`}
        data-aluka-drag="no-drag"
      >
        {wsPathOpen ? (
          <div className="modal-card">
            <h3>打开工作区</h3>
            <p className="modal-body">
              输入文件夹路径。未选择时，新对话会使用自动生成的临时目录。
            </p>
            <Input
              className="modal-input"
              label="文件夹路径"
              placeholder="E:\code\my-project"
              value={wsPathDraft}
              onChange={setWsPathDraft}
            />
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setWsPathOpen(false)}>
                取消
              </Button>
              <Button
                onClick={() => {
                  const dir = wsPathDraft.trim();
                  if (!dir) return;
                  setWsPathOpen(false);
                  void addWorkspaceByPath(dir, wsPickMode);
                }}
              >
                打开
              </Button>
            </div>
          </div>
        ) : modal && modal.kind !== "notify" ? (
          <ExtensionUiModal
            request={modal}
            selectChoice={selectChoice}
            setSelectChoice={setSelectChoice}
            inputDraft={modalInput}
            setInputDraft={setModalInput}
            onRespond={(response) => void respondUi(response)}
          />
        ) : null}
      </div>
    </div>
  );
}
