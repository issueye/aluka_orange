/**
 * prismjs 语法高亮封装。
 *
 * - 注册常用语言组件（markup/css/clike/javascript 已内置于核心）；
 * - resolveLanguage 将扩展名 / 语言别名归一化为 prism 语法名；
 * - highlightToLines 把整段代码高亮后按行拆分为 HTML 片段，
 *   跨行 token（块注释、模板字符串等）在行边界正确闭合再重开，
 *   供 CodeBlock / DiffView 逐行渲染（行级 diff 不会破坏高亮结构）。
 */
import "./prism-manual.ts";
import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-json";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-python";
import "prismjs/components/prism-go";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-java";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-scss";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-diff";

/** 扩展名 / 别名 → prism 语法名（未列出的交给 prism 内置别名或按原文查找） */
const LANGUAGE_ALIASES: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "json",
  html: "markup",
  htm: "markup",
  xml: "markup",
  svg: "markup",
  vue: "markup",
  svelte: "markup",
  astro: "markup",
  css: "css",
  scss: "scss",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  python: "python",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  shell: "bash",
  go: "go",
  rs: "rust",
  rust: "rust",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  cs: "csharp",
  csharp: "csharp",
  sql: "sql",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  ini: "toml",
  diff: "diff",
  patch: "diff",
};

/** prism token 结构（@types/prismjs 的 Token 为 class，这里取结构性子集便于递归处理） */
type TokenLike = {
  type: string;
  alias?: string | string[];
  content: string | TokenLike | Array<string | TokenLike>;
};
type TokenNode = string | TokenLike;

/** HTML 文本节点转义（prism 只保证 token 内容安全，纯文本需自行转义） */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 将 token 树展开为「按行拆分、span 平衡」的 HTML 数组 */
class LineSplitter {
  private lines: string[] = [];
  private current = "";
  /** 未闭合 token 的 class 栈，换行时先全部闭合、新行再重开 */
  private open: string[] = [];

  private breakLine(): void {
    this.lines.push(this.current + "</span>".repeat(this.open.length));
    this.current = this.open.map((cls) => `<span class="${cls}">`).join("");
  }

  private walk(node: TokenNode): void {
    if (typeof node === "string") {
      const parts = node.split("\n");
      for (let index = 0; index < parts.length; index += 1) {
        if (index > 0) this.breakLine();
        this.current += escapeHtml(parts[index]);
      }
      return;
    }
    const classes = ["token", node.type];
    const alias = node.alias;
    if (alias) classes.push(...(Array.isArray(alias) ? alias : [alias]));
    const cls = classes.join(" ");
    this.current += `<span class="${cls}">`;
    this.open.push(cls);
    const content = node.content;
    if (typeof content === "string") {
      this.walk(content);
    } else if (Array.isArray(content)) {
      for (const child of content) this.walk(child);
    } else {
      this.walk(content);
    }
    this.open.pop();
    this.current += "</span>";
  }

  collect(tokens: Array<string | TokenLike>): string[] {
    for (const token of tokens) this.walk(token);
    // 空行（无任何文本内容）以 &nbsp; 占位，保证行高不塌陷
    return [...this.lines, this.current].map((line) =>
      line.replace(/<[^>]*>/g, "") ? line : "&#160;",
    );
  }
}

/**
 * 将扩展名 / 文件名 / 语言名归一化为 prism 语法名；无法识别时返回 undefined。
 */
export function resolveLanguage(input?: string): string | undefined {
  if (!input) return undefined;
  const token = input.split(/[\\/]/).pop() ?? input;
  const key = (token.includes(".") ? token.split(".").pop() : token)?.toLowerCase();
  if (!key) return undefined;
  const mapped = LANGUAGE_ALIASES[key];
  if (mapped && Prism.languages[mapped]) return mapped;
  return Prism.languages[key] ? key : undefined;
}

/**
 * 高亮整段代码并按行返回 HTML；无可用语法时返回纯转义文本。
 * 空行以 &nbsp; 占位，保证行高不塌陷。
 */
export function highlightToLines(code: string, language?: string): string[] {
  const grammar = language ? Prism.languages[language] : undefined;
  if (!grammar) {
    return code.split("\n").map((line) => escapeHtml(line) || "&#160;");
  }
  const tokens = Prism.tokenize(code, grammar) as Array<string | TokenLike>;
  return new LineSplitter().collect(tokens);
}
