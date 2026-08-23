/**
 * 组件档渲染容器（PluginScan）
 *
 * 渲染层不执行插件 JS：主进程 SSR 的 HTML 片段经 pluginUiRender 发起、
 * pluginui.render 事件回传（GUI 桥不 await Promise——RPC 仅发起，结果走事件，
 * 浏览器/窗口双通道一致）；[data-aluka-action] 点击经 pluginUiAction 发起、
 * pluginui.action 回传，收到新片段后整块替换。
 * 首次渲染失败自动重试（SSR 服务懒启动竞态兜底）。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { bridge, rpc } from "../bridge.ts";
import type { UiContributionV2 } from "@aluka/shell-contracts";

type UiEvent = {
  contributionId?: string;
  name?: string;
  ok?: boolean;
  html?: string;
  error?: string;
};

const RETRY_DELAY_MS = 2500;
const MAX_RETRIES = 2;
const EVENT_TIMEOUT_MS = 8000;

/**
 * fallback：组件档不可用时（如编译版无 Node SSR 服务）回退的宿主模板渲染
 * （如 T0 数据卡），保证槽位不出现红字空窗。
 */
export function PluginScan({
  contribution,
  fallback,
}: {
  contribution: UiContributionV2;
  fallback?: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const retriesRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const bus = bridge().events;
    let timeoutId: number | undefined;

    const fail = (message?: string) => {
      if (cancelled) return;
      if (retriesRef.current < MAX_RETRIES) {
        retriesRef.current += 1;
        window.setTimeout(() => {
          void rpc("pluginUiRender", { contributionId: contribution.id }).catch(() => undefined);
        }, RETRY_DELAY_MS);
        return;
      }
      setError(message ?? "render failed（无错误详情）");
    };

    const onRender = (raw: unknown) => {
      const event = raw as UiEvent;
      if (event?.contributionId !== contribution.id) return;
      if (cancelled) return;
      window.clearTimeout(timeoutId);
      if (event.ok && event.html !== undefined) {
        setHtml(event.html);
        setError(undefined);
      } else {
        fail(event.error ?? "render failed");
      }
    };

    const onAction = (raw: unknown) => {
      const event = raw as UiEvent;
      if (event?.contributionId !== contribution.id) return;
      if (cancelled) return;
      if (event.ok && event.html !== undefined) {
        setHtml(event.html);
        setError(undefined);
      } else if (!event.ok && event.error) {
        setError(event.error);
      }
    };

    bus.on("pluginui.render", onRender);
    bus.on("pluginui.action", onAction);
    void rpc("pluginUiRender", { contributionId: contribution.id }).catch((err) =>
      fail(err instanceof Error ? err.message : String(err)),
    );
    timeoutId = window.setTimeout(() => fail("render 超时（8s）"), EVENT_TIMEOUT_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      bus.off("pluginui.render", onRender);
      bus.off("pluginui.action", onAction);
      void rpc("pluginUiUnload", { contributionId: contribution.id }).catch(() => undefined);
    };
  }, [contribution.id]);

  /** 事件委托：data-aluka-action → pluginUiAction（结果经 pluginui.action 事件回传） */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement | null)?.closest?.(
        "[data-aluka-action]",
      );
      if (!target) return;
      const name = target.getAttribute("data-aluka-action");
      if (!name) return;
      const rawPayload = target.getAttribute("data-aluka-payload");
      let payload: unknown;
      if (rawPayload) {
        try {
          payload = JSON.parse(rawPayload);
        } catch {
          /* 非法 payload 忽略 */
        }
      }
      void rpc("pluginUiAction", {
        contributionId: contribution.id,
        name,
        payload,
      }).catch((err) => setError(err instanceof Error ? err.message : String(err)));
    };
    container.addEventListener("click", onClick);
    return () => container.removeEventListener("click", onClick);
  }, [contribution.id]);

  return (
    <div ref={containerRef} className="aluka-plugin-scan">
      {html !== undefined ? <div dangerouslySetInnerHTML={{ __html: html }} /> : null}
      {html === undefined && error ? (
        <div className="aluka-plugin-scan__fallback">
          {fallback ?? <div className="aluka-plugin-scan__error">{error}</div>}
          <div className="aluka-plugin-scan__hint">组件档不可用，已回退宿主模板（{error}）</div>
        </div>
      ) : null}
      {html === undefined && !error ? (
        <div className="aluka-plugin-scan__loading">组件加载中…</div>
      ) : null}
    </div>
  );
}
