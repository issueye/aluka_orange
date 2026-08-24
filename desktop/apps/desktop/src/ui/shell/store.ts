/**
 * 壳层状态容器（shell / session 两域，外部 store + 选择器订阅）
 *
 * - 手写 createStore（零依赖，useSyncExternalStore 消费）；
 * - 选择器必须返回 state 字段的直接引用（不可变更新），避免 getSnapshot 抖动；
 * - shell 域（壳/设置/贡献/toast）与 session 域（会话/时间线/流式）分离，
 *   保证 text_delta 高频更新下 chrome（侧栏/顶栏）零重渲染。
 *
 * 架构见 desktop/docs/shell-plugin-design.md §2.3。
 */
import { useSyncExternalStore } from "react";
import { sessionKey } from "../lib/utils.ts";
import type {
  ExtensionUiRequest,
  ImageAttachment,
  ModelOption,
  SessionSummary,
  SessionUsageView,
  SettingsView,
  ShellView,
  TimelineItem,
  Toast,
  UiContribution,
} from "../types.ts";
import type { WorkspaceItem } from "../WorkspaceSidebar.tsx";

/** 最小外部 store：get / set(partial 或 updater) / subscribe */
export function createStore<T extends object>(initial: () => T) {
  let state: T = initial();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get(): T {
      return state;
    },
    set(patch: Partial<T> | ((prev: T) => Partial<T>)): void {
      const next = typeof patch === "function" ? patch(state) : patch;
      const changed = Object.keys(next).some(
        (key) => (next as Record<string, unknown>)[key] !== (state as Record<string, unknown>)[key],
      );
      if (!changed) return;
      state = { ...state, ...next };
      notify();
    },
  };
}

// ── Shell 域 ──

export interface ShellState {
  status: string;
  idleStatus: string;
  view: ShellView;
  toasts: Toast[];
  modal?: ExtensionUiRequest;
  selectChoice?: string;
  modalInput: string;
  wsPathOpen: boolean;
  wsPathDraft: string;
  wsPickMode: "latest" | "new";
  deleteConfirm?: { id: string; cwd: string; title: string };
  sidebarCollapsed: boolean;
  sidebarAnimating: boolean;
  splash: boolean;
  booted: boolean;
  splashStatus: string;
  updateHint: string;
  about: string;
  extReloading: boolean;
  uiContributions: UiContribution[];
  /** 用户禁用的贡献 id 集合（localStorage 持久化；SlotOutlet 与菜单同步过滤） */
  disabledContributions: string[];
  settings: SettingsView;
  modelOptions: ModelOption[];
}

function initialSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem("aluka.sidebarCollapsed") === "1";
  } catch {
    return false;
  }
}

function initialDisabledContributions(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem("aluka.disabledContributions") ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.map(String) : [];
  } catch {
    return [];
  }
}

/** 初始视图：支持 ?view=settings|extensions|plugin:<id>（浏览器模式直达） */
function initialView(): ShellView {
  try {
    const param = new URLSearchParams(window.location.search).get("view");
    if (param && /^(settings|extensions|plugin:[A-Za-z0-9._-]+)$/.test(param)) {
      return param as ShellView;
    }
  } catch {
    /* ignore */
  }
  return "chat";
}

export const shellStore = createStore<ShellState>(() => ({
  status: "连接中…",
  idleStatus: "就绪",
  view: initialView(),
  toasts: [],
  modal: undefined,
  selectChoice: undefined,
  modalInput: "",
  wsPathOpen: false,
  wsPathDraft: "",
  wsPickMode: "latest",
  sidebarCollapsed: initialSidebarCollapsed(),
  sidebarAnimating: false,
  splash: true,
  booted: false,
  splashStatus: "正在启动本地运行时…",
  updateHint: "可选：设置环境变量 ALUKA_DESKTOP_RELEASES_URL 指向 GitHub releases/latest JSON。",
  about: "",
  extReloading: false,
  uiContributions: [],
  disabledContributions: initialDisabledContributions(),
  settings: {},
  modelOptions: [],
}));

// ── Session 域 ──

export interface SessionState {
  sessions: SessionSummary[];
  workspaces: WorkspaceItem[];
  activeId?: string;
  timeline: TimelineItem[];
  streaming: string;
  /** 流式中的思考内容（thinking_delta 累积展示） */
  thinking: string;
  busy: boolean;
  busyIds: Set<string>;
  usage?: SessionUsageView;
  prompt: string;
  attachments: ImageAttachment[];
  /** 会话打开中（时间线加载占位） */
  sessionLoading: boolean;
  /** 活跃会话 ID 的镜像：事件回调按它路由，后台会话事件不污染当前时间线 */
  sessionRef: { cwd?: string; id?: string };
}

export const sessionStore = createStore<SessionState>(() => ({
  sessions: [],
  workspaces: [],
  activeId: undefined,
  timeline: [],
  streaming: "",
  thinking: "",
  busy: false,
  busyIds: new Set(),
  usage: undefined,
  prompt: "",
  attachments: [],
  sessionLoading: false,
  sessionRef: { cwd: undefined, id: undefined },
}));

// ── 选择器 hooks ──

/** shell 域选择器订阅（返回引用必须稳定——直接取 state 字段） */
export function useShell<S>(selector: (state: ShellState) => S): S {
  return useSyncExternalStore(shellStore.subscribe, () => selector(shellStore.get()));
}

/** session 域选择器订阅 */
export function useSession<S>(selector: (state: SessionState) => S): S {
  return useSyncExternalStore(sessionStore.subscribe, () => selector(sessionStore.get()));
}

// ── 全局 tool 级状态（模块级 ref 语义） ──

/** Toast 序列号 */
let toastSeq = 0;

/** 显示 Toast 通知，4.5 秒后自动消失 */
export function toast(message: string, level: Toast["level"] = "info"): void {
  const id = ++toastSeq;
  shellStore.set((prev) => ({ toasts: [...prev.toasts, { id, message, level }] }));
  setTimeout(
    () => shellStore.set((prev) => ({ toasts: prev.toasts.filter((t) => t.id !== id) })),
    4500,
  );
}

/** 时间线缓存（离线回退 + 会话切换保留）；按 cwd + id 键 */
export const timelineCache: Record<string, TimelineItem[]> = {};

export function rememberTimeline(cwd: string | undefined, id: string | undefined, items: TimelineItem[]) {
  const key = sessionKey(cwd, id);
  if (key) timelineCache[key] = items;
}

// ── 全局 mutable refs（模块级，跨 actions/events 共享） ──

/** 正在流式输出的文本（动作/事件共用） */
export const streamingRef = { current: "" };
/** 正在流式输出的思考内容（thinking_delta 累积，message_end 并入条目） */
export const streamingThinkingRef = { current: "" };
/** 思考开始时间戳（流式时长统计；0 表示未在思考） */
export const streamingThinkingStartRef = { current: 0 };
/** 选择文件夹弹窗进行中（防重复触发） */
export const pickingFolderRef = { current: false };
/** 侧栏动画定时器句柄 */
export const sidebarAnimTimer = { current: undefined as number | undefined };
