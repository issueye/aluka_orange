/**
 * 壳层启动时序
 *
 * 等待 Host 就绪 → 拉取活跃会话/时间线/列表/设置/用量 → 发 ui-ready，
 * 闪屏最短展示 MIN_SPLASH_MS 后淡出（数据失败也放行，只做状态提示）。
 */
import { useEffect } from "react";
import { bridge, rpc } from "../bridge.ts";
import { waitHostRuntime } from "../lib/utils.ts";
import { fetchHostTimeline, loadSettings, refreshSessions, refreshUsage } from "./actions.ts";
import { rememberTimeline, sessionStore, shellStore, toast } from "./store.ts";

/** 启动闪屏最短展示时长（数据就绪后再补足该时长，避免闪屏一闪而过） */
export const MIN_SPLASH_MS = 1600;

export function useStartup(): void {
  useEffect(() => {
    let cancelled = false;
    const splashStartedAt = Date.now();
    /** React 闪屏挂载后即可移除 index.html 里的静态启动屏（避免双重叠加） */
    document.getElementById("boot-splash")?.remove();
    const finishSplash = () => {
      if (cancelled) return;
      const remain = Math.max(0, MIN_SPLASH_MS - (Date.now() - splashStartedAt));
      window.setTimeout(() => {
        if (cancelled) return;
        shellStore.set({ booted: true }); // 触发闪屏淡出过渡
        window.setTimeout(() => shellStore.set({ splash: false }), 420); // 过渡结束后卸载
      }, remain);
    };
    void (async () => {
      try {
        const info = await waitHostRuntime();
        if (cancelled) return;
        shellStore.set({ splashStatus: "加载会话与设置…" });
        const idle = `v${info.productVersion} · 阶段 ${info.phase} · ${info.platform}`;
        shellStore.set({ idleStatus: idle, status: idle });
        shellStore.set({ about: `Aluka Desktop ${info.productVersion} · 阶段 ${info.phase}` });
        const active = await rpc<{ id?: string; cwd?: string }>("getActiveSessionId");
        const activeId = active?.id || undefined;
        sessionStore.set({
          activeId,
          sessionRef: { cwd: active?.cwd, id: activeId },
        });
        if (active?.cwd) {
          shellStore.set((prev) => ({ settings: { ...prev.settings, cwd: active.cwd } }));
        }
        if (activeId) {
          const items = await fetchHostTimeline(active.cwd, activeId);
          rememberTimeline(active.cwd, activeId, items);
          sessionStore.set({ timeline: items });
        }
        await refreshSessions();
        await loadSettings();
        await refreshUsage(activeId);
        bridge().events.emit("ui-ready", {
          at: Date.now(),
          phase: 5,
          ui: "zeno-react",
        });
      } catch (err) {
        shellStore.set({ status: err instanceof Error ? err.message : String(err) });
        toast(String(err), "error");
      }
      finishSplash();
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}
