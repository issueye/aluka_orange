import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  RefreshCw,
  CheckCircle2,
} from "lucide-react";
import { bridge, rpc } from "./bridge.ts";
import { Logo } from "./Logo.tsx";
import { WorkspaceSidebar, type WorkspaceItem } from "./WorkspaceSidebar.tsx";
import { WindowResizeHandle } from "./WindowResizeHandle.tsx";
import { ChatView } from "./views/ChatView.tsx";
import { SettingsView } from "./views/SettingsView.tsx";
import { ExtensionsView } from "./views/ExtensionsView.tsx";
import { Button, ConfirmDialog, Dialog, Input, Spinner } from "./components/index.ts";
import {
  ExtensionUiModal,
  type ExtensionUiResponse,
} from "./components/ExtensionUiModal.tsx";
import type {
  ChooseWorkspaceResult,
  ExtensionUiRequest,
  ImageAttachment,
  ModelOption,
  OpenedSession,
  SessionSummary,
  SessionUsageView,
  SettingsView as SettingsState,
  ShellView,
  TimelineImage,
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

/** 启动闪屏最短展示时长（数据就绪后再补足该时长，避免闪屏一闪而过） */
const MIN_SPLASH_MS = 1600;

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
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]); // 待发送图片附件
  const [sessionLoading, setSessionLoading] = useState(false); // 会话打开中（时间线加载占位）
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; cwd: string; title: string } | undefined>(); // 删除会话确认
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
  const [extReloading, setExtReloading] = useState(false); // 扩展热重载进行中（header 按钮）
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
  /** 启动闪屏：splash 控制是否还挂在界面上，booted 触发淡出过渡并进入主界面 */
  const [splash, setSplash] = useState(true);
  const [booted, setBooted] = useState(false);
  /** 闪屏上的分阶段状态文案（连接运行时 → 加载数据） */
  const [splashStatus, setSplashStatus] = useState("正在启动本地运行时…");

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
      setSessionLoading(true);
      try {
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
        setAttachments([]);
        setActiveId(opened.id || undefined);
        sessionRef.current = { cwd: opened.cwd, id: opened.id || undefined };
        // openSession 已带回时间线，不再重复拉 getTimeline；回退本地缓存
        const next = preferTimeline(
          opened.timeline ?? [],
          timelineCache.current[sessionKey(opened.cwd, opened.id)] ?? [],
        );
        rememberTimeline(opened.cwd, opened.id, next);
        streamingRef.current = "";
        setStreaming("");
        setView("chat");
        setSettings((prev) => ({ ...prev, cwd: opened.cwd }));
        // 长会话时间线渲染量大：放进 transition，让侧栏高亮等紧急更新先上屏
        startTransition(() => {
          setTimeline(next);
        });
        // 剩余数据并行拉取（此前逐个 await 串行等待）
        const [busyState] = await Promise.all([
          rpc<{ busy?: boolean }>("isBusy").catch(() => ({ busy: false })),
          refreshSessions(),
          refreshUsage(opened.id),
        ]);
        setBusy(Boolean(busyState?.busy));
      } finally {
        setSessionLoading(false);
      }
    },
    [rememberTimeline, refreshSessions, refreshUsage],
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

  /** 在指定工作区新建会话并切换到该会话（侧栏工作区项“+”按钮） */
  const createNewChatIn = useCallback(
    async (cwd: string) => {
      const created = await rpc<OpenedSession>("createSession", { cwd });
      await applyOpened({ ...created, timeline: [] });
    },
    [applyOpened],
  );

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

  /** 删除会话（破坏性操作，先弹确认框） */
  const deleteSession = useCallback(
    async (id: string, cwd: string) => {
      const title = (() => {
        for (const ws of workspaces) {
          if (!pathsEqual(ws.path, cwd)) continue;
          const s = ws.sessions.find((x) => x.id === id);
          if (s) return s.title || s.id;
        }
        const s = sessions.find((x) => x.id === id);
        return (s && (s.title || s.id)) || id;
      })();
      setDeleteConfirm({ id, cwd, title });
    },
    [sessions, workspaces],
  );

  /** 确认删除后真正执行 */
  const confirmDeleteSession = useCallback(async () => {
    const target = deleteConfirm;
    if (!target) return;
    setDeleteConfirm(undefined);
    try {
      const opened = await rpc<OpenedSession>("deleteSession", { id: target.id, cwd: target.cwd });
      if (target.id === activeId && pathsEqual(target.cwd, settings.cwd ?? "")) {
        await applyOpened(opened);
      } else {
        await refreshSessions();
      }
      toast("会话已删除", "info");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    }
  }, [activeId, applyOpened, deleteConfirm, refreshSessions, settings.cwd, toast]);

  /** 手动热重载扩展（全局 header 按钮）：重扫扩展目录 + 重建工具，并刷新相关状态 */
  const reloadExtensions = useCallback(async () => {
    setExtReloading(true);
    try {
      const inv = await rpc<{ extensions?: unknown[]; errors?: unknown[] }>("reloadExtensions");
      const extCount = inv?.extensions?.length ?? 0;
      const errCount = inv?.errors?.length ?? 0;
      await loadSettings();
      // 通知已挂载的扩展 / 技能页面刷新列表
      window.dispatchEvent(new CustomEvent("aluka:extensions-reloaded"));
      setStatus(`已重载扩展：${extCount} 个生效${errCount ? `，${errCount} 个错误` : ""}`);
      setTimeout(() => setStatus(idleStatus), 2500);
      toast(
        errCount
          ? `扩展已重载：${extCount} 个生效，${errCount} 个加载错误`
          : `已重载扩展（${extCount} 个生效）`,
        errCount ? "warning" : "info",
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setExtReloading(false);
    }
  }, [idleStatus, loadSettings, toast]);

  /** 从工作区列表移除目录（不删除磁盘文件）；移除当前工作区时切到回退工作区 */
  const removeWorkspace = useCallback(
    async (dir: string) => {
      try {
        const removingActive = pathsEqual(dir, settings.cwd ?? "");
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
  },
  [loadSettings, refreshSessions, selectWorkspace, settings.cwd, toast],
);

  /** 在系统文件管理器中打开工作区所在文件夹 */
  const revealFolder = useCallback(
    async (dir: string) => {
      try {
        // 兜底：若主进程未注册该方法（如运行的是旧实例），rpc 会永久挂起，超时后给出可见提示
        console.log('reveal folder', dir);
        await Promise.race([
          rpc("revealFolder", { path: dir }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("打开文件夹请求超时，请重启应用后重试")), 3000),
          ),
        ]);
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "error");
      }
    },
    [toast],
  );


  /** 侧栏收起/展开动画窗口：切换期间挂过渡类，结束后移除（避免常驻 transition 拖慢视图切换等场景） */
  const [sidebarAnimating, setSidebarAnimating] = useState(false);
  const sidebarAnimTimer = useRef<number | undefined>(undefined);

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
    window.clearTimeout(sidebarAnimTimer.current);
    setSidebarAnimating(true);
    sidebarAnimTimer.current = window.setTimeout(() => setSidebarAnimating(false), 320);
  }, []);

  useEffect(() => () => window.clearTimeout(sidebarAnimTimer.current), []);

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
    const splashStartedAt = Date.now();
    /** React 闪屏挂载后即可移除 index.html 里的静态启动屏（避免双重叠加） */
    document.getElementById("boot-splash")?.remove();
    /** 数据加载完成（成功或失败）后：至少展示闪屏 MIN_SPLASH_MS，再淡出进入主界面 */
    const finishSplash = () => {
      if (cancelled) return;
      const remain = Math.max(0, MIN_SPLASH_MS - (Date.now() - splashStartedAt));
      window.setTimeout(() => {
        if (cancelled) return;
        setBooted(true); // 触发闪屏淡出过渡
        window.setTimeout(() => setSplash(false), 420); // 过渡结束后卸载
      }, remain);
    };
    void (async () => {
      try {
        const info = await waitHostRuntime();
        if (cancelled) return;
        setSplashStatus("加载会话与设置…");
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
      finishSplash();
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

  /** 侧栏宽度：设置里的数值即时写入 CSS 变量（未设置时移除，回落样式表默认 288px） */
  useEffect(() => {
    const w = settings.sidebarWidth;
    if (typeof w === "number" && Number.isFinite(w)) {
      document.documentElement.style.setProperty("--sidebar-width", `${Math.round(w)}px`);
    } else {
      document.documentElement.style.removeProperty("--sidebar-width");
    }
  }, [settings.sidebarWidth]);

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
        images?: TimelineImage[];
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

  /** 扩展页「提示词 → 插入输入框」：把提示词正文追加到对话输入框并切回对话视图 */
  useEffect(() => {
    const onPromptInsert = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string }>).detail;
      const text = detail?.text?.trim();
      if (!text) return;
      setPrompt((prev) => (prev.trim() ? `${prev.trim()}\n\n${text}` : text));
      setView("chat");
      toast("已插入提示词到输入框", "info");
    };
    window.addEventListener("aluka:prompt-insert", onPromptInsert);
    return () => window.removeEventListener("aluka:prompt-insert", onPromptInsert);
  }, [toast]);

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
    const pending = attachments;
    // 纯图片（无文字）也允许发送
    if ((!text && pending.length === 0) || busy) return;
    try {
      if (!sessionRef.current.id) {
        await createNewChat();
      }
      setPrompt("");
      setAttachments([]);
      setBusy(true);
      await rpc("sendPrompt", {
        text,
        images: pending.map((a) => ({ data: a.base64, mimeType: a.mimeType })),
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
      setBusy(false);
      // 发送失败时还原输入内容，避免用户丢失草稿
      setPrompt((prev) => (prev ? (text ? `${text}\n${prev}` : prev) : text));
      setAttachments(pending);
    }
  }

  return (
    <div
      className={`app-shell ${view !== "chat" ? "settings-open" : ""} ${view !== "chat" ? "settings-mode" : ""} ${sidebarCollapsed && view === "chat" ? "sidebar-collapsed" : ""} ${sidebarAnimating ? "sidebar-animating" : ""}`}
      data-theme={theme}
    >
      <aside
        className={`sidebar ${sidebarCollapsed ? "is-collapsed" : ""}`}
        data-aluka-drag="no-drag"
        style={{ width: sidebarCollapsed ? "var(--sidebar-collapsed-width)" : "var(--sidebar-width)" }}
      >
        {sidebarCollapsed ? (
          <div className="sidebar-rail" data-aluka-drag>
            {/* <button
              type="button"
              className="icon-btn"
              data-aluka-drag="no-drag"
              title="新建会话"
              onClick={() => void createNewChat()}
            >
              <SquarePen size={16} />
            </button> */}
            <Logo size={22} />
          </div>
        ) : (
          <WorkspaceSidebar
            workspaces={workspaces}
            activeCwd={settings.cwd}
            activeSessionId={activeId}
            busySessionIds={busyIds}
            onNewChat={() => void createNewChat()}
            onNewChatIn={(cwd) => void createNewChatIn(cwd)}
            onOpenSession={(id, cwd) => void openSession(id, cwd)}
            onSelectWorkspace={(cwd) => void selectWorkspace(cwd, "latest")}
            onAddWorkspace={() => void chooseWorkspace("latest")}
            onCreateTemp={() => void createTempWorkspace()}
            onDeleteSession={(id, cwd) => void deleteSession(id, cwd)}
            onRemoveWorkspace={(cwd) => void removeWorkspace(cwd)}
            onRevealFolder={(cwd) => void revealFolder(cwd)}
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

      <section
        className="main-col"
        style={{
          // 设置 / 扩展视图隐藏侧栏，占满整行；对话按侧栏状态扣减
          width:
            view !== "chat"
              ? "100%"
              : sidebarCollapsed
                ? "calc(100% - var(--sidebar-collapsed-width))"
                : "calc(100% - var(--sidebar-width))",
        }}
      >
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
                : "扩展"}
          </div>
          <div className="thread-actions" data-aluka-drag="no-drag">
            <button
              type="button"
              className="header-action"
              title="重载扩展（添加插件后手动点击生效）"
              disabled={extReloading}
              onClick={() => void reloadExtensions()}
            >
              <RefreshCw size={15} className={extReloading ? "is-spinning" : undefined} />
            </button>
          </div>
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
          sessionLoading={sessionLoading}
          prompt={prompt}
          setPrompt={setPrompt}
          attachments={attachments}
          setAttachments={setAttachments}
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
            removeWorkspace={removeWorkspace}
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

      <WindowResizeHandle />

      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.level}`}>
            {t.level === "success" ? <CheckCircle2 size={14} className="toast__icon" /> : null}
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      {wsPathOpen ? (
        <Dialog
          open
          title="打开工作区"
          size="md"
          onClose={() => setWsPathOpen(false)}
          footer={
            <>
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
            </>
          }
        >
          <p className="ui-dialog__message">
            输入文件夹路径。未选择时，新对话会使用自动生成的临时目录。
          </p>
          <Input
            label="文件夹路径"
            placeholder="E:\code\my-project"
            value={wsPathDraft}
            onChange={setWsPathDraft}
          />
        </Dialog>
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

      <ConfirmDialog
        open={Boolean(deleteConfirm)}
        title="删除会话"
        variant="danger"
        confirmText="删除"
        message={`确定删除会话「${deleteConfirm?.title ?? ""}」？\n会话记录文件将被删除，此操作不可恢复。`}
        onCancel={() => setDeleteConfirm(undefined)}
        onConfirm={() => void confirmDeleteSession()}
      />

      {splash ? (
        <div className={`splash${booted ? " splash--exit" : ""}`} data-aluka-drag>
          <div className="splash-logo"><Logo size={96} /></div>
          <div className="splash-title">Aluka</div>
          <div className="splash-sub">橙光剖面 · 本地编码助手</div>
          <div className="splash-loader"><span /></div>
          <div className="splash-status">
            {booted ? null : <Spinner size={13} label={splashStatus} />}
            <span>{booted ? "即将进入" : splashStatus}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
