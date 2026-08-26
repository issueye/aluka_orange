/**
 * 代码展示组件：语法高亮 + 行号 + 复制 + 语言标签。
 *
 * - 高亮基于 lib/highlight（prismjs），语言解析支持扩展名 / 语言名；
 * - wrap 控制长行折行（默认折行，适合聊天时间线）；关闭时横向滚动且行号吸左；
 * - memo：流式渲染时未变化的代码块跳过重新高亮。
 */
import { memo, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { highlightToLines, resolveLanguage } from "../lib/highlight.ts";

export type CodeBlockProps = {
  code: string;
  /** 语言或文件路径 / 扩展名（resolveLanguage 归一化） */
  language?: string;
  /** 首行行号（1-based，配合工具输出的行号偏移） */
  startLine?: number;
  /** 显示行号（默认关闭） */
  lineNumbers?: boolean;
  /** 长行折行（默认开启） */
  wrap?: boolean;
  /** 顶部信息条：语言标签 + 复制按钮（默认关闭） */
  showHeader?: boolean;
  /** 最大高度（px），超出内部滚动 */
  maxHeight?: number;
  className?: string;
};

function copyToClipboard(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) return Promise.reject(new Error("clipboard unavailable"));
  return navigator.clipboard.writeText(text);
}

export const CodeBlock = memo(function CodeBlock({
  code,
  language,
  startLine = 1,
  lineNumbers = false,
  wrap = true,
  showHeader = false,
  maxHeight = 420,
  className = "",
}: CodeBlockProps) {
  const grammar = resolveLanguage(language);
  const lines = useMemo(() => highlightToLines(code, grammar), [code, grammar]);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await copyToClipboard(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* 剪贴板不可用时静默忽略 */
    }
  }

  // 语言条显示归一化后的语法名；未识别时显示传入语言的最后一段（可能是文件名）
  const label = grammar ?? (language ? language.split(/[\\/]/).pop()?.toLowerCase() || "text" : "text");

  return (
    <div
      className={[
        "code-block",
        wrap ? "" : "code-block--nowrap",
        className,
      ].filter(Boolean).join(" ")}
    >
      {showHeader ? (
        <div className="code-block__head">
          <span className="code-block__lang">{label}</span>
          <button
            type="button"
            className={`code-block__copy${copied ? " is-copied" : ""}`}
            title={copied ? "已复制" : "复制代码"}
            aria-label={copied ? "已复制" : "复制代码"}
            onClick={() => void copy()}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>
      ) : null}
      <div
        className="code-block__body hl"
        style={maxHeight ? { maxHeight: `${maxHeight}px` } : undefined}
      >
        {lines.map((html, index) => (
          <div className="code-block__row" key={index}>
            {lineNumbers ? <span className="code-block__ln">{startLine + index}</span> : null}
            <code className="code-block__src" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        ))}
      </div>
    </div>
  );
});
