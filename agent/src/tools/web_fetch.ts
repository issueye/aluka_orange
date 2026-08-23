/**
 * Web Fetch 工具
 *
 * 抓取任意 URL 并返回可读文本：
 * - 支持 http/https，自动跟随重定向
 * - HTML 自动抽取正文（去脚本/样式、保留标题与段落结构）
 * - 纯文本 / JSON 原样返回（截断到 maxChars）
 * - 超时 + AbortSignal 取消，输出截断保护
 */

import { Type } from "typebox";
import { defineTool } from "../extensions/types.ts";

const DEFAULT_MAX_CHARS = 15_000;
const MAX_MAX_CHARS = 50_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 30_000;

/** 默认 User-Agent，避免部分站点拒绝空 UA */
const DEFAULT_UA =
  "Mozilla/5.0 (compatible; AlukaBot/1.0; +https://github.com/aluka)";

export const webFetchTool = defineTool({
  name: "web_fetch",
  label: "Web Fetch",
  description:
    "Fetch a URL and return its content as readable text. HTML is auto-extracted to plain text; JSON/text is returned directly. Use when you need to read a web page, doc, or API response.",
  promptSnippet: "Fetch URL content and extract readable text",
  parameters: Type.Object({
    url: Type.String({ description: "http(s) URL to fetch" }),
    maxChars: Type.Optional(
      Type.Number({ description: "Max characters to return (default 15000, max 50000)" }),
    ),
    extractMode: Type.Optional(
      Type.String({
        description: "Extraction mode: text (default) | markdown | raw",
      }),
    ),
    timeout: Type.Optional(
      Type.Number({ description: "Timeout in milliseconds (default 15000, max 30000)" }),
    ),
    headers: Type.Optional(
      Type.Record(Type.String(), Type.String(), {
        description: "Optional extra request headers (e.g. Authorization)",
      }),
    ),
  }),
  async execute(_id, params, signal, _onUpdate, _ctx) {
    const rawUrl = String(params.url ?? "").trim();
    if (!rawUrl) {
      return { content: [{ type: "text", text: "web_fetch: url is required" }], isError: true };
    }
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return { content: [{ type: "text", text: `Invalid URL: ${rawUrl}` }], isError: true };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        content: [{ type: "text", text: `Only http(s) URLs are allowed: ${rawUrl}` }],
        isError: true,
      };
    }

    const maxChars = Math.min(
      Math.max(Math.floor(Number(params.maxChars ?? DEFAULT_MAX_CHARS) || DEFAULT_MAX_CHARS), 1),
      MAX_MAX_CHARS,
    );
    const timeoutMs = Math.min(
      Math.max(Math.floor(Number(params.timeout ?? DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS), 1_000),
      MAX_TIMEOUT_MS,
    );
    const mode = params.extractMode === "raw" ? "raw" : params.extractMode === "markdown" ? "markdown" : "text";

    // 合并 AbortSignal（外部 signal + 超时）
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort);
    const timer = setTimeout(() => controller.abort(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);

    try {
      const headers: Record<string, string> = {
        "user-agent": DEFAULT_UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,application/json;q=0.7,*/*;q=0.5",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        ...((params.headers as Record<string, string> | undefined) ?? {}),
      };

      const res = await fetch(rawUrl, {
        method: "GET",
        headers,
        redirect: "follow",
        signal: controller.signal,
      });

      const contentType = res.headers.get("content-type") ?? "";
      const status = res.status;
      const finalUrl = res.url || rawUrl;

      if (!res.ok) {
        const body = (await res.text().catch(() => "")).slice(0, 800);
        return {
          content: [{ type: "text", text: `HTTP ${status} ${res.statusText} for ${finalUrl}\n${body}`.trim() }],
          details: { url: finalUrl, status, contentType },
          isError: true,
        };
      }

      // 二进制类型直接提示
      if (
        /^(image|video|audio|font)\//i.test(contentType) ||
        /application\/(octet-stream|pdf|zip|gzip)/i.test(contentType)
      ) {
        return {
          content: [{ type: "text", text: `Binary content (${contentType}) not supported for ${finalUrl}` }],
          details: { url: finalUrl, status, contentType },
          isError: true,
        };
      }

      const rawText = await res.text();
      let output: string;

      if (mode === "raw") {
        output = rawText;
      } else if (contentType.includes("application/json") || looksLikeJson(rawText)) {
        output = formatJson(rawText);
      } else if (contentType.includes("html") || /<html/i.test(rawText.slice(0, 2000))) {
        output = mode === "markdown" ? htmlToMarkdown(rawText, finalUrl) : htmlToText(rawText, finalUrl);
      } else {
        output = rawText;
      }

      const truncated = output.length > maxChars;
      if (truncated) output = output.slice(0, maxChars) + `\n\n[truncated at ${maxChars} chars, total ${rawText.length} chars]`;

      const header = `# ${finalUrl}\nStatus: ${status}  Content-Type: ${contentType || "(unknown)"}  Length: ${output.length}${truncated ? " (truncated)" : ""}\n---\n`;
      const text = (header + output).slice(0, maxChars + 500);

      return {
        content: [{ type: "text", text }],
        details: { url: finalUrl, status, contentType, length: output.length, truncated },
      };
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        const reason = signal?.aborted ? "aborted" : `timeout after ${timeoutMs}ms`;
        return { content: [{ type: "text", text: `web_fetch ${reason}: ${rawUrl}` }], isError: true };
      }
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: `web_fetch failed for ${rawUrl}: ${message}` }], isError: true };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  },
});

function looksLikeJson(text: string): boolean {
  const t = text.trimStart();
  return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
}

function formatJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** 极简 HTML -> Text 抽取（无外部依赖） */
function htmlToText(html: string, _url: string): string {
  let s = html;
  // 去掉脚本/样式/noscript
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  // 保留结构性换行
  s = s.replace(/<\/h[1-6]>/gi, "\n\n");
  s = s.replace(/<\/p>/gi, "\n\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/div>/gi, "\n");
  s = s.replace(/<\/li>/gi, "\n");
  s = s.replace(/<\/tr>/gi, "\n");
  s = s.replace(/<\/section>/gi, "\n\n");
  s = s.replace(/<\/article>/gi, "\n\n");
  // 保留��接文本（可选附 URL）
  s = s.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, inner) => {
    const t = stripTags(inner).trim();
    if (!t) return "";
    // 相对链接不展开，绝对链接追加
    if (/^https?:\/\//i.test(href) && t !== href) return `${t} (${href})`;
    return t;
  });
  s = stripTags(s);
  s = decodeEntities(s);
  // 规整空白
  s = s.replace(/\r/g, "");
  s = s.replace(/[ \t]+\n/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  s = s.replace(/[ \t]{2,}/g, " ");
  // 去除首尾空白行
  return s.trim();
}

function htmlToMarkdown(html: string, url: string): string {
  // markdown 模式复用 htmlToText，再把标题加 # 前缀（轻量）
  let s = html;
  s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_m, t) => `# ${stripTags(t).trim()}\n\n`);
  s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_m, t) => `## ${stripTags(t).trim()}\n\n`);
  s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_m, t) => `### ${stripTags(t).trim()}\n\n`);
  // 其余走 text 抽取
  const text = htmlToText(s, url);
  return text;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n) => {
      try {
        return String.fromCharCode(Number(n));
      } catch {
        return _m;
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => {
      try {
        return String.fromCharCode(parseInt(n, 16));
      } catch {
        return _m;
      }
    });
}
