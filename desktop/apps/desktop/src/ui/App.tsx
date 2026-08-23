/**
 * Aluka Desktop 主应用组件（壳）
 *
 * R3 起为纯装配层：挂载启动时序/事件路由，组合 chrome 铬片（shell/chrome.tsx）。
 * 状态与业务逻辑在 shell/（store/actions/events/init/context-keys/slots）。
 */
import { useEffect } from "react";
import { WindowResizeHandle } from "./WindowResizeHandle.tsx";
import { registerRuntimeView, clearRuntimeViews, pluginIcon } from "./shell/registry.ts";
import {
  DialogHost,
  ShellMain,
  ShellSidebar,
  SplashHost,
  ToastHost,
} from "./shell/chrome.tsx";
import { loadUiContributions } from "./shell/actions.ts";
import { attachRuntimeEvents } from "./shell/events.ts";
import { useStartup } from "./shell/init.ts";
import { shellStore, sidebarAnimTimer, useShell } from "./shell/store.ts";
import "./components/ui.css";
import "./styles.css";
import "./styles/plugins.css";
import "../main/plugin-ui-kit.css";

export function App() {
  // ── 启动时序与事件路由 ──
  useStartup();
  useEffect(() => attachRuntimeEvents(), []);
  useEffect(() => () => window.clearTimeout(sidebarAnimTimer.current), []);

  const settings = useShell((s) => s.settings);
  const uiContributions = useShell((s) => s.uiContributions);
  const disabledContributions = useShell((s) => s.disabledContributions);
  const view = useShell((s) => s.view);
  const sidebarCollapsed = useShell((s) => s.sidebarCollapsed);
  const sidebarAnimating = useShell((s) => s.sidebarAnimating);
  const theme = settings.theme === "light" ? "light" : "dark";

  /** 侧栏宽度：设置里的数值即时写入 CSS 变量（未设置时移除，回落样式表默认 288px） */
  useEffect(() => {
    const w = settings.sidebarWidth;
    if (typeof w === "number" && Number.isFinite(w)) {
      document.documentElement.style.setProperty("--sidebar-width", `${Math.round(w)}px`);
    } else {
      document.documentElement.style.removeProperty("--sidebar-width");
    }
  }, [settings.sidebarWidth]);

  /** M4：拉取扩展声明的 UI 贡献（挂载 + 扩展重载后刷新），告警以 Toast 播报 */
  useEffect(() => {
    void loadUiContributions();
  }, []);

  useEffect(() => {
    const onReloaded = () => void loadUiContributions();
    window.addEventListener("aluka:extensions-reloaded", onReloaded);
    return () => window.removeEventListener("aluka:extensions-reloaded", onReloaded);
  }, []);

  /** 贡献 → 运行时视图注册表同步；当前停留的插件面板消失时回到对话 */
  useEffect(() => {
    clearRuntimeViews();
    uiContributions.forEach((contribution, index) => {
      // 仅面板类贡献（v1 或 v2 view.registry）注册侧栏菜单；
      // 其余 v2 槽位贡献（statusbar/chat.*/sidebar.*/header.actions）由 SlotOutlet 渲染。
      if (contribution.version === 2 && contribution.slot !== "view.registry") return;
      if (disabledContributions.includes(contribution.id)) return;
      registerRuntimeView({
        id: `plugin:${contribution.id}`,
        label: contribution.title,
        icon: pluginIcon(contribution.icon),
        order: 1000 + index,
        inMenu: true,
      });
    });
    shellStore.set((prev) => {
      if (
        typeof prev.view === "string"
        && prev.view.startsWith("plugin:")
        && !uiContributions.some((contribution) => `plugin:${contribution.id}` === prev.view)
      ) {
        return { view: "chat" };
      }
      return {};
    });
  }, [uiContributions, disabledContributions]);

  return (
    <div
      className={`app-shell ${view !== "chat" ? "settings-open" : ""} ${view !== "chat" ? "settings-mode" : ""} ${sidebarCollapsed && view === "chat" ? "sidebar-collapsed" : ""} ${sidebarAnimating ? "sidebar-animating" : ""}`}
      data-theme={theme}
    >
      <ShellSidebar />
      <ShellMain />
      <WindowResizeHandle />
      <ToastHost />
      <DialogHost />
      <SplashHost />
    </div>
  );
}
