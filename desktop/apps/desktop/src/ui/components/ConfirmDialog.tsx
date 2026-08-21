/**
 * 确认弹窗：基于 Dialog 的确认/取消二选一，替代原生 confirm()。
 *
 * 用法：调用方持有 pending 状态（如待删除项），确认后在 onConfirm 中执行动作。
 * variant=danger 时确认按钮为红色（删除等破坏性操作）。
 */
import { AlertTriangle, HelpCircle, Info } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./Button.tsx";
import { Dialog } from "./Dialog.tsx";

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  /** 正文说明（支持换行） */
  message: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  /** danger 红色确认 / warning 橙色确认 / info 常规 */
  variant?: "info" | "warning" | "danger";
  /** 确认按钮是否处于执行中（防重复点击） */
  busy?: boolean;
};

const ICONS = {
  info: Info,
  warning: AlertTriangle,
  danger: AlertTriangle,
} as const;

export function ConfirmDialog(props: ConfirmDialogProps) {
  const {
    open,
    title,
    message,
    onConfirm,
    onCancel,
    confirmText = "确定",
    cancelText = "取消",
    variant = "info",
    busy = false,
  } = props;
  const Icon = ICONS[variant];

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onCancel}
      size="sm"
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            {cancelText}
          </Button>
          <Button variant={variant === "danger" ? "danger" : "primary"} disabled={busy} onClick={onConfirm}>
            {busy ? "处理中…" : confirmText}
          </Button>
        </>
      }
    >
      <div className="ui-confirm">
        <span className={`ui-confirm__icon ui-confirm__icon--${variant}`}>
          <Icon size={18} strokeWidth={2} />
        </span>
        <div>
          <h3 className="ui-confirm__title">{title}</h3>
          <div className="ui-confirm__message">{message}</div>
        </div>
      </div>
    </Dialog>
  );
}
