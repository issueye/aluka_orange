/**
 * 代码 diff 展示组件：oldText → newText 的行级差异渲染。
 *
 * - 行级 diff 见 lib/diff；增删行以 +/- 标记与红绿底色区分；
 * - 新旧文本各自整体高亮后按行取用，跨行 token 不被行级拆分破坏；
 * - 长段未变更行折叠为上下 context 行 + 「展开」按钮；
 * - 顶部统计条显示 +新增 / −删除 行数。
 */
import { useMemo, useState, type ReactNode } from "react";
import { UnfoldVertical } from "lucide-react";
import { diffLines, type DiffRow } from "../lib/diff.ts";
import { highlightToLines, resolveLanguage } from "../lib/highlight.ts";

export type DiffViewProps = {
  oldText: string;
  newText: string;
  /** 语言或文件路径 / 扩展名（resolveLanguage 归一化） */
  language?: string;
  /** 折叠未变更行时保留的上下文行数 */
  context?: number;
  maxHeight?: number;
  className?: string;
};

/** 一段被折叠的未变更行（[from, to) 为隐藏区间） */
type DiffGap = { id: number; from: number; to: number; hidden: number };

/** 计算需要折叠的未变更行区间：首尾 run 只保留朝向变更的一侧 */
function computeGaps(rows: DiffRow[], context: number): DiffGap[] {
  const gaps: DiffGap[] = [];
  let runStart = -1;
  for (let index = 0; index <= rows.length; index += 1) {
    const isSame = index < rows.length && rows[index].type === "same";
    if (isSame && runStart < 0) runStart = index;
    if (!isSame && runStart >= 0) {
      const runEnd = index;
      const length = runEnd - runStart;
      if (length > context * 2 + 2) {
        const from = runStart === 0 ? 0 : runStart + context;
        const to = runEnd === rows.length ? runEnd : runEnd - context;
        if (to > from) gaps.push({ id: gaps.length, from, to, hidden: to - from });
      }
      runStart = -1;
    }
  }
  return gaps;
}

export function DiffView({
  oldText,
  newText,
  language,
  context = 3,
  maxHeight = 420,
  className = "",
}: DiffViewProps) {
  const grammar = resolveLanguage(language);
  const rows = useMemo(() => diffLines(oldText, newText), [oldText, newText]);
  // 新旧文本分别整体高亮：del 行取旧表、add/same 行取新表，行号即下标
  const oldHtml = useMemo(() => highlightToLines(oldText, grammar), [oldText, grammar]);
  const newHtml = useMemo(() => highlightToLines(newText, grammar), [newText, grammar]);
  const gaps = useMemo(() => computeGaps(rows, context), [rows, context]);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const adds = rows.reduce((count, row) => count + (row.type === "add" ? 1 : 0), 0);
  const dels = rows.reduce((count, row) => count + (row.type === "del" ? 1 : 0), 0);

  function rowHtml(row: DiffRow): string {
    if (row.type === "add" && row.newLine) return newHtml[row.newLine - 1] ?? "";
    if (row.type === "del" && row.oldLine) return oldHtml[row.oldLine - 1] ?? "";
    if (row.newLine) return newHtml[row.newLine - 1] ?? "";
    if (row.oldLine) return oldHtml[row.oldLine - 1] ?? "";
    return "";
  }

  function renderRow(row: DiffRow, index: number): ReactNode {
    return (
      <div className={`diff-view__row diff-view__row--${row.type}`} key={index}>
        <span className="diff-view__ln">{row.oldLine ?? ""}</span>
        <span className="diff-view__ln">{row.newLine ?? ""}</span>
        <span className="diff-view__sign">{row.type === "add" ? "+" : row.type === "del" ? "−" : ""}</span>
        <code className="diff-view__src" dangerouslySetInnerHTML={{ __html: rowHtml(row) }} />
      </div>
    );
  }

  const body: ReactNode[] = [];
  let cursor = 0;
  for (const gap of gaps) {
    if (expanded[gap.id]) continue;
    for (let index = cursor; index < gap.from; index += 1) body.push(renderRow(rows[index], index));
    const gapId = gap.id;
    body.push(
      <button
        type="button"
        className="diff-view__gap"
        key={`gap-${gapId}`}
        onClick={() => setExpanded((prev) => ({ ...prev, [gapId]: true }))}
      >
        <UnfoldVertical size={12} />
        展开未变更的 {gap.hidden} 行
      </button>,
    );
    cursor = gap.to;
  }
  for (let index = cursor; index < rows.length; index += 1) body.push(renderRow(rows[index], index));

  return (
    <div className={["diff-view", className].filter(Boolean).join(" ")}>
      <div className="diff-view__stats">
        <span className="diff-view__stats-add">+{adds}</span>
        <span className="diff-view__stats-del">−{dels}</span>
        {grammar ? <span className="diff-view__stats-lang">{grammar}</span> : null}
      </div>
      <div
        className="diff-view__body hl"
        style={maxHeight ? { maxHeight: `${maxHeight}px` } : undefined}
      >
        {rows.every((row) => row.type === "same") && rows.length ? (
          <div className="diff-view__empty">内容无变化</div>
        ) : (
          body
        )}
      </div>
    </div>
  );
}
