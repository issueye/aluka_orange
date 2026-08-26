import { useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  FileCode,
  FilePenLine,
  Folder,
  LoaderCircle,
  Search,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import { CodeBlock } from "./components/CodeBlock.tsx";
import { DiffView } from "./components/DiffView.tsx";
import { diffLines, toUnifiedText } from "./lib/diff.ts";

export type ToolStatus = "running" | "done" | "error";

export type ToolCardItem = {
  toolName?: string;
  args?: unknown;
  resultText?: string;
  text?: string;
  isError?: boolean;
  toolStatus?: ToolStatus;
};

function languageHint(filePath?: string): string | undefined {
  const ext = filePath?.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase();
  return ext || undefined;
}

function fileName(filePath?: string): string | undefined {
  if (!filePath) return undefined;
  return filePath.split(/[\\/]/).filter(Boolean).pop();
}

export function parseNumberedOutput(text: string): { start: number; lines: string[]; notice?: string } | undefined {
  const raw = text.replace(/\n$/, "").split("\n");
  const lines: { n: number; body: string }[] = [];
  let notice: string | undefined;
  for (const line of raw) {
    const match = /^(?:\s*)(\d+)\|(.*)$/.exec(line);
    if (!match) {
      if (lines.length && line.trim()) notice = (notice ? `${notice}\n` : "") + line;
      else if (!lines.length) return undefined;
      continue;
    }
    lines.push({ n: Number(match[1]), body: match[2] });
  }
  if (!lines.length) return undefined;
  return { start: lines[0].n, lines: lines.map((item) => item.body), notice };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        return asRecord(JSON.parse(trimmed));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function unwrapOutput(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return text;
  try {
    const parsed = JSON.parse(trimmed) as { content?: unknown; text?: unknown };
    if (typeof parsed.text === "string" && parsed.text) return parsed.text;
    if (Array.isArray(parsed.content)) {
      const inner = parsed.content
        .map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : ""))
        .join("\n");
      if (inner) return inner;
    }
  } catch {
    /* keep original */
  }
  return text;
}

function formatArgValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function ToolIcon({ name }: { name?: string }) {
  const props = { size: 14, strokeWidth: 2 };
  if (name === "read") return <FileCode {...props} />;
  if (name === "write" || name === "edit") return <FilePenLine {...props} />;
  if (name === "bash") return <Terminal {...props} />;
  if (name === "grep" || name === "find") return <Search {...props} />;
  if (name === "ls") return <Folder {...props} />;
  return <Wrench {...props} />;
}

function summarizeArgs(args?: Record<string, unknown>): string {
  if (!args) return "";
  if (typeof args.command === "string") return args.command;
  if (typeof args.path === "string") return fileName(args.path) || args.path;
  if (typeof args.pattern === "string") return args.pattern;
  if (typeof args.query === "string") return args.query;
  const first = Object.values(args).find((value) => typeof value === "string" && value);
  return typeof first === "string" ? first : "";
}

export function ToolCard({ item }: { item: ToolCardItem }) {
  const status: ToolStatus = item.toolStatus ?? (item.isError ? "error" : item.resultText || item.text ? "done" : "running");
  const args = asRecord(item.args);
  const output = unwrapOutput(item.resultText ?? item.text ?? "");
  const path = typeof args?.path === "string" ? args.path : undefined;
  const numbered = useMemo(() => parseNumberedOutput(output), [output]);

  // 代码类参数改用专门视图：write 的 content 走代码块，edit 的 oldText/newText 走 diff
  const writeContent = item.toolName === "write" && typeof args?.content === "string"
    ? (args.content as string)
    : undefined;
  const isEditPair = item.toolName === "edit"
    && typeof args?.oldText === "string"
    && typeof args?.newText === "string";
  const oldText = isEditPair ? (args?.oldText as string) : undefined;
  const newText = isEditPair ? (args?.newText as string) : undefined;
  const diffRows = useMemo(
    () => (isEditPair ? diffLines(oldText as string, newText as string) : undefined),
    [isEditPair, oldText, newText],
  );

  const [copied, setCopied] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const open = userOpen;
  const name = fileName(path);
  const summary = summarizeArgs(args) || name || "";
  const lineCount = numbered?.lines.length
    ?? (writeContent !== undefined ? writeContent.split("\n").length : output ? output.split("\n").length : 0);
  const hiddenArgKeys = new Set([
    ...(writeContent !== undefined ? ["content"] : []),
    ...(diffRows ? ["oldText", "newText"] : []),
  ]);
  const argEntries = Object.entries(args ?? {}).filter(
    ([key, value]) => value !== undefined && value !== "" && !hiddenArgKeys.has(key),
  );
  const diffAdds = diffRows?.filter((row) => row.type === "add").length ?? 0;
  const diffDels = diffRows?.filter((row) => row.type === "del").length ?? 0;
  const statusLabel = status === "running" ? "执行中" : status === "error" ? "失败" : "完成";
  const metaParts = [
    languageHint(path),
    diffRows ? `+${diffAdds} −${diffDels}` : lineCount > 0 && status !== "running" ? `${lineCount} 行` : "",
  ];
  const meta = metaParts.filter(Boolean).join(" · ");

  async function copy(event: { stopPropagation(): void }) {
    event.stopPropagation();
    const payload = diffRows
      ? toUnifiedText(diffRows)
      : writeContent ?? (numbered ? numbered.lines.join("\n") : output);
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className={`tool-card tool-card--${status}${open ? " is-open" : ""}`}>
      <button type="button" className="tool-card__head" onClick={() => setUserOpen(!open)} aria-expanded={open}>
        <ChevronDown size={14} className={`tool-card__chevron${open ? " is-open" : ""}`} />
        <span className="tool-card__icon"><ToolIcon name={item.toolName} /></span>
        <span className="tool-card__name">{item.toolName || "工具"}</span>
        {summary ? <span className="tool-card__file" title={typeof args?.path === "string" ? args.path : summary}>{summary}</span> : null}
        {meta ? <span className="tool-card__lang">{meta}</span> : null}
        <span className={`tool-card__status tool-card__status--${status}`}>
          {status === "running" ? <LoaderCircle size={12} className="tool-card__spin" /> : status === "error" ? <X size={11} /> : <Check size={11} />}
          {statusLabel}
        </span>
        {(output || writeContent || diffRows) && status !== "running" ? (
          <span
            className="tool-card__copy"
            role="button"
            tabIndex={0}
            title="复制输出"
            onClick={copy}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                void copy(event);
              }
            }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="tool-card__body">
          {argEntries.length ? (
            <div className="tool-card__args">
              {argEntries.map(([key, value]) => (
                <div className="tool-card__arg" key={key}>
                  <span className="tool-card__arg-k">{key}</span>
                  <span className="tool-card__arg-v" title={formatArgValue(value)}>{formatArgValue(value)}</span>
                </div>
              ))}
            </div>
          ) : item.args != null ? (
            <pre className="tool-card__args-fallback">{formatArgValue(item.args)}</pre>
          ) : null}

          {status === "running" && !output && writeContent === undefined && !diffRows ? (
            <div className="tool-card__pending">正在执行…</div>
          ) : null}

          {/* 出错时优先展示错误输出；edit 出错仍附带意图变更的 diff 预览 */}
          {item.isError && output ? (
            <div className="tool-card__out tool-card__out--error">
              <pre className="tool-card__plain">{output}</pre>
            </div>
          ) : null}

          {numbered ? (
            <CodeBlock
              code={numbered.lines.join("\n")}
              language={path}
              startLine={numbered.start}
              lineNumbers
            />
          ) : writeContent !== undefined ? (
            <CodeBlock code={writeContent} language={path} lineNumbers />
          ) : oldText !== undefined && newText !== undefined ? (
            <DiffView oldText={oldText} newText={newText} language={path} />
          ) : output && !item.isError ? (
            <div className="tool-card__out">
              <pre className={item.toolName === "bash" ? "tool-card__terminal" : "tool-card__plain"}>{output}</pre>
            </div>
          ) : null}
          {numbered?.notice ? <div className="tool-card__notice">{numbered.notice}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
