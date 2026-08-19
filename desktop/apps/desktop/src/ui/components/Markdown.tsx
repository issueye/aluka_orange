import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

export type MarkdownProps = {
  children: string;
  className?: string;
};

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
  code: ({ className, children, ...rest }) => {
    const isBlock = Boolean(className?.includes("language-"));
    if (isBlock) {
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      );
    }
    return (
      <code className="ui-markdown__inline-code" {...rest}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className="ui-markdown__pre">{children}</pre>,
};

/**
 * 助手消息 Markdown 渲染（GFM：表格 / 任务列表 / 删除线 / 自动链接）。
 * 默认不渲染原始 HTML，降低 XSS 风险。
 */
export function Markdown({ children, className = "" }: MarkdownProps) {
  const text = children ?? "";
  if (!text.trim()) return null;

  return (
    <div className={["ui-markdown", className].filter(Boolean).join(" ")}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
