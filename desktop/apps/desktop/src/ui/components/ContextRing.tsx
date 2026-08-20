/**
 * 聊天输入栏下方的上下文占用环：最近一轮 token / 模型窗口。
 */

function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (n >= 1000) {
    const k = n / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}K`;
  }
  return String(Math.max(0, Math.round(n)));
}

export function ContextRing(props: {
  used: number;
  window: number;
}) {
  const windowSize = props.window > 0 ? props.window : 0;
  const used = Math.max(0, props.used);
  const ratio = windowSize > 0 ? Math.min(1, used / windowSize) : 0;
  const percent = Math.round(ratio * 1000) / 10;
  const size = 14;
  const stroke = 1.75;
  const radius = (size - stroke) / 2;
  const mid = size / 2;
  const circ = 2 * Math.PI * radius;
  const offset = circ * (1 - ratio);
  const tone = ratio >= 0.92 ? "is-crit" : ratio >= 0.75 ? "is-warn" : "";
  const label = windowSize
    ? `上下文 ${percent}% · ${formatTokens(used)} / ${formatTokens(windowSize)}`
    : "上下文用量暂无";

  return (
    <span className={`ctx-ring ${tone}`.trim()} title={label} aria-label={label} role="img">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="ctx-ring__track" cx={mid} cy={mid} r={radius} fill="none" strokeWidth={stroke} />
        <circle
          className="ctx-ring__fill"
          cx={mid}
          cy={mid}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${mid} ${mid})`}
        />
      </svg>
    </span>
  );
}
