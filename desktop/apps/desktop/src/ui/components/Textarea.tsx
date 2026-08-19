import type { TextareaHTMLAttributes } from "react";
import { Field } from "./Field.tsx";

/**
 * Textarea 组件属性类型
 * 包装原生 textarea，提供 label/hint 等表单辅助能力。
 */
export type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> & {
  /** 输入值（受控模式） */
  value: string;
  /** 值变更回调，直接返回字符串 */
  onChange: (value: string) => void;
  /** 字段标签 */
  label?: string;
  /** 说明提示文字 */
  hint?: string;
};

/**
 * 通用多行文本输入框组件
 * 支持 label 和 hint tooltip。
 */
export function Textarea({
  label,
  hint,
  className = "",
  value,
  onChange,
  ...rest
}: TextareaProps) {
  const field = (
    <textarea
      className={["ui-textarea", className].filter(Boolean).join(" ")}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      {...rest}
    />
  );

  // 无 label/hint 时直接渲染 textarea
  if (!label && !hint) return field;

  return (
    <Field label={label} hint={hint}>
      {field}
    </Field>
  );
}
