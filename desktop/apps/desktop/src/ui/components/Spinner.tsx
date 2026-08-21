/**
 * 加载指示组件：
 * - Spinner：SVG 环形旋转，可独立使用（按钮内、列表行内）
 * - LoadingBlock：居中的 Spinner + 说明文字，用于页面 / 分区加载占位
 */
export type SpinnerProps = {
  size?: number;
  /** 描边粗细（默认随尺寸缩放） */
  stroke?: number;
  className?: string;
  label?: string;
};

export function Spinner({ size = 16, stroke, className = "", label = "加载中" }: SpinnerProps) {
  const width = stroke ?? Math.max(1.5, size / 9);
  return (
    <svg
      className={`ui-spinner ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="status"
      aria-label={label}
      fill="none"
    >
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity="0.18" strokeWidth={width} />
      <path
        d="M21.5 12a9.5 9.5 0 0 0-9.5-9.5"
        stroke="currentColor"
        strokeWidth={width}
        strokeLinecap="round"
      />
    </svg>
  );
}

export type LoadingBlockProps = {
  /** 提示文字（如「正在查询插件市场…」） */
  text?: string;
  size?: number;
  className?: string;
};

export function LoadingBlock({ text = "加载中…", size = 20, className = "" }: LoadingBlockProps) {
  return (
    <div className={`ui-loading ${className}`.trim()}>
      <Spinner size={size} label={text} />
      {text ? <span className="ui-loading__text">{text}</span> : null}
    </div>
  );
}
