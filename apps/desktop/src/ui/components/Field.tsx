import type { ReactNode } from "react";
import { HintTooltip } from "./HintTooltip.tsx";

export type FieldProps = {
  label?: string;
  /** 说明文案，显示在标题旁的感叹号 tooltip 中 */
  hint?: string;
  /** 运行状态（可见文本，不是说明） */
  status?: string;
  children: ReactNode;
  className?: string;
};

/**
 * 表单字段外壳：标签 + 感叹号说明 + 控件 + 可选状态。
 */
export function Field({ label, hint, status, children, className = "" }: FieldProps) {
  if (!label && !hint && !status) return children;

  return (
    <div className={["ui-field", className].filter(Boolean).join(" ")}>
      {label || hint ? (
        <div className="ui-field__head">
          {label ? <span className="ui-field__label">{label}</span> : null}
          {hint ? <HintTooltip content={hint} /> : null}
        </div>
      ) : null}
      {children}
      {status ? <div className="ui-field__status">{status}</div> : null}
    </div>
  );
}

export type SectionHeadProps = {
  title: string;
  hint?: string;
  as?: "h2" | "h3";
};

/**
 * 设置页 / 卡片区块标题：标题 + 感叹号说明。
 */
export function SectionHead({ title, hint, as: Tag = "h2" }: SectionHeadProps) {
  return (
    <div className="ui-section-head">
      <Tag className="ui-section-head__title">{title}</Tag>
      {hint ? <HintTooltip content={hint} /> : null}
    </div>
  );
}
