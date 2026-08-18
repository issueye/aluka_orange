import type { TextareaHTMLAttributes } from "react";
import { Field } from "./Field.tsx";

export type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  hint?: string;
};

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

  if (!label && !hint) return field;

  return (
    <Field label={label} hint={hint}>
      {field}
    </Field>
  );
}
