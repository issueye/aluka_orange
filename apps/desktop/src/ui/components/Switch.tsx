import { HintTooltip } from "./HintTooltip.tsx";

export type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  hint?: string;
  className?: string;
  id?: string;
};

export function Switch({
  checked,
  onChange,
  disabled = false,
  label,
  hint,
  className = "",
  id,
}: SwitchProps) {
  const control = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={[
        "ui-switch",
        checked ? "is-on" : "",
        disabled ? "is-disabled" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
    >
      <span className="ui-switch__thumb" />
    </button>
  );

  if (!label && !hint) return control;

  return (
    <div className="ui-switch-row">
      <div className="ui-switch-row__text">
        <div className="ui-field__head">
          {label ? <div className="ui-switch-row__label">{label}</div> : null}
          {hint ? <HintTooltip content={hint} /> : null}
        </div>
      </div>
      {control}
    </div>
  );
}
