import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { ImageViewer } from "./ImageViewer.tsx";
import { Spinner } from "./Spinner.tsx";

export type MarkdownProps = {
  children: string;
  className?: string;
};

/** 单张 Markdown 图片：加载中转圈、失败降级为占位、点击灯箱放大 */
function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [preview, setPreview] = useState(false);

  if (!src) return null;

  if (status === "error") {
    return (
      <span className="ui-markdown__img-error" title={src}>
        ⚠️ 图片加载失败：{alt || src}
      </span>
    );
  }

  return (
    <span className="ui-markdown__img-wrap">
      <img
        src={src}
        alt={alt ?? ""}
        loading="lazy"
        className={status === "loading" ? "is-loading" : ""}
        onLoad={() => setStatus("loaded")}
        onError={() => setStatus("error")}
        onClick={() => setPreview(true)}
      />
      {status === "loading" ? <Spinner size={18} label="图片加载中" /> : null}
      {preview ? <ImageViewer src={src} alt={alt} onClose={() => setPreview(false)} /> : null}
    </span>
  );
}

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
  img: ({ src, alt }) => <MarkdownImage src={typeof src === "string" ? src : undefined} alt={alt} />,
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
 * 助手消息 Markdown 渲染（GFM：表格 / 任务列表 / 删除线 / 自动链接 / 图片）。
 * 默认不渲染原始 HTML，降低 XSS 风险；图片点击后灯箱放大查看。
 * memo：时间线重渲染（流式 delta、状态更新）时文本未变的消息跳过重新解析。
 */
export const Markdown = memo(function Markdown({ children, className = "" }: MarkdownProps) {
  const text = children ?? "";
  if (!text.trim()) return null;

  return (
    <div className={["ui-markdown", className].filter(Boolean).join(" ")}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
