import type { InputHTMLAttributes } from "react";
import { Field } from "./Field.tsx";

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "size"> & {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  hint?: string;
  status?: string;
};

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

  if (!label && !hint && !status) return field;

  return (
    <Field label={label} hint={hint} status={status}>
      {field}
    </Field>
  );
}
