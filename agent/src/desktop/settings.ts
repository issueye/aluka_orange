/**
 * 桌面 / Host 用持久化设置（~/.aluka/agent/settings.json）
 * API key 可写入文件；桌面 UI 不应把明文回传到日志事件。
 *
 * 扩展路径双写：`extraExtensions`（桌面）与 `extensions`（与 loader / pi 约定对齐）。
 */

import fs from "node:fs";
import path from "node:path";
import type { ThinkingLevel } from "../ai/types.ts";
import { getAgentDir } from "../config.ts";
import { hasRuntimeApiKey, resolveRuntimeModel } from "../models.ts";

const THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh"]);

export type ThemeId = "dark" | "light";

/** 侧栏宽度允许范围（px）；越界值加载/保存时被钳制 */
export const SIDEBAR_WIDTH_MIN = 220;
export const SIDEBAR_WIDTH_MAX = 480;
export const SIDEBAR_WIDTH_DEFAULT = 288;

/** 钳制侧栏宽度到允许范围；非法值回退默认 */
function clampSidebarWidth(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : SIDEBAR_WIDTH_DEFAULT;
  return Math.round(Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, n)));
}

export interface DesktopSettings {
  model?: string;
  provider?: string;
  baseUrl?: string;
  /** 可选；优先于环境变量（仅本机文件） */
  apiKey?: string;
  cwd?: string;
  lastSessionId?: string;
  /** 已知工作区路径（侧栏分组） */
  workspaces?: string[];
  /** UI 主题 */
  theme?: ThemeId;
  /** 思考深度（默认 off） */
  thinkingLevel?: ThinkingLevel;
  /** 额外扩展路径（绝对或相对 cwd） */
  extraExtensions?: string[];
  /** 侧栏宽度（px，220–480）；UI 外观设置写入 */
  sidebarWidth?: number;
}

/** 落盘形态：含 pi 兼容的 extensions[] */
type SettingsFile = DesktopSettings & { extensions?: string[] };

export function settingsPath(agentDir = getAgentDir()): string {
  return path.join(agentDir, "settings.json");
}

function normalizeLoaded(raw: SettingsFile): DesktopSettings {
  const { extensions, ...rest } = raw;
  const extra = rest.extraExtensions ?? extensions;
  const out: DesktopSettings = { ...rest };
  if (Array.isArray(extra) && extra.length > 0) {
    out.extraExtensions = [...new Set(extra.map(String))];
  } else {
    delete out.extraExtensions;
  }
  if (out.theme !== "dark" && out.theme !== "light") {
    delete out.theme;
  }
  if (out.thinkingLevel && !THINKING_LEVELS.has(out.thinkingLevel)) {
    delete out.thinkingLevel;
  }
  if (out.sidebarWidth !== undefined) {
    const clamped = clampSidebarWidth(out.sidebarWidth);
    // 默认值不落盘，保持 settings.json 精简
    if (clamped === SIDEBAR_WIDTH_DEFAULT) delete out.sidebarWidth;
    else out.sidebarWidth = clamped;
  }
  if (Array.isArray(out.workspaces)) {
    const dirs = out.workspaces.map(String).map((p) => p.trim()).filter(Boolean);
    if (dirs.length) out.workspaces = [...new Set(dirs)];
    else delete out.workspaces;
  }
  return out;
}

export function loadSettings(agentDir = getAgentDir()): DesktopSettings {
  const file = settingsPath(agentDir);
  if (!fs.existsSync(file)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as SettingsFile;
    return raw && typeof raw === "object" ? normalizeLoaded(raw) : {};
  } catch {
    return {};
  }
}

export function saveSettings(patch: DesktopSettings, agentDir = getAgentDir()): DesktopSettings {
  const next = normalizeLoaded({ ...loadSettings(agentDir), ...patch });
  for (const key of Object.keys(next) as (keyof DesktopSettings)[]) {
    const v = next[key];
    if (v === undefined || v === "") delete next[key];
    if (Array.isArray(v) && v.length === 0) delete next[key];
  }
  const filePayload: SettingsFile = { ...next };
  if (next.extraExtensions?.length) {
    filePayload.extensions = [...next.extraExtensions];
  }
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(settingsPath(agentDir), `${JSON.stringify(filePayload, null, 2)}\n`, { mode: 0o600 });
  return next;
}

/** 给 UI 的视图：永不包含 apiKey 明文；hasApiKey 含 models.json / 环境变量 */
export function settingsView(
  settings: DesktopSettings,
  agentDir = getAgentDir(),
): Omit<DesktopSettings, "apiKey"> & { hasApiKey: boolean } {
  const { apiKey, ...rest } = settings;
  const { model } = resolveRuntimeModel({ agentDir, settings: rest });
  return {
    ...rest,
    hasApiKey: hasRuntimeApiKey({
      agentDir,
      model,
      settingsApiKey: apiKey,
    }),
  };
}

/** 规范化本地包路径列表（去重、trim） */
export function normalizePackagePaths(paths: string[], cwd: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of paths) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const resolved = path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.resolve(cwd, trimmed);
    const key = resolved.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolved);
  }
  return out;
}
