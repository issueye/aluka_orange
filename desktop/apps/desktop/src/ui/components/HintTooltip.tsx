import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleAlert } from "lucide-react";

export type HintTooltipProps = {
  content: string;
  /** 无障碍名称，默认「说明」 */
  label?: string;
};

type TipStyle = {
  top: number;
  left: number;
  placement: "top" | "bottom";
};

function placeTip(anchor: HTMLElement, tip: HTMLElement): TipStyle {
  const pad = 8;
  const gap = 8;
  const rect = anchor.getBoundingClientRect();
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  const spaceAbove = rect.top - pad;
  const preferTop = spaceAbove >= th + gap || spaceAbove >= window.innerHeight - rect.bottom;
  const placement: TipStyle["placement"] = preferTop ? "top" : "bottom";
  const top = preferTop ? rect.top - th - gap : rect.bottom + gap;
  let left = rect.left + rect.width / 2 - tw / 2;
  left = Math.min(Math.max(pad, left), window.innerWidth - tw - pad);
  return { top, left, placement };
}

/**
 * 字段 / 区块说明：感叹号图标 + 悬浮 tooltip。
 * 交互：悬停、键盘聚焦、点击固定，Esc / 点击外部关闭。
 */
export function HintTooltip({ content, label = "说明" }: HintTooltipProps) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [present, setPresent] = useState(false);
  const [visible, setVisible] = useState(false);
  const [style, setStyle] = useState<TipStyle | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const showTimer = useRef(0);
  const hideTimer = useRef(0);
  const tipId = useId();

  const clearTimers = useCallback(() => {
    window.clearTimeout(showTimer.current);
    window.clearTimeout(hideTimer.current);
  }, []);

  const close = useCallback(() => {
    clearTimers();
    setPinned(false);
    setOpen(false);
  }, [clearTimers]);

  function show() {
    clearTimers();
    showTimer.current = window.setTimeout(() => setOpen(true), 80);
  }

  function scheduleHide() {
    if (pinned) return;
    clearTimers();
    hideTimer.current = window.setTimeout(() => setOpen(false), 100);
  }

  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    setVisible(false);
    const t = window.setTimeout(() => setPresent(false), 160);
    return () => window.clearTimeout(t);
  }, [open]);

  useLayoutEffect(() => {
    if (!present || !btnRef.current || !tipRef.current) {
      setStyle(null);
      return;
    }
    const update = () => {
      if (!btnRef.current || !tipRef.current) return;
      setStyle(placeTip(btnRef.current, tipRef.current));
    };
    update();
    const raf = requestAnimationFrame(() => {
      update();
      if (open) setVisible(true);
    });
    window.addEventListener("resize", update);
    window.addEventListener("scroll", close, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", close, true);
    };
  }, [present, content, open, close]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    function onPointer(event: MouseEvent) {
      const target = event.target as Node;
      if (btnRef.current?.contains(target)) return;
      if (tipRef.current?.contains(target)) return;
      close();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open, close]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const tooltip =
    present && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={tipRef}
            id={tipId}
            role="tooltip"
            className={[
              "ui-tooltip",
              visible ? "is-open" : "",
              style ? `is-${style.placement}` : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={
              style
                ? { top: style.top, left: style.left }
                : { top: 0, left: 0, visibility: "hidden" }
            }
          >
            {content}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={["ui-hint", open ? "is-open" : "", pinned ? "is-pinned" : ""]
          .filter(Boolean)
          .join(" ")}
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
        onFocus={show}
        onBlur={scheduleHide}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          clearTimers();
          if (pinned) {
            setPinned(false);
          } else {
            setPinned(true);
            setOpen(true);
          }
        }}
      >
        <CircleAlert size={14} strokeWidth={2} />
      </button>
      {tooltip}
    </>
  );
}
