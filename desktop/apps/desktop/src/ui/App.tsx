import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Minus,
  Square,
  X,
  Settings as SettingsIcon,
  Boxes,
  Share2,
  Download,
  Folder,
  FolderPlus,
  PanelLeft,
  SquarePen,
} from "lucide-react";
import { bridge, rpc } from "./bridge.ts";
import { ProvidersPanel } from "./ProvidersPanel.tsx";
import { WorkspaceSidebar, type WorkspaceItem } from "./WorkspaceSidebar.tsx";
import { ToolCard } from "./ToolCard.tsx";
import { Button, Input, Markdown, SectionHead, Select, Switch, Textarea } from "./components/index.ts";
import "./components/ui.css";
import "./styles.css";

/**
 * Aluka Desktop 主应用组件
 *
 * 整体布局：左侧边栏 + 右侧主内容区。
 * 支持三种视图：对话（chat）、设置（settings）、扩展（extensions）。
 * 通过 bridge/rpc 与主进程通信，处理会话管理、模型选择、Prompt 发送等。
 */

/** 时间线消息项：对话中的一条消息 */
type TimelineItem = {
  id: string;
  /** 消息角色：用户/助手/工具/系统 */
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  /** 工具调用时的工具名（仅 tool 类型） */
  toolName?: string;
  timestamp: number;
  toolCallId?: string;
  args?: unknown;
  resultText?: string;
  isError?: boolean;
  toolStatus?: "running" | "done" | "error";
};

/** 会话摘要：用于侧边栏列表显示 */
type SessionSummary = { id: string; title: string; mtime: number };

type OpenedSession = {
  id: string;
  cwd: string;
  timeline?: TimelineItem[];
};

type ChooseWorkspaceResult =
  | { cancelled: true }
  | ({ cancelled: false } & OpenedSession);

function pathsEqual(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
}

/** 设置视图：当前用户配置 */
type SettingsView = {
  model?: string;
  provider?: string;
  baseUrl?: string;
  cwd?: string;
  theme?: "dark" | "light";
  hasApiKey?: boolean;
  extraExtensions?: string[];
  providerPreset?: string;
  workspaces?: string[];
};

/** 模型选项：供模型选择器下拉列表使用 */
type ModelOption = {
  provider: string;
  id: string;
  name?: string;
  api?: string;
  baseUrl?: string;
  /** 是否已配置 API 密钥 */
  configured: boolean;
};

/** 会话用量统计 */
type SessionUsageView = {
  sessionId: string;
  totals: {
    input: number;     // 输入 token 数
    output: number;    // 输出 token 数
    cacheRead: number;  // 缓存读取 token 数
    cacheWrite: number; // 缓存写入 token 数
    totalTokens: number; // 合计 token 数
    calls: number;      // API 调用次数
  };
  estimatedCostUsd?: number; // 预估费用（美元）
  note: string;
};

/** 扩展 UI 请求：扩展可通过此机制与用户交互 */
type ExtensionUiRequest =
  | { id: string; kind: "notify"; message: string; level: "info" | "warning" | "error" }
  | { id: string; kind: "confirm"; title: string; message: string }
  | { id: string; kind: "select"; title: string; options: string[] }
  | { id: string; kind: "input"; title: string; placeholder?: string };

/** Toast 通知项 */
type Toast = { id: number; message: string; level: "info" | "warning" | "error" };

/** 顶层视图切换状态 */
type ShellView = "chat" | "settings" | "extensions";
/** 设置页内的子分区 */
type SettingsSection = "workspace" | "providers" | "appearance" | "packages" | "usage" | "about";

/** 设置页左侧导航菜单配置 */
const SETTINGS_NAV: Array<{ id: SettingsSection; label: string }> = [
  { id: "workspace", label: "工作区" },
  { id: "providers", label: "供应商" },
  { id: "appearance", label: "外观" },
  { id: "packages", label: "扩展包" },
  { id: "usage", label: "用量" },
  { id: "about", label: "关于" },
];

/**
 * 将消息角色转换为中文显示标签
 * @param role - 消息角色
 * @param toolName - 工具名称（可选）
 */
function roleLabel(role: TimelineItem["role"], toolName?: string): string {
  if (toolName) return `工具 · ${toolName}`;
  if (role === "user") return "用户";
  if (role === "assistant") return "助手";
  if (role === "tool") return "工具";
  return "系统";
}

/** 格式化用量统计为简短摘要文本 */
function formatUsage(u?: SessionUsageView): string {
  if (!u || !u.totals.calls) return "用量 —";
  const t = u.totals;
  const cost = typeof u.estimatedCostUsd === "number" ? ` · 约 $${u.estimatedCostUsd.toFixed(4)}` : "";
  return `输入 ${t.input} · 输出 ${t.output} · 合计 ${t.totalTokens} · 调用 ${t.calls}${cost}`;
}

/**
 * 等待 Host 运行时就绪
 * 轮询 getRuntimeInfo 直到 hostReady 为 true，超时 15 秒。
 */
async function waitHostRuntime(): Promise<{ productVersion: string; phase: string; platform: string; hostReady?: boolean }> {
  const deadline = Date.now() + 15000;
  let last: { productVersion: string; phase: string; platform: string; hostReady?: boolean } | undefined;
  while (Date.now() < deadline) {
    last = await rpc<{ productVersion: string; phase: string; platform: string; hostReady?: boolean }>("getRuntimeInfo");
    if (last.hostReady) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (last) return last;
  throw new Error("host 启动超时");
}

/**
 * Aluka Desktop 主应用组件
 *
 * 布局：左侧边栏（会话列表 + 导航）+ 右侧主内容区（对话/设置/扩展）。
 * 通过 bridge/rpc 与主进程通信。
 */
export function App() {
  // ── 状态管理 ──
  const [status, setStatus] = useState("连接中…");          // 底部状态栏文本
  const [idleStatus, setIdleStatus] = useState("就绪");      // 空闲时的状态文本
  const [view, setView] = useState<ShellView>("chat");       // 当前视图：对话/设置/扩展
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("workspace"); // 设置页子分区
  const [sessions, setSessions] = useState<SessionSummary[]>([]); // 当前工作区会话（标题回退）
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [wsPathOpen, setWsPathOpen] = useState(false);
  const [wsPathDraft, setWsPathDraft] = useState("");
  const [wsPickMode, setWsPickMode] = useState<"latest" | "new">("latest");
  const [activeId, setActiveId] = useState<string | undefined>(); // 当前活跃会话 ID
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);   // 当前会话时间线
  const [busy, setBusy] = useState(false);                        // 是否正在处理请求
  const [prompt, setPrompt] = useState("");                      // 输入框内容
  const [streaming, setStreaming] = useState("");                // 正在流式输出的文本
  const [settings, setSettings] = useState<SettingsView>({});     // 用户设置
  const [apiKeyDraft, setApiKeyDraft] = useState("");            // API Key 输入草稿
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]); // 可用模型列表
  const [pkgPath, setPkgPath] = useState("");                   // 本地扩展包路径输入
  const [npmSpec, setNpmSpec] = useState("");                   // npm 包规格输入
  const [npmHint, setNpmHint] = useState("");                   // npm 安装结果提示
  const [packages, setPackages] = useState<string[]>([]);        // 已注册的本地扩展包
  const [usage, setUsage] = useState<SessionUsageView | undefined>(); // 会话用量统计
  const [extSummary, setExtSummary] = useState("");             // 扩展加载摘要
  const [extList, setExtList] = useState<Array<{ path: string; tools: string[]; commands: string[] }>>([]); // 已加载扩展
  const [extErrors, setExtErrors] = useState<Array<{ path: string; error: string }>>([]); // 扩展加载错误
  const [skills, setSkills] = useState<Array<{ name: string; description: string; path: string }>>([]); // 可用技能
  const [modelsPreviewHtml, setModelsPreview] = useState<string>(""); // models.json 预览
  const [updateHint, setUpdateHint] = useState(
    "可选：设置环境变量 ALUKA_DESKTOP_RELEASES_URL 指向 GitHub releases/latest JSON。",
  );
  const [about, setAbout] = useState("");                       // 关于信息
  const [toasts, setToasts] = useState<Toast[]>([]);            // Toast 通知列表
  const [modal, setModal] = useState<ExtensionUiRequest | undefined>(); // 扩展 UI 弹窗请求
  const [selectChoice, setSelectChoice] = useState<string | undefined>(); // 弹窗选择结果
  const [modalInput, setModalInput] = useState("");             // 弹窗输入内容
  const toastSeq = useRef(0);                                    // Toast 序列号
  const timelineRef = useRef<HTMLDivElement>(null);              // 时间线容器引用（用于自动滚动）
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
  const toast = useCallback((message: string, level: Toast["level"] = "info") => {
    const id = ++toastSeq.current;
    setToasts((prev) => [...prev, { id, message, level }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

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

  /** 刷新扩展、技能列表及加载错误信息 */
  const refreshExtensions = useCallback(async () => {
    const [inv, skillList] = await Promise.all([
      rpc<{ extensions: typeof extList; errors: typeof extErrors }>("listExtensions"),
      rpc<typeof skills>("listSkills"),
    ]);
    setExtList(inv?.extensions ?? []);
    setExtErrors(inv?.errors ?? []);
    setSkills(skillList ?? []);
    setExtSummary(
      `已加载 ${inv?.extensions?.length ?? 0} 个扩展，${inv?.errors?.length ?? 0} 个错误，${skillList?.length ?? 0} 个技能`,
    );
  }, []);

/**
   * 加载所有设置：用户设置、本地扩展包、模型选项、models.json 预览。
   * 同时更新主题和扩展列表。
   */
  const loadSettings = useCallback(async () => {
    const s = await rpc<SettingsView>("getSettings");
    setSettings(s ?? {});
    setApiKeyDraft("");
    document.documentElement.setAttribute("data-theme", s?.theme === "light" ? "light" : "dark");
    const pkgs = (await rpc<string[]>("listLocalPackages")) ?? s?.extraExtensions ?? [];
    setPackages(pkgs);
    const options = (await rpc<ModelOption[]>("listModelOptions")) ?? [];
    setModelOptions(options);
    const preview = await rpc<{
      sources: Array<{
        path: string;
        exists: boolean;
        error?: string;
        providers: Array<{
          provider: string;
          baseUrl?: string;
          api?: string;
          hasApiKeyField: boolean;
          models: Array<{ id: string; name?: string }>;
        }>;
      }>;
    }>("getModelsJsonPreview");
    const blocks: string[] = [];
    for (const source of preview?.sources ?? []) {
      blocks.push(`${source.path} — ${source.exists ? (source.error ?? "ok") : "missing"}`);
      for (const p of source.providers ?? []) {
        blocks.push(
          `  ${p.provider}: ${p.api || "?"} · ${p.baseUrl || "default"} · models ${p.models.map((m) => m.id).join(", ") || "—"} · key:${p.hasApiKeyField ? "yes" : "no"}`,
        );
      }
    }
    setModelsPreview(blocks.join("\n") || "未找到 models.json");
  }, []);

  /**
   * 打开指定会话：加载时间线、切换到对话视图、刷新列表和用量
   */
  const applyOpened = useCallback(
    async (opened: OpenedSession) => {
      setActiveId(opened.id);
      setTimeline(opened.timeline ?? []);
      setStreaming("");
      setView("chat");
      setSettings((s) => ({ ...s, cwd: opened.cwd }));
      await refreshSessions();
      await refreshUsage(opened.id);
    },
    [refreshSessions, refreshUsage],
  );

  const openSession = useCallback(
    async (id: string, cwd?: string) => {
      const opened = await rpc<OpenedSession>("openSession", { id, cwd });
      await applyOpened(opened);
    },
    [applyOpened],
  );

  const createNewChat = useCallback(async () => {
    const created = await rpc<OpenedSession>("createSession", { cwd: settings.cwd });
    await applyOpened({ ...created, timeline: [] });
  }, [applyOpened, settings.cwd]);

  const selectWorkspace = useCallback(
    async (dir: string, mode: "latest" | "new" = "latest") => {
      const opened = await rpc<OpenedSession>("selectWorkspace", { path: dir, mode });
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
    const opened = await rpc<OpenedSession>("createTempWorkspace", { mode: "new" });
    await applyOpened(opened);
    toast("已使用临时工作区", "info");
  }, [applyOpened, toast]);

  const addWorkspaceByPath = useCallback(
    async (dir: string, mode: "latest" | "new" = "latest") => {
      const opened = await rpc<OpenedSession>("addWorkspace", { path: dir, mode });
      await applyOpened(opened);
    },
    [applyOpened],
  );

  const chooseWorkspace = useCallback(
    async (mode: "latest" | "new" = "latest") => {
      try {
        const result = await rpc<ChooseWorkspaceResult>("chooseWorkspace", { mode });
        if (result?.cancelled) return;
        if (!result) {
          setWsPickMode(mode);
          setWsPathDraft(settings.cwd ?? "");
          setWsPathOpen(true);
          return;
        }
        await applyOpened(result);
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "error");
        setWsPickMode(mode);
        setWsPathDraft(settings.cwd ?? "");
        setWsPathOpen(true);
      }
    },
    [applyOpened, settings.cwd, toast],
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
        const active = await rpc<{ id?: string; cwd?: string }>("getActiveSessionId");
        setActiveId(active?.id);
        if (active?.cwd) setSettings((s) => ({ ...s, cwd: active.cwd }));
        if (active?.id) {
          const items = await rpc<TimelineItem[]>("getTimeline");
          setTimeline(items ?? []);
        }
        await refreshSessions();
        await loadSettings();
        await refreshExtensions();
        await refreshUsage(active?.id);
        bridge().events.emit("ui-ready", { at: Date.now(), phase: 5, ui: "zeno-react" });
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err));
        toast(String(err), "error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSettings, refreshExtensions, refreshSessions, refreshUsage, toast]);

  /**
   * 运行时事件监听 Effect
   * 处理 agent_start/end、text_delta、message_end、tool_start/end、
   * extension_ui、usage、error 等事件。
   */
  useEffect(() => {
    const onRuntime = (raw: unknown) => {
      const event = raw as {
        type: string;
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
      if (event.type === "agent_start") {
        setBusy(true);
        setStreaming("");
        return;
      }
      if (event.type === "agent_end") {
        setBusy(false);
        setStreaming("");
        void refreshSessions();
        return;
      }
      if (event.type === "text_delta" && event.text) {
        setStreaming((prev) => prev + event.text!);
        return;
      }
      if (event.type === "message_end" && event.role === "user" && event.text != null) {
        setTimeline((prev) => [
          ...prev,
          { id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role: "user", text: event.text!, timestamp: Date.now() },
        ]);
        return;
      }
      if (event.type === "message_end" && event.role === "assistant" && event.text != null) {
        setStreaming("");
        if (!event.text.trim()) return;
        setTimeline((prev) => [
          ...prev,
          { id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role: "assistant", text: event.text!, timestamp: Date.now() },
        ]);
        return;
      }
      if (event.type === "tool_start") {
        const toolCallId = event.toolCallId;
        setTimeline((prev) => [
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
        setTimeline((prev) => {
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
        setTimeline((prev) => [
          ...prev,
          { id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role: "system", text: event.message!, timestamp: Date.now() },
        ]);
        setBusy(false);
      }
    };

    const onPromptResult = (raw: unknown) => {
      const result = raw as { ok?: boolean; error?: string };
      if (result?.ok === false && result.error) toast(result.error, "error");
      setBusy(false);
      void refreshSessions();
    };

    const onShare = (raw: unknown) => {
      const result = raw as { ok?: boolean; error?: string; gistUrl?: string; gistId?: string };
      if (result?.ok && result.gistUrl) {
        toast(`已分享 Gist ${result.gistId ?? ""}`, "info");
        setStatus(`已分享 → ${result.gistUrl}`);
        setTimeout(() => setStatus(idleStatus), 4000);
        return;
      }
      toast(result?.error ?? "分享失败", "error");
      setStatus(idleStatus);
    };

    const onPackageInstall = (raw: unknown) => {
      const result = raw as { ok?: boolean; error?: string; packageName?: string; entryPath?: string; runner?: string };
      if (result?.ok) {
        setNpmHint(`已通过 ${result.runner} 安装 ${result.packageName} → ${result.entryPath}`);
        setNpmSpec("");
        void loadSettings();
        void refreshExtensions();
        toast(`扩展包 ${result.packageName} 已安装`, "info");
        return;
      }
      setNpmHint(result?.error ?? "安装失败");
      toast(result?.error ?? "安装失败", "error");
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
        setUpdateHint(`已是最新（当前 ${result.current}，最新 ${result.latest}）`);
        return;
      }
      setUpdateHint(`发现新版本：${result?.latest}（当前 ${result?.current}）${result?.url ? ` · ${result.url}` : ""}`);
    };

    const bus = bridge().events;
    bus.on("runtime.event", onRuntime);
    bus.on("prompt.result", onPromptResult);
    bus.on("session.share", onShare);
    bus.on("package.install", onPackageInstall);
    bus.on("update.check", onUpdateCheck);

    return () => {
      bus.off("runtime.event", onRuntime);
      bus.off("prompt.result", onPromptResult);
      bus.off("session.share", onShare);
      bus.off("package.install", onPackageInstall);
      bus.off("update.check", onUpdateCheck);
    };
  }, [idleStatus, loadSettings, refreshExtensions, refreshSessions, toast]);

  /** 自动滚动时间线到底部（新消息出现时） */
  useEffect(() => {
    const el = timelineRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [timeline, streaming]);

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

  const isEmptyChat = view === "chat" && timeline.length === 0 && !streaming;

  async function respondUi(
    response:
      | { id: string; kind: "confirm"; value: boolean }
      | { id: string; kind: "select"; value?: string }
      | { id: string; kind: "input"; value?: string },
  ) {
    await rpc("respondExtensionUi", response);
    setModal(undefined);
  }

  async function onSend(e?: React.FormEvent) {
    e?.preventDefault();
    const text = prompt.trim();
    if (!text || busy) return;
    setPrompt("");
    setBusy(true);
    try {
      await rpc("sendPrompt", { text });
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
      setBusy(false);
    }
  }

  async function saveGeneralSettings() {
    const patch: Record<string, unknown> = {
      cwd: (settings.cwd ?? "").trim(),
      model: (settings.model ?? "").trim(),
      provider: (settings.provider ?? "").trim(),
      baseUrl: (settings.baseUrl ?? "").trim(),
      theme,
    };
    if (apiKeyDraft.trim()) patch.apiKey = apiKeyDraft.trim();
    await rpc("patchSettings", patch);
    await loadSettings();
    await refreshSessions();
    await refreshExtensions();
    toast("设置已保存", "info");
  }

  return (
    <div className={`app-shell ${view !== "chat" ? "settings-open" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`} data-theme={theme}>
      <aside className={`sidebar ${sidebarCollapsed ? "is-collapsed" : ""}`} data-aluka-drag="no-drag">
        {sidebarCollapsed ? (
          <div className="sidebar-rail" data-aluka-drag>
            <button type="button" className="icon-btn" data-aluka-drag="no-drag" title="展开侧栏" onClick={() => toggleSidebar(false)}>
              <PanelLeft size={16} />
            </button>
            <button type="button" className="icon-btn" data-aluka-drag="no-drag" title="新建会话" onClick={() => void createNewChat()}>
              <SquarePen size={16} />
            </button>
          </div>
        ) : (
          <WorkspaceSidebar
            workspaces={workspaces}
            activeCwd={settings.cwd}
            activeSessionId={activeId}
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
          <button type="button" className={`nav ghost-btn ${view === "extensions" ? "active" : ""}`} onClick={() => {
            setView("extensions");
            void refreshExtensions();
          }}>
            <Boxes size={16} /> <span>扩展</span>
          </button>
          <button type="button" className={`nav ghost-btn ${view === "settings" ? "active" : ""}`} onClick={() => {
            setView("settings");
            void loadSettings();
            void refreshUsage(activeId);
          }}>
            <SettingsIcon size={16} /> <span>设置</span>
          </button>
          <div className="status-pill" title={status}>{status}</div>
        </div>
      </aside>

      <section className="main-col">
        <header className="thread-header" data-aluka-drag>
          {sidebarCollapsed ? (
            <button type="button" className="icon-btn" data-aluka-drag="no-drag" title="展开侧栏" onClick={() => toggleSidebar(false)}>
              <PanelLeft size={16} />
            </button>
          ) : null}
          <div className="title" data-aluka-drag="no-drag">
            {view === "chat" ? activeTitle : view === "settings" ? "设置" : "扩展与技能"}
          </div>
          {view === "chat" ? (
            <div className="thread-actions" data-aluka-drag="no-drag">
              <button type="button" className="icon-btn" title="导出" onClick={() => void (async () => {
                const result = await rpc<{ ok?: boolean; error?: string; path?: string; format?: string; bytes?: number }>(
                  "exportSession",
                  { format: "markdown", id: activeId },
                );
                if (result?.ok && result.path) {
                  toast(`已导出 ${result.format}（${result.bytes ?? 0} 字节）`, "info");
                  setStatus(`已导出 → ${result.path}`);
                  setTimeout(() => setStatus(idleStatus), 2500);
                } else toast(result?.error ?? "导出失败", "error");
              })()}>
                <Download size={14} />
              </button>
              <button type="button" className="icon-btn" title="分享" onClick={() => {
                setStatus("正在通过 gh gist 分享…");
                void rpc("shareSession", { id: activeId }).catch((err) => {
                  toast(err instanceof Error ? err.message : String(err), "error");
                  setStatus(idleStatus);
                });
              }}>
                <Share2 size={14} />
              </button>
            </div>
          ) : null}
          <div className="window-controls" data-aluka-drag="no-drag">
            <button type="button" title="最小化" onClick={() => bridge().window.minimize()}><Minus size={14} /></button>
            <button type="button" title="最大化" onClick={() => bridge().window.toggleMaximize()}><Square size={12} /></button>
            <button type="button" className="close" title="隐藏到托盘" onClick={() => void rpc("hideToTray").catch(() => bridge().window.close())}>
              <X size={14} />
            </button>
          </div>
        </header>

        {view === "chat" && (
          <>
            <div className="timeline" ref={timelineRef}>
              {isEmptyChat ? (
                <div className="chat-empty">
                  <div className="chat-empty-kicker">开始对话</div>
                  <h2>选择一个工作区</h2>
                  <p>Agent 会在该目录下读写文件、加载技能与扩展。未选择时将使用自动生成的临时目录。</p>
                  <div className="chat-empty-current">
                    <Folder size={16} />
                    <div>
                      <div className="chat-empty-name">
                        {activeWorkspace?.name || (settings.cwd ? settings.cwd.split(/[\\/]/).pop() : "临时工作区")}
                      </div>
                      <div className="chat-empty-path">
                        {settings.cwd || "尚未选择，发送消息时会创建临时目录"}
                      </div>
                    </div>
                  </div>
                  <div className="chat-empty-actions">
                    <Button onClick={() => void chooseWorkspace("new")}>
                      <FolderPlus size={14} /> 打开文件夹
                    </Button>
                    <Button variant="secondary" onClick={() => void createTempWorkspace()}>
                      使用临时目录
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setWsPickMode("new");
                        setWsPathDraft(settings.cwd ?? "");
                        setWsPathOpen(true);
                      }}
                    >
                      输入路径
                    </Button>
                  </div>
                  {workspaces.filter((ws) => !ws.temporary || !pathsEqual(ws.path, settings.cwd)).length ? (
                    <div className="chat-empty-recent">
                      <div className="chat-empty-recent-label">最近工作区</div>
                      {workspaces.slice(0, 6).map((ws) => (
                        <button
                          key={ws.path}
                          type="button"
                          className={pathsEqual(ws.path, settings.cwd) ? "active" : ""}
                          onClick={() => void selectWorkspace(ws.path, "new")}
                        >
                          <Folder size={14} />
                          <span>{ws.name}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {timeline.map((item) => (
                item.role === "tool" ? (
                  <div key={item.id} className="bubble tool">
                    <ToolCard item={item} />
                  </div>
                ) : (
                  <div key={item.id} className={`bubble ${item.role === "system" ? "error" : item.role}`}>
                    <div className="role">{roleLabel(item.role, item.toolName)}</div>
                    {item.role === "assistant" ? (
                      <Markdown>{item.text}</Markdown>
                    ) : (
                      <div className="bubble-text">{item.text}</div>
                    )}
                  </div>
                )
              ))}
              {streaming ? (
                <div className="bubble assistant">
                  <div className="role">助手</div>
                  <Markdown>{streaming}</Markdown>
                </div>
              ) : null}
            </div>
            <div className="composer-wrap" data-aluka-drag="no-drag">
              <form className="composer" onSubmit={(e) => void onSend(e)}>
                <button
                  type="button"
                  className="composer-workspace"
                  title={settings.cwd || "临时工作区"}
                  onClick={() => void chooseWorkspace(isEmptyChat ? "new" : "latest")}
                >
                  <Folder size={13} />
                  <span>
                    {activeWorkspace?.name
                      || (settings.cwd ? settings.cwd.split(/[\\/]/).pop() : "选择工作区")}
                  </span>
                </button>
                <Textarea
                  className="ui-textarea--composer"
                  rows={3}
                  value={prompt}
                  placeholder="给 Agent 发消息…（Enter 发送，Shift+Enter 换行）"
                  onChange={setPrompt}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void onSend();
                    }
                  }}
                />
                <div className="composer-actions">
                  <Select
                    className="model-picker ui-select--compact"
                    value={
                      settings.provider && settings.model
                        ? `${settings.provider}/${settings.model}`
                        : ""
                    }
                    disabled={busy}
                    placeholder="暂无模型 — 请到设置中添加"
                    options={
                      modelOptions.length
                        ? modelOptions.map((m) => ({
                            value: `${m.provider}/${m.id}`,
                            label: `${m.provider}/${m.name || m.id}${m.configured ? "" : " · 缺密钥"}`,
                          }))
                        : settings.provider && settings.model
                          ? [{
                              value: `${settings.provider}/${settings.model}`,
                              label: `${settings.provider}/${settings.model}`,
                            }]
                          : []
                    }
                    onChange={(next) => {
                      const [provider, ...rest] = next.split("/");
                      const modelId = rest.join("/");
                      if (!provider || !modelId) return;
                      void (async () => {
                        try {
                          const view = await rpc<SettingsView>("selectModel", { provider, modelId });
                          setSettings(view ?? {});
                          toast(`模型 → ${provider}/${modelId}`, "info");
                        } catch (err) {
                          toast(err instanceof Error ? err.message : String(err), "error");
                        }
                      })();
                    }}
                  />
                  {busy ? (
                    <button
                      type="button"
                      className="composer-run-btn"
                      title="停止生成"
                      aria-label="停止生成"
                      onClick={() => void rpc("abortPrompt")}
                    >
                      <span className="composer-run-btn__orbit" aria-hidden="true">
                        <span className="composer-run-btn__spark" />
                      </span>
                      <span className="composer-run-btn__stop" />
                    </button>
                  ) : (
                    <Button type="submit" disabled={!prompt.trim()}>
                      发送
                    </Button>
                  )}
                </div>
              </form>
              <div className="usage-chip">{formatUsage(usage)}</div>
            </div>
          </>
        )}

        {view === "settings" && (
          <div className="settings-split" data-aluka-drag="no-drag">
            <nav className="settings-nav">
              <div className="settings-nav-title">设置</div>
              {SETTINGS_NAV.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={settingsSection === item.id ? "active" : ""}
                  onClick={() => setSettingsSection(item.id)}
                >
                  {item.label}
                </button>
              ))}
              <div className="settings-nav-foot">
                <Button onClick={() => void saveGeneralSettings()}>保存</Button>
                <Button variant="secondary" onClick={() => setView("chat")}>返回对话</Button>
              </div>
            </nav>

            <div className="settings-content">
              {settingsSection === "workspace" && (
                <section className="settings-panel">
                  <SectionHead
                    title="工作区"
                    hint="Agent 运行时的工作目录，影响相对路径、技能与本地扩展解析。"
                  />
                  <Input
                    label="工作目录（cwd）"
                    hint="相对路径、技能与本地扩展均相对此目录解析。留空并保存不会改路径；新对话未选择时使用临时目录。"
                    value={settings.cwd ?? ""}
                    onChange={(cwd) => setSettings((s) => ({ ...s, cwd }))}
                  />
                  <div className="settings-inline-actions">
                    <Button variant="secondary" onClick={() => void chooseWorkspace("latest")}>
                      浏览文件夹
                    </Button>
                    <Button variant="secondary" onClick={() => void createTempWorkspace()}>
                      使用临时目录
                    </Button>
                  </div>
                  {workspaces.length ? (
                    <ul className="ws-settings-list">
                      {workspaces.map((ws) => (
                        <li key={ws.path} className={pathsEqual(ws.path, settings.cwd) ? "active" : ""}>
                          <button type="button" onClick={() => void selectWorkspace(ws.path, "latest")}>
                            <strong>{ws.name}</strong>
                            <span>{ws.path}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="settings-meta">
                    当前模型：{settings.provider || "—"}/{settings.model || "—"}
                    {settings.baseUrl ? ` · ${settings.baseUrl}` : ""}
                  </p>
                  <Input
                    label="全局回退 API Key"
                    type="password"
                    value={apiKeyDraft}
                    placeholder="留空则保持不变"
                    onChange={setApiKeyDraft}
                    hint="写入 settings.json。用作各供应商密钥的全局回退。"
                    status={settings.hasApiKey ? "已配置全局/环境密钥" : "未配置全局/环境密钥"}
                  />
                  <div className="settings-inline-actions">
                    <Button onClick={() => void saveGeneralSettings()}>保存工作区</Button>
                  </div>
                </section>
              )}

              {settingsSection === "providers" && (
                <section className="settings-panel">
                  <ProvidersPanel
                    activeProvider={settings.provider}
                    activeModel={settings.model}
                    onToast={toast}
                    onActiveChanged={() => {
                      void loadSettings();
                    }}
                  />
                  <details className="settings-details">
                    <summary>models.json 只读预览（含 ~/.pi）</summary>
                    <pre className="hint models-preview">{modelsPreviewHtml}</pre>
                  </details>
                </section>
              )}

              {settingsSection === "appearance" && (
                <section className="settings-panel">
                  <SectionHead title="外观" hint="主题立即预览，保存后写入设置。" />
                  <Switch
                    label="深色主题"
                    hint="关闭后切换为浅色主题。需点击保存才会写入设置。"
                    checked={theme === "dark"}
                    onChange={(on) => {
                      const next = on ? "dark" : "light";
                      setSettings((s) => ({ ...s, theme: next }));
                      document.documentElement.setAttribute("data-theme", next);
                    }}
                  />
                  <div className="settings-inline-actions">
                    <Button onClick={() => void saveGeneralSettings()}>保存外观</Button>
                  </div>
                </section>
              )}

              {settingsSection === "packages" && (
                <section className="settings-panel">
                  <SectionHead
                    title="扩展包"
                    hint="可通过本地路径或 npm / file: 安装到 ~/.aluka/agent/npm-packages。同时会自动加载 ~/.pi/agent/settings.json 里 packages（npm: / git:）已安装的插件。"
                  />
                  <ul className="pkg-list">
                    {packages.length ? packages.map((pkg) => (
                      <li key={pkg} className="pkg-row">
                        <span>{pkg}</span>
                        <Button variant="ghost" size="sm" onClick={() => void (async () => {
                          await rpc("removeLocalPackage", { path: pkg });
                          await loadSettings();
                          await refreshExtensions();
                        })()}>移除</Button>
                      </li>
                    )) : <li className="hint">尚未注册本地扩展包</li>}
                  </ul>
                  <div className="pkg-add">
                    <Input
                      label="本地路径"
                      hint="扩展入口文件或目录的绝对路径。"
                      value={pkgPath}
                      placeholder="E:\path\to\extension.ts"
                      onChange={setPkgPath}
                    />
                    <Button variant="secondary" onClick={() => void (async () => {
                      if (!pkgPath.trim()) return;
                      await rpc("addLocalPackage", { path: pkgPath.trim() });
                      setPkgPath("");
                      await loadSettings();
                      await refreshExtensions();
                    })()}>添加路径</Button>
                  </div>
                  <div className="pkg-add">
                    <Input
                      label="npm 包"
                      hint="npm 包名，或 file:./my-ext 本地包。"
                      value={npmSpec}
                      placeholder="npm 包名或 file:./my-ext"
                      onChange={setNpmSpec}
                    />
                    <Button variant="secondary" onClick={() => {
                      if (!npmSpec.trim()) return;
                      setNpmHint(`正在安装 ${npmSpec}…`);
                      void rpc("installNpmPackage", { spec: npmSpec.trim() });
                    }}>安装</Button>
                  </div>
                  {npmHint ? <p className="settings-meta">{npmHint}</p> : null}
                </section>
              )}

              {settingsSection === "usage" && (
                <section className="settings-panel">
                  <SectionHead title="用量" hint="当前会话的 token 用量与估算费用，来自模型返回的 usage。" />
                  <p className="settings-meta" id="usage-summary">
                    {usage ? `${formatUsage(usage)}\n${usage.note}` : "当前会话尚无 token 用量。"}
                  </p>
                  <div className="settings-inline-actions">
                    <Button variant="secondary" onClick={() => void refreshUsage(activeId)}>刷新用量</Button>
                  </div>
                </section>
              )}

              {settingsSection === "about" && (
                <section className="settings-panel">
                  <SectionHead
                    title="关于"
                    hint="可选：设置环境变量 ALUKA_DESKTOP_RELEASES_URL 指向 GitHub releases/latest JSON，以启用检查更新。"
                  />
                  <p className="settings-meta">{about}</p>
                  <p className="settings-meta">{updateHint}</p>
                  <div className="settings-inline-actions">
                    <Button variant="secondary" onClick={() => {
                      setUpdateHint("正在检查…");
                      void rpc("checkForUpdates");
                    }}>检查更新</Button>
                  </div>
                </section>
              )}
            </div>
          </div>
        )}

        {view === "extensions" && (
          <div className="settings-page" data-aluka-drag="no-drag">
            <div className="settings-page-inner">
              <SectionHead
                title="扩展与技能"
                hint="展示当前工作目录下已加载的扩展、加载错误以及可用技能。"
              />
              <p className="settings-meta">{extSummary}</p>
              <h3 className="sidebar-section-label">已加载</h3>
              <ul className="inv-list">
                {extList.length ? extList.map((ext) => (
                  <li key={ext.path}>
                    <strong>{ext.path}</strong>
                    <div className="hint">工具：{ext.tools.join(", ") || "—"}</div>
                    <div className="hint">命令：{ext.commands.join(", ") || "—"}</div>
                  </li>
                )) : <li className="hint">未加载扩展</li>}
              </ul>
              <h3 className="sidebar-section-label">错误</h3>
              <ul className="inv-list">
                {extErrors.length ? extErrors.map((err) => (
                  <li key={err.path}><strong>{err.path}</strong><div style={{ color: "var(--danger)" }}>{err.error}</div></li>
                )) : <li className="hint">无</li>}
              </ul>
              <h3 className="sidebar-section-label">技能</h3>
              <ul className="inv-list">
                {skills.length ? skills.map((s) => (
                  <li key={s.path}><strong>{s.name}</strong><div className="hint">{s.description || s.path}</div></li>
                )) : <li className="hint">当前工作目录下没有技能</li>}
              </ul>
              <div style={{ display: "flex", gap: 8 }}>
                <Button variant="secondary" onClick={() => void refreshExtensions()}>刷新</Button>
                <Button variant="secondary" onClick={() => setView("chat")}>返回</Button>
              </div>
            </div>
          </div>
        )}
      </section>

      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.level}`}>{t.message}</div>
        ))}
      </div>

      <div className={`modal ${modal || wsPathOpen ? "" : "hidden"}`} data-aluka-drag="no-drag">
        {wsPathOpen ? (
          <div className="modal-card">
            <h3>打开工作区</h3>
            <p className="modal-body">输入文件夹路径。未选择时，新对话会使用自动生成的临时目录。</p>
            <Input
              className="modal-input"
              label="文件夹路径"
              placeholder="E:\code\my-project"
              value={wsPathDraft}
              onChange={setWsPathDraft}
            />
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setWsPathOpen(false)}>取消</Button>
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
          <div className="modal-card">
            <h3>{modal.title}</h3>
            <p className="modal-body">{modal.kind === "confirm" ? modal.message : modal.kind === "select" ? "请选择一项：" : ""}</p>
            {modal.kind === "select" ? (
              <div className="modal-options">
                {modal.options.map((opt) => (
                  <button key={opt} type="button" style={{ outline: selectChoice === opt ? "1px solid var(--link)" : undefined }} onClick={() => setSelectChoice(opt)}>
                    {opt}
                  </button>
                ))}
              </div>
            ) : null}
            {modal.kind === "input" ? (
              <Input
                className="modal-input"
                placeholder={modal.placeholder ?? ""}
                value={modalInput}
                onChange={setModalInput}
              />
            ) : null}
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => {
                if (modal.kind === "confirm") void respondUi({ id: modal.id, kind: "confirm", value: false });
                if (modal.kind === "select") void respondUi({ id: modal.id, kind: "select", value: undefined });
                if (modal.kind === "input") void respondUi({ id: modal.id, kind: "input", value: undefined });
              }}>取消</Button>
              <Button onClick={() => {
                if (modal.kind === "confirm") void respondUi({ id: modal.id, kind: "confirm", value: true });
                if (modal.kind === "select") void respondUi({ id: modal.id, kind: "select", value: selectChoice });
                if (modal.kind === "input") void respondUi({ id: modal.id, kind: "input", value: modalInput });
              }}>确定</Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
