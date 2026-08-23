/**
 * 壳视图注册表
 *
 * 壳层（侧栏底部菜单 / 顶栏标题 / 视图切换）由本注册表驱动：
 * - 内置视图在此静态注册；
 * - M4 起，扩展 manifest 的 contributes.ui 经运行时注册 API
 *   挂入同一张表（见 docs/http-and-plugin-roadmap.md）。
 *
 * 注册表只描述元数据（id/label/icon/order）；视图组件的渲染与
 * 打开副作用仍由 App 壳持有，避免为了抽象而搬运大 props。
 */
import { BarChart3, BookOpen, Boxes, MessagesSquare, Puzzle, Settings, Terminal, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ShellView } from "../types.ts";

export type ShellViewDef = {
  id: ShellView;
  /** 顶栏标题与菜单文案 */
  label: string;
  icon: LucideIcon;
  /** 菜单排序（小者靠前；chat 不进菜单） */
  order: number;
  /** 是否出现在侧栏底部菜单 */
  inMenu?: boolean;
  /** 常驻挂载（不随切换卸载）：chat 保留滚动位置与输入草稿 */
  persistent?: boolean;
};

export const SHELL_VIEWS: ShellViewDef[] = [
  { id: "chat", label: "对话", icon: MessagesSquare, order: 0, persistent: true, inMenu: false },
  { id: "extensions", label: "扩展", icon: Boxes, order: 10, inMenu: true },
  { id: "settings", label: "设置", icon: Settings, order: 20, inMenu: true },
];

// —— 运行时注册（M4：插件 UI 贡献挂载点） ——

/** 运行时注册的视图（重载扩展时整体重挂） */
const runtimeViews = new Map<string, ShellViewDef>();

/** 注册运行时视图：与内置 id 冲突或重复注册时忽略（内置优先） */
export function registerRuntimeView(def: ShellViewDef): void {
  if (SHELL_VIEWS.some((view) => view.id === def.id) || runtimeViews.has(def.id)) return;
  runtimeViews.set(def.id, def);
}

/** 清空运行时视图（扩展重载后重建） */
export function clearRuntimeViews(): void {
  runtimeViews.clear();
}

/** 插件图标白名单：贡献声明的 icon 名 → lucide 组件，未知回退拼图 */
const PLUGIN_ICONS: Record<string, LucideIcon> = {
  puzzle: Puzzle,
  terminal: Terminal,
  book: BookOpen,
  wrench: Wrench,
  chart: BarChart3,
};

export function pluginIcon(name?: string): LucideIcon {
  return (name && PLUGIN_ICONS[name]) || Puzzle;
}

function allViews(): ShellViewDef[] {
  return [...SHELL_VIEWS, ...runtimeViews.values()];
}

/** 侧栏底部菜单项（inMenu 且按 order 排序；内置在前） */
export function menuViews(): ShellViewDef[] {
  return allViews()
    .filter((view) => view.inMenu)
    .sort((a, b) => a.order - b.order);
}

/** 顶栏标题（chat 由 App 用会话标题覆盖） */
export function viewLabel(id: ShellView): string {
  return allViews().find((view) => view.id === id)?.label ?? id;
}
