import type { ButtonHTMLAttributes, ReactNode } from "react";

/** 按钮样式变体 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
/** 按钮尺寸 */
export type ButtonSize = "sm" | "md";

/** Button 组件属性类型 */
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** 样式变体，默认 primary */
  variant?: ButtonVariant;
  /** 尺寸，默认 md */
  size?: ButtonSize;
  children?: ReactNode;
};

/**
 * 通用按钮组件
 * 支持 4 种样式变体（primary/secondary/ghost/danger）和 2 种尺寸（sm/md）。
 */
export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={["ui-btn", `ui-btn--${variant}`, `ui-btn--${size}`, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}
