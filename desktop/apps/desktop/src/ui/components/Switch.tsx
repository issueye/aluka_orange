import { HintTooltip } from "./HintTooltip.tsx";

/** Switch 开关组件属性类型 */
export type SwitchProps = {
  /** 是否开启 */
  checked: boolean;
  /** 状态变更回调 */
  onChange: (checked: boolean) => void;
  /** 是否禁用 */
  disabled?: boolean;
  /** 左侧标签文字 */
  label?: string;
  /** 说明提示文字 */
  hint?: string;
  /** 额外 CSS 类名 */
  className?: string;
  /** 原生 id 属性 */
  id?: string;
};

/**
 * 通用开关切换组件
 * 遵循 WAI-ARIA switch 语义，支持无障碍访问。
 */
export function Switch({
  checked,
  onChange,
  disabled = false,
  label,
  hint,
  className = "",
  id,
}: SwitchProps) {
  // 开关控件本体
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

  // 无 label/hint 时仅渲染开关控件
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
