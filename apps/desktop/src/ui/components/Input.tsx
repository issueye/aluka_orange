import type { InputHTMLAttributes } from "react";
import { Field } from "./Field.tsx";

/**
 * Input 组件属性类型
 * 包装原生 input，提供 label/hint/status 等表单辅助能力。
 */
export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "size"> & {
  /** 输入值（受控模式） */
  value: string;
  /** 值变更回调，直接返回字符串而非事件对象 */
  onChange: (value: string) => void;
  /** 字段标签 */
  label?: string;
  /** 说明提示文字（显示在感叹号 tooltip 中） */
  hint?: string;
  /** 运行状态文本（显示在字段下方） */
  status?: string;
};

/**
 * 通用文本输入框组件
 * 支持 label、hint tooltip、status 状态显示。
 */
export function Input({
  label,
  hint,
  status,
  className = "",
  value,
  onChange,
  type = "text",
  ...rest
}: InputProps) {
  const field = (
    <input
      type={type}
      className={["ui-input", className].filter(Boolean).join(" ")}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      {...rest}
    />
  );

  // 无 label/hint/status 时直接渲染 input，减少 DOM 嵌套
  if (!label && !hint && !status) return field;

  return (
    <Field label={label} hint={hint} status={status}>
      {field}
    </Field>
  );
}
