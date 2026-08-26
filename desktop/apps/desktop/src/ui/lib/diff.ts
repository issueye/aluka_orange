/**
 * 行级 diff（LCS 动态规划）。
 *
 * 输出统一的行序列：same / del（旧内容）/ add（新内容），
 * 每行带 oldLine / newLine 行号（1-based）；连续的增删行会被分组为
 * 「先删后增」，与 unified diff 的呈现习惯一致。
 *
 * 超过规模上限时放弃 LCS，退化为「全部删除 + 全部新增」，
 * 避免超大文本撑爆 DP 表内存。
 */

export type DiffRowType = "same" | "add" | "del";

export type DiffRow = {
  type: DiffRowType;
  text: string;
  /** 旧文件行号（same / del 有值） */
  oldLine?: number;
  /** 新文件行号（same / add 有值） */
  newLine?: number;
};

/** LCS DP 表最大单元格数（约 2000×2000），超过则走降级路径 */
const MAX_LCS_CELLS = 4_000_000;

function toLines(text: string): string[] {
  if (text === "") return [];
  return text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
}

/** 连续变更行分组：先输出全部 del，再输出全部 add */
function groupChanges(rows: DiffRow[]): DiffRow[] {
  const grouped: DiffRow[] = [];
  let index = 0;
  while (index < rows.length) {
    if (rows[index].type === "same") {
      grouped.push(rows[index]);
      index += 1;
      continue;
    }
    let end = index;
    while (end < rows.length && rows[end].type !== "same") end += 1;
    const run = rows.slice(index, end);
    grouped.push(...run.filter((row) => row.type === "del"));
    grouped.push(...run.filter((row) => row.type === "add"));
    index = end;
  }
  return grouped;
}

export function diffLines(oldText: string, newText: string): DiffRow[] {
  const a = toLines(oldText);
  const b = toLines(newText);
  const n = a.length;
  const m = b.length;
  if (!n && !m) return [];
  if (!n) return b.map((text, index) => ({ type: "add" as const, text, newLine: index + 1 }));
  if (!m) return a.map((text, index) => ({ type: "del" as const, text, oldLine: index + 1 }));
  if ((n + 1) * (m + 1) > MAX_LCS_CELLS) {
    return [
      ...a.map((text, index) => ({ type: "del" as const, text, oldLine: index + 1 })),
      ...b.map((text, index) => ({ type: "add" as const, text, newLine: index + 1 })),
    ];
  }

  const stride = m + 1;
  const dp = new Uint32Array((n + 1) * stride);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i * stride + j] = a[i] === b[j]
        ? dp[(i + 1) * stride + j + 1] + 1
        : Math.max(dp[(i + 1) * stride + j], dp[i * stride + j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  let oldNo = 1;
  let newNo = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: "same", text: a[i], oldLine: oldNo, newLine: newNo });
      i += 1;
      j += 1;
      oldNo += 1;
      newNo += 1;
    } else if (dp[(i + 1) * stride + j] >= dp[i * stride + j + 1]) {
      rows.push({ type: "del", text: a[i], oldLine: oldNo });
      i += 1;
      oldNo += 1;
    } else {
      rows.push({ type: "add", text: b[j], newLine: newNo });
      j += 1;
      newNo += 1;
    }
  }
  while (i < n) {
    rows.push({ type: "del", text: a[i], oldLine: oldNo });
    i += 1;
    oldNo += 1;
  }
  while (j < m) {
    rows.push({ type: "add", text: b[j], newLine: newNo });
    j += 1;
    newNo += 1;
  }
  return groupChanges(rows);
}

/** 序列化为 unified diff 风格文本（复制到剪贴板用） */
export function toUnifiedText(rows: DiffRow[]): string {
  return rows
    .map((row) => `${row.type === "add" ? "+" : row.type === "del" ? "-" : " "}${row.text}`)
    .join("\n");
}
