/**
 * 通用弹窗基座：统一替代原生 alert/confirm 与散落的 .modal 结构。
 *
 * - 遮罩点击 / ESC 关闭（可通过 closeOnBackdrop / closeOnEsc 关闭该行为）
 * - 打开时焦点移入卡片，支持多尺寸档位
 * - 表单场景：children 直接放 <form className="ui-dialog__form">，动作按钮在表单内
 */
import { useEffect, useRef, type ReactNode } from "react";

export type DialogProps = {
  open: boolean;
  title?: ReactNode;
  /** 卡片主体（文本 / 表单控件 / 列表） */
  children: ReactNode;
  /** 底部动作区（按钮组）；表单提交场景可省略并在 children 内自带的 form 中放置 */
  footer?: ReactNode;
  /** 请求关闭（遮罩点击 / ESC）。破坏性操作可不传以强制显式选择 */
  onClose?: () => void;
  /** 点击遮罩是否关闭（默认开启） */
  closeOnBackdrop?: boolean;
  /** ESC 是否关闭（默认开启） */
  closeOnEsc?: boolean;
  /** 卡片宽度档位：sm 400 / md 480 / lg 640 */
  size?: "sm" | "md" | "lg";
  /** 追加到卡片的类名（如 model-pick-card） */
  cardClassName?: string;
};

export function Dialog(props: DialogProps) {
  const {
    open,
    title,
    children,
    footer,
    onClose,
    closeOnBackdrop = true,
    closeOnEsc = true,
    size = "sm",
    cardClassName = "",
  } = props;
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    cardRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && closeOnEsc) onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeOnEsc, onClose]);

  if (!open) return null;

  return (
    <div className="ui-dialog" data-aluka-drag="no-drag">
      <div
        className="ui-dialog__backdrop"
        onClick={() => {
          if (closeOnBackdrop) onClose?.();
        }}
      />
      <div
        ref={cardRef}
        className={`ui-dialog__card ui-dialog__card--${size} ${cardClassName}`.trim()}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        {title != null && title !== "" ? (
          <h3 className="ui-dialog__title">{title}</h3>
        ) : null}
        <div className="ui-dialog__body">{children}</div>
        {footer ? <div className="ui-dialog__footer">{footer}</div> : null}
      </div>
    </div>
  );
}
