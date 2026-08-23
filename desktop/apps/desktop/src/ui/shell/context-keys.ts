/**
 * when 子句上下文键求值器（最小语法子集）
 *
 * 语法：`键` / `键==值` / `键!=值` / 复合 `A && B`、`A || B`（&& 优先级高于 ||），无括号。
 * 解析/取值失败一律按「不满足」（false）处理——安全侧默认隐藏。
 */
import { sessionStore, shellStore } from "./store.ts";

type Token =
  | { t: "key"; v: string }
  | { t: "op"; v: "&&" | "||" | "==" | "!=" }
  | { t: "lparen" }
  | { t: "rparen" };

/** 读取上下文键值；未知键返回 undefined（按不成立处理） */
export function contextValue(key: string): string | boolean | undefined {
  switch (key) {
    case "aluka.activeView":
      return shellStore.get().view;
    case "aluka.workspaceOpen":
      return Boolean(shellStore.get().settings.cwd);
    case "aluka.busy":
      return sessionStore.get().busy;
    case "aluka.modelSelected":
      return Boolean(shellStore.get().settings.model && shellStore.get().settings.provider);
    case "aluka.sidebarCollapsed":
      return shellStore.get().sidebarCollapsed;
    default:
      return undefined;
  }
}

function tokenize(expr: string): Token[] | undefined {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "(") {
      tokens.push({ t: "lparen" });
      i += 1;
      continue;
    }
    if (ch === ")") {
      tokens.push({ t: "rparen" });
      i += 1;
      continue;
    }
    if (ch === "&" && expr[i + 1] === "&") {
      tokens.push({ t: "op", v: "&&" });
      i += 2;
      continue;
    }
    if (ch === "|" && expr[i + 1] === "|") {
      tokens.push({ t: "op", v: "||" });
      i += 2;
      continue;
    }
    if ((ch === "=" && expr[i + 1] === "=") || (ch === "!" && expr[i + 1] === "=")) {
      tokens.push({ t: "op", v: ch === "=" ? "==" : "!=" });
      i += 2;
      continue;
    }
    // 键名 / 字面量：读到空格或操作符为止
    const start = i;
    while (i < expr.length && !/[\s&|=!()]/.test(expr[i])) i += 1;
    if (i === start) return undefined;
    tokens.push({ t: "key", v: expr.slice(start, i) });
  }
  return tokens;
}

/** 递归下降：or → and → primary → 括号 */
function parse(tokens: Token[]): boolean {
  let pos = 0;

  function parseOr(): boolean {
    let left = parseAnd();
    while (pos < tokens.length && tokens[pos].t === "op" && (tokens[pos] as { v: string }).v === "||") {
      pos += 1;
      const right = parseAnd();
      left = left || right;
    }
    return left;
  }

  function parseAnd(): boolean {
    let left = parsePrimary();
    while (pos < tokens.length && tokens[pos].t === "op" && (tokens[pos] as { v: string }).v === "&&") {
      pos += 1;
      const right = parsePrimary();
      left = left && right;
    }
    return left;
  }

  function parsePrimary(): boolean {
    const token = tokens[pos];
    if (!token) return false;
    if (token.t === "lparen") {
      pos += 1;
      const value = parseOr();
      if (tokens[pos]?.t !== "rparen") return false;
      pos += 1;
      return value;
    }
    if (token.t !== "key") return false;
    pos += 1;
    // 比较表达式：键 == 值 / 键 != 值
    const opToken = tokens[pos];
    if (opToken && opToken.t === "op" && ((opToken as { v: string }).v === "==" || (opToken as { v: string }).v === "!=")) {
      pos += 1;
      const valueToken = tokens[pos];
      if (!valueToken || valueToken.t !== "key") return false;
      pos += 1;
      const actual = contextValue(token.v);
      const expected = valueToken.v;
      if (opToken.v === "!=") return actual !== undefined && String(actual) !== expected;
      return String(actual) === expected;
    }
    // 裸键：存在且为真值
    const value = contextValue(token.v);
    return Boolean(value);
  }

  const result = parseOr();
  return result && pos === tokens.length;
}

/** 求值 when 表达式；空表达式视为满足，任何异常视为不满足 */
export function evalWhen(expr: string | undefined): boolean {
  if (!expr || !expr.trim()) return true;
  try {
    const tokens = tokenize(expr);
    if (!tokens || tokens.length === 0) return false;
    return parse(tokens);
  } catch {
    return false;
  }
}
