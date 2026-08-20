/**
 * 用量统计面板（设置 → 模型 → 用量）
 *
 * 全局（跨会话）token 用量：按「供应商 → 模型」聚合输入/输出累计值。
 * 数据经 getUsageStats RPC 读取 ~/.aluka/agent/usage.json（每轮 prompt 后由 agent 自动记录），
 * 面板监听 usage 运行时事件自动刷新；图表为纯 CSS/SVG 手写，不引入图表库。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { bridge, rpc } from "./bridge.ts";
import type { UsageProviderStat, UsageStatsView } from "./types.ts";

/** 供应商配色（深/浅主题下均可读）；供应商数超出后循环取色 */
const PROVIDER_COLORS = [
  "#4f8cff",
  "#3ecf8e",
  "#f0a500",
  "#b57be0",
  "#e0656a",
  "#38b6c4",
  "#d98a4a",
  "#8fbf4d",
];

const INPUT_COLOR = PROVIDER_COLORS[0]!;
const OUTPUT_COLOR = PROVIDER_COLORS[1]!;

function providerColor(index: number): string {
  return PROVIDER_COLORS[index % PROVIDER_COLORS.length]!;
}

/** token 数值紧凑格式：1.2M / 34.5K / 890 */
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

/** 千分位整数（明细表） */
function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** 费用：不足 $0.01 保留 4 位小数，否则 2 位 */
function formatCost(usd?: number): string {
  if (usd === undefined || !Number.isFinite(usd)) return "—";
  return `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`;
}

function formatTime(ts: number): string {
  return ts ? new Date(ts).toLocaleString(undefined, { hour12: false }) : "—";
}

/** 模型用量对比：横向双条（输入/输出），按供应商分组 */
function ModelBars(props: { providers: UsageProviderStat[] }) {
  const max = useMemo(() => {
    let m = 0;
    for (const group of props.providers) {
      for (const row of group.models) m = Math.max(m, row.input, row.output);
    }
    return m || 1;
  }, [props.providers]);

  return (
    <div className="usage-bars">
      {props.providers.map((group, groupIndex) => (
        <div key={group.provider} className="usage-bars-group">
          <p className="usage-bars-group-label">
            <span className="usage-dot" style={{ background: providerColor(groupIndex) }} />
            <span className="truncate">{group.provider}</span>
          </p>
          {group.models.map((row) => (
            <div key={row.model} className="usage-model-row">
              <div className="usage-model-label" title={`${group.provider}/${row.model}`}>
                {row.model}
              </div>
              <div className="usage-model-bars">
                <div className="usage-bar" title={`输入 ${formatCount(row.input)} tokens`}>
                  <div
                    className="usage-bar-fill usage-bar-fill--input"
                    style={{ width: `${Math.max((row.input / max) * 100, row.input > 0 ? 1 : 0)}%` }}
                  />
                  <span className="usage-bar-value">{formatTokens(row.input)}</span>
                </div>
                <div className="usage-bar" title={`输出 ${formatCount(row.output)} tokens`}>
                  <div
                    className="usage-bar-fill usage-bar-fill--output"
                    style={{ width: `${Math.max((row.output / max) * 100, row.output > 0 ? 1 : 0)}%` }}
                  />
                  <span className="usage-bar-value">{formatTokens(row.output)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** 供应商 token 占比环 + 图例 */
function ProviderDonut(props: { providers: UsageProviderStat[]; total: number }) {
  const size = 150;
  const stroke = 16;
  const radius = (size - stroke) / 2;
  const mid = size / 2;
  const circ = 2 * Math.PI * radius;
  let acc = 0;
  const segments = props.providers.map((group, index) => {
    const frac = props.total > 0 ? group.totalTokens / props.total : 0;
    const segment = { provider: group.provider, color: providerColor(index), dash: frac * circ, offset: acc };
    acc += frac;
    return segment;
  });
  const label = props.providers.map((g) => `${g.provider} ${(g.share * 100).toFixed(1)}%`).join("，");

  return (
    <div className="usage-donut">
      <div className="usage-donut-chart" role="img" aria-label={`供应商 token 占比：${label}`}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle className="usage-donut-track" cx={mid} cy={mid} r={radius} fill="none" strokeWidth={stroke} />
          {segments.map((segment) => (
            <circle
              key={segment.provider}
              cx={mid}
              cy={mid}
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth={stroke}
              strokeDasharray={`${segment.dash} ${circ - segment.dash}`}
              strokeDashoffset={-segment.offset}
              transform={`rotate(-90 ${mid} ${mid})`}
            />
          ))}
        </svg>
        <div className="usage-donut-center">
          <strong>{formatTokens(props.total)}</strong>
          <span>tokens</span>
        </div>
      </div>
      <ul className="usage-donut-legend">
        {props.providers.map((group, index) => (
          <li key={group.provider}>
            <span className="usage-dot" style={{ background: providerColor(index) }} />
            <span className="usage-donut-legend-name" title={group.provider}>
              {group.provider}
            </span>
            <span className="usage-donut-legend-value">
              {formatTokens(group.totalTokens)} · {(group.share * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function UsagePanel(props: { reloadKey?: number }) {
  const [stats, setStats] = useState<UsageStatsView | undefined>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const next = await rpc<UsageStatsView>("getUsageStats");
      setStats(next);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, props.reloadKey]);

  // 每轮 prompt 结束（usage 事件）自动刷新全局统计
  useEffect(() => {
    const handler = (raw: unknown) => {
      const event = raw as { type?: string };
      if (event?.type === "usage") void load();
    };
    const bus = bridge().events;
    bus.on("runtime.event", handler);
    return () => bus.off("runtime.event", handler);
  }, [load]);

  const modelCount = useMemo(
    () => (stats?.providers ?? []).reduce((count, group) => count + group.models.length, 0),
    [stats],
  );
  const hasCache = useMemo(
    () => (stats?.providers ?? []).some((group) => group.models.some((row) => row.cacheRead > 0 || row.cacheWrite > 0)),
    [stats],
  );
  const hasData = Boolean(stats && stats.totals.calls > 0);

  if (loading) {
    return (
      <div className="settings-page-sections">
        <p className="settings-meta">正在加载用量统计…</p>
      </div>
    );
  }

  const totals = stats?.totals;
  const cards: Array<{ label: string; value: string; title?: string }> = [
    { label: "输入 Tokens", value: totals ? formatCount(totals.input) : "—" },
    { label: "输出 Tokens", value: totals ? formatCount(totals.output) : "—" },
    { label: "合计 Tokens", value: totals ? formatCount(totals.totalTokens) : "—" },
    { label: "调用次数", value: totals ? formatCount(totals.calls) : "—" },
    {
      label: "预估费用",
      value: formatCost(stats?.estimatedCostUsd),
      title: "按内置厂商目录单价估算；自定义模型可能无单价",
    },
  ];

  return (
    <div className="settings-page-sections">
      <section className="settings-section-block">
        <h2 className="settings-section-label">汇总</h2>
        <div className="settings-card">
          <div className="usage-summary-grid">
            {cards.map((card) => (
              <div key={card.label} className="usage-stat-card" title={card.title}>
                <span className="usage-stat-label">{card.label}</span>
                <span className="usage-stat-value">{card.value}</span>
              </div>
            ))}
          </div>
          <p className="usage-summary-meta">
            {hasData
              ? `自 ${formatTime(stats!.since)} 起累计 · 覆盖 ${stats!.providers.length} 个供应商 / ${modelCount} 个模型 · 更新于 ${formatTime(stats!.updatedAt)}`
              : "暂无累计数据"}
            {" · 记录于 ~/.aluka/agent/usage.json"}
          </p>
        </div>
      </section>

      {hasData ? (
        <>
          <section className="settings-section-block">
            <h2 className="settings-section-label">图表</h2>
            <div className="settings-card usage-chart-card">
              <div className="usage-chart-grid">
                <div className="usage-chart-main">
                  <div className="usage-chart-head">
                    <span>模型用量对比</span>
                    <span className="usage-legend">
                      <i className="usage-dot" style={{ background: INPUT_COLOR }} /> 输入
                      <i className="usage-dot" style={{ background: OUTPUT_COLOR }} /> 输出
                    </span>
                  </div>
                  <ModelBars providers={stats!.providers} />
                </div>
                <div className="usage-chart-side">
                  <div className="usage-chart-head">
                    <span>供应商占比</span>
                  </div>
                  <ProviderDonut providers={stats!.providers} total={stats!.totals.totalTokens} />
                </div>
              </div>
            </div>
          </section>

          <section className="settings-section-block">
            <h2 className="settings-section-label">明细</h2>
            <div className="settings-card usage-table-wrap">
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>供应商 / 模型</th>
                    <th className="num">输入</th>
                    <th className="num">输出</th>
                    {hasCache ? <th className="num">缓存（读/写）</th> : null}
                    <th className="num">合计</th>
                    <th className="num">调用</th>
                    <th className="num">占比</th>
                    <th className="num">预估费用</th>
                    <th>最近使用</th>
                  </tr>
                </thead>
                {stats!.providers.map((group, groupIndex) => (
                  <tbody key={group.provider}>
                    <tr className="usage-table-group">
                      <td colSpan={hasCache ? 9 : 8}>
                        <div className="usage-table-group-cell">
                          <span className="usage-dot" style={{ background: providerColor(groupIndex) }} />
                          <span className="truncate">{group.provider}</span>
                          <span className="usage-table-group-meta">
                            {formatTokens(group.totalTokens)} · {(group.share * 100).toFixed(1)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                    {group.models.map((row) => (
                      <tr key={row.model}>
                        <td className="usage-table-model" title={`${group.provider}/${row.model}`}>
                          {row.model}
                        </td>
                        <td className="num">{formatCount(row.input)}</td>
                        <td className="num">{formatCount(row.output)}</td>
                        {hasCache ? (
                          <td className="num">
                            {formatCount(row.cacheRead)} / {formatCount(row.cacheWrite)}
                          </td>
                        ) : null}
                        <td className="num usage-table-strong">{formatCount(row.totalTokens)}</td>
                        <td className="num">{formatCount(row.calls)}</td>
                        <td className="num">{(row.share * 100).toFixed(1)}%</td>
                        <td className="num" title={row.estimatedCostUsd === undefined ? "该模型无单价信息" : undefined}>
                          {formatCost(row.estimatedCostUsd)}
                        </td>
                        <td className="usage-table-time">{formatTime(row.lastUsedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          </section>
        </>
      ) : (
        <section className="settings-section-block">
          <h2 className="settings-section-label">图表与明细</h2>
          <div className="settings-card">
            <div className="settings-row settings-row-last">
              <div className="settings-row-desc">
                暂无统计数据。发送消息后，每轮模型调用返回的输入/输出 token
                会自动按供应商与模型累计，删除会话不影响统计。
              </div>
            </div>
          </div>
        </section>
      )}

      {error ? <p className="settings-meta">用量统计加载失败：{error}</p> : null}
    </div>
  );
}
