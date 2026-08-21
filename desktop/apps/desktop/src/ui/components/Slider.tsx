/**
 * 滑杆（range input）组件：外观设置中调节侧栏宽度等数值。
 * 轨道填充进度随取值变化（品牌橙），右侧显示当前值。
 */
export type SliderProps = {
  value: number;
  min: number;
  max: number;
  step?: number;
  /** 数值后缀（如 px） */
  suffix?: string;
  disabled?: boolean;
  /** 数值变化的即时回调（拖动中连续触发） */
  onChange: (value: number) => void;
  /** 松手 / 键盘调节结束回调 */
  onCommit?: (value: number) => void;
  className?: string;
};

export function Slider(props: SliderProps) {
  const { value, min, max, step = 1, suffix = "", disabled, onChange, onCommit, className = "" } = props;
  const percent = max > min ? ((value - min) / (max - min)) * 100 : 0;

  return (
    <div className={`ui-range ${className}`.trim()}>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onKeyUp={() => onCommit?.(value)}
        onMouseUp={() => onCommit?.(value)}
        onTouchEnd={() => onCommit?.(value)}
        style={{
          background: `linear-gradient(90deg, var(--link) ${percent}%, var(--surface-muted) ${percent}%)`,
        }}
      />
      <span className="ui-range__value">
        {value}
        {suffix}
      </span>
    </div>
  );
}
