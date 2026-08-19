import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Minus,
  Square,
  X,
  Settings as SettingsIcon,
  Boxes,
  Share2,
  Download,
  SquarePen,
} from "lucide-react";
import { bridge, rpc } from "./bridge.ts";
import { ProvidersPanel } from "./ProvidersPanel.tsx";
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
};

/** 会话摘要：用于侧边栏列表显示 */
type SessionSummary = { id: string; title: string; mtime: number };

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
  const [sessions, setSessions] = useState<SessionSummary[]>([]); // 会话列表
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
  const [modal, setModal] = useState<ExtensionUiRequest | undefined(); // 扩展 UI 弹窗请求
  const [selectChoice, setSelectChoice] = useState<string | undefined>(); // 弹窗选择结果
  const [modalInput, setModalInput] = useState("");             // 弹窗输入内容
  const toastSeq = useRef(0);                                    // Toast 序列号
  const timelineRef = useRef<HTMLDivElement>(null);              // 时间线容器引用（用于自动滚动）

  // 当前主题（默认深色）
  const theme = settings.theme === "light" ? "light" : "dark";

  /** 显示 Toast 通知，4.5 秒后自动消失 */
  const toast = useCallback((message: string, level: Toast["level"] = "info") => {
    const id = ++toastSeq.current;
    setToasts((prev) => [...prev, { id, message, level }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

/** 刷新会话列表 */
  const refreshSessions = useCallback(async () => {
    const list = (await rpc<SessionSummary[]>("listSessions")) ?? [];
    setSessions(list);
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
  const openSession = useCallback(
    async (id: string) => {
      const opened = await rpc<{ id: string; timeline: TimelineItem[] }>("openSession", { id });
      setActiveId(opened.id);
      setTimeline(opened.timeline ?? []);
      setStreaming("");
      setView("chat");
      await refreshSessions();
      await refreshUsage(opened.id);
    },
    [refreshSessions, refreshUsage],
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
        const active = await rpc<{ id?: string }>("getActiveSessionId");
        setActiveId(active?.id);
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
        setTimeline((prev) => [
          ...prev,
          { id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role: "assistant", text: event.text!, timestamp: Date.now() },
        ]);
        return;
      }
      if (event.type === "tool_start") {
        setTimeline((prev) => [
          ...prev,
          {
            id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            role: "tool",
            text: JSON.stringify(event.args, null, 2),
            toolName: event.toolName,
            timestamp: Date.now(),
          },
        ]);
        return;
      }
      if (event.type === "tool_end") {
        setTimeline((prev) => [
          ...prev,
          {
            id: `tr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            role: "tool",
            text: event.isError ? `error: ${event.resultText}` : String(event.resultText ?? ""),
            toolName: `${event.toolName} · 结果`,
            timestamp: Date.now(),
          },
        ]);
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
    const s = sessions.find((x) => x.id === activeId);
    return s?.title || s?.id || "新对话";
  }, [sessions, activeId]);

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
    await refreshExtensions();
    toast("设置已保存", "info");
  }

  return (
    <div className={`app-shell ${view !== "chat" ? "settings-open" : ""}`} data-theme={theme}>
      <aside className="sidebar" data-aluka-drag="no-drag">
        <div className="sidebar-brand" data-aluka-drag>
          <div className="logo" />
          <div className="name">Aluka</div>
          <button type="button" className="icon-btn" data-aluka-drag="no-drag" title="新建会话" onClick={(e) => {
            e.stopPropagation();
            void (async () => {
            const created = await rpc<{ id: string }>("createSession");
            setActiveId(created.id);
            setTimeline([]);
            setStreaming("");
            setView("chat");
            await refreshSessions();
            await refreshUsage(created.id);
          })();
          }}>
            <SquarePen size={16} />
          </button>
        </div>

        <div className="sidebar-actions">
          <button type="button" onClick={() => void (async () => {
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
            <Download size={14} /> 导出
          </button>
          <button type="button" onClick={() => {
            setStatus("正在通过 gh gist 分享…");
            void rpc("shareSession", { id: activeId }).catch((err) => {
              toast(err instanceof Error ? err.message : String(err), "error");
              setStatus(idleStatus);
            });
          }}>
            <Share2 size={14} /> 分享
          </button>
        </div>

        <div className="sidebar-section-label">会话</div>
        <ul className="session-list">
          {sessions.map((s) => (
            <li key={s.id}>
              <button type="button" className={s.id === activeId ? "active" : ""} onClick={() => void openSession(s.id)}>
                <span>{s.title || s.id}</span>
                <span className="sub">{new Date(s.mtime).toLocaleString()}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="sidebar-foot">
          <button type="button" className={`nav ghost-btn ${view === "extensions" ? "active" : ""}`} onClick={() => {
            setView("extensions");
            void refreshExtensions();
          }}>
            <Boxes size={16} /> 扩展
          </button>
          <button type="button" className={`nav ghost-btn ${view === "settings" ? "active" : ""}`} onClick={() => {
            setView("settings");
            void loadSettings();
            void refreshUsage(activeId);
          }}>
            <SettingsIcon size={16} /> 设置
          </button>
          <div className="status-pill" title={status}>{status}</div>
        </div>
      </aside>

      <section className="main-col">
        <header className="thread-header" data-aluka-drag>
          <div className="title" data-aluka-drag="no-drag">
            {view === "chat" ? activeTitle : view === "settings" ? "设置" : "扩展与技能"}
          </div>
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
              {timeline.map((item) => (
                <div key={item.id} className={`bubble ${item.role === "system" ? "error" : item.role}`}>
                  <div className="role">{roleLabel(item.role, item.toolName)}</div>
                  {item.role === "assistant" ? (
                    <Markdown>{item.text}</Markdown>
                  ) : (
                    <div className="bubble-text">{item.text}</div>
                  )}
                </div>
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
                  <Button variant="secondary" disabled={!busy} onClick={() => void rpc("abortPrompt")}>
                    停止
                  </Button>
                  <Button type="submit" disabled={busy || !prompt.trim()}>
                    发送
                  </Button>
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
                  <div className="settings-card">
                    <Input
                      label="工作目录（cwd）"
                      hint="相对路径、技能与本地扩展均相对此目录解析。"
                      value={settings.cwd ?? ""}
                      onChange={(cwd) => setSettings((s) => ({ ...s, cwd }))}
                    />
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
                  </div>
                </section>
              )}

              {settingsSection === "providers" && (
                <section className="settings-panel">
                  <SectionHead
                    title="供应商"
                    hint="管理模型供应商、接口地址与 API 密钥。"
                  />
                  <div className="settings-card settings-card-flush">
                    <ProvidersPanel
                      activeProvider={settings.provider}
                      activeModel={settings.model}
                      onToast={toast}
                      onActiveChanged={() => {
                        void loadSettings();
                      }}
                    />
                  </div>
                  <details className="settings-details">
                    <summary>models.json 只读预览（含 ~/.pi）</summary>
                    <pre className="hint models-preview">{modelsPreviewHtml}</pre>
                  </details>
                </section>
              )}

              {settingsSection === "appearance" && (
                <section className="settings-panel">
                  <SectionHead title="外观" hint="主题立即预览，保存后写入设置。" />
                  <div className="settings-card">
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
                  </div>
                </section>
              )}

              {settingsSection === "packages" && (
                <section className="settings-panel">
                  <SectionHead
                    title="扩展包"
                    hint="可通过本地路径或 npm / file: 安装到 ~/.aluka/agent/npm-packages。同时会自动加载 ~/.pi/agent/settings.json 里 packages（npm: / git:）已安装的插件。"
                  />
                  <div className="settings-card">
                    <ul className="inv-list">
                      {packages.length ? packages.map((pkg) => (
                        <li key={pkg}>
                          <div className="pkg-row">
                            <span>{pkg}</span>
                            <Button variant="secondary" size="sm" onClick={() => void (async () => {
                              await rpc("removeLocalPackage", { path: pkg });
                              await loadSettings();
                              await refreshExtensions();
                            })()}>移除</Button>
                          </div>
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
                  </div>
                </section>
              )}

              {settingsSection === "usage" && (
                <section className="settings-panel">
                  <SectionHead title="用量" hint="当前会话的 token 用量与估算费用，来自模型返回的 usage。" />
                  <div className="settings-card">
                    <p className="settings-meta" id="usage-summary">
                      {usage ? `${formatUsage(usage)}\n${usage.note}` : "当前会话尚无 token 用量。"}
                    </p>
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
                  <div className="settings-card">
                    <p className="settings-meta">{about}</p>
                    <p className="settings-meta">{updateHint}</p>
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

      <div className={`modal ${modal ? "" : "hidden"}`} data-aluka-drag="no-drag">
        {modal && modal.kind !== "notify" ? (
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
