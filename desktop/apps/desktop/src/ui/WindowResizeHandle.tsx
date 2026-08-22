/**
 * 无边框窗口右下角拖拽缩放手柄
 *
 * 无边框窗口依赖 host 的边缘热区（6px）调整大小，缺乏可见入口；
 * 本组件在右下角提供一个小手柄：指针按下后按拖动方向调用
 * window.getSize + window.setSize 实时调整窗口尺寸。
 * 旧运行时缺少 setSize 时自动隐藏。
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { bridge } from "./bridge.ts";

/** 窗口最小尺寸（与主进程 createWindow 的 minWidth/minHeight 保持一致） */
const MIN_WINDOW_W = 900;
const MIN_WINDOW_H = 560;

type Size = { width: number; height: number };

/** 兼容两种 getSize 回包：数组 [w, h] 或对象 { width, height } */
function readSize(raw: unknown): Size | undefined {
  if (Array.isArray(raw) && typeof raw[0] === "number" && typeof raw[1] === "number") {
    return { width: raw[0], height: raw[1] };
  }
  if (raw && typeof raw === "object") {
    const rec = raw as { width?: unknown; height?: unknown };
    if (typeof rec.width === "number" && typeof rec.height === "number") {
      return { width: rec.width, height: rec.height };
    }
  }
  return undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function WindowResizeHandle() {
  const [unsupported, setUnsupported] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    dx: number;
    dy: number;
    width: number;
    height: number;
    raf: number;
  } | undefined>(undefined);

  useEffect(() => {
    try {
      if (typeof bridge().window.setSize !== "function") setUnsupported(true);
    } catch {
      setUnsupported(true);
    }
  }, []);

  async function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    const win = bridge().window;
    if (typeof win.setSize !== "function") return;
    // React 合成事件在 await 后 currentTarget 会失效：先取引用与坐标
    const el = e.currentTarget;
    const px = e.clientX;
    const py = e.clientY;
    const pointerId = e.pointerId;
    e.preventDefault();
    const size = readSize(await win.getSize?.());
    if (!size) return;

    try {
      el.setPointerCapture(pointerId);
    } catch {
      // 指针已失效/模拟事件时 setPointerCapture 可能抛错：不影响后续 window 监听
    }
    dragRef.current = {
      startX: px,
      startY: py,
      dx: 0,
      dy: 0,
      width: size.width,
      height: size.height,
      raf: 0,
    };

    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      d.dx = ev.clientX - d.startX;
      d.dy = ev.clientY - d.startY;
      if (d.raf) return;
      d.raf = window.requestAnimationFrame(() => {
        d.raf = 0;
        const width = clamp(Math.round(d.width + d.dx), MIN_WINDOW_W, window.screen.availWidth);
        const height = clamp(Math.round(d.height + d.dy), MIN_WINDOW_H, window.screen.availHeight);
        win.setSize!(width, height);
      });
    };
    const onUp = () => {
      const d = dragRef.current;
      if (d?.raf) window.cancelAnimationFrame(d.raf);
      dragRef.current = undefined;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  if (unsupported) return null;

  return (
    <div
      className="window-resize-handle"
      title="拖动调整窗口大小"
      aria-hidden="true"
      onPointerDown={(e) => void onPointerDown(e)}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M9 2.5 L2.5 9" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        <path d="M9 6.5 L6.5 9" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      </svg>
    </div>
  );
}
