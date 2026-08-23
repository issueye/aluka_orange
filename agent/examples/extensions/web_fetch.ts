import type { ExtensionAPI } from "@aluka/coding-agent";
import { Type } from "typebox";

/**
 * Web Fetch 扩展 — 抓取 URL 并抽取可读文本
 *
 * 用法：
 * - 放到 .aluka/extensions/web_fetch.ts 或 ~/.aluka/agent/extensions/
 * - 或命令行：-e ./examples/extensions/web_fetch.ts
 * - Agent 将获得 web_fetch 工具
 *
 * 特性：HTML 自动去噪抽取、JSON 格式化、超时/Abort、截断保护、仅允许 http(s)
 */

const DEFAULT_MAX_CHARS = 15_000;
const MAX_MAX_CHARS = 50_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_UA = "Mozilla/5.0 (compatible; AlukaBot/1.0; +https://github.com/aluka)";

function looksLikeJson(text: string): boolean {
  const t = text.trimStart();
  return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
}
function formatJson(text: string): string {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}
function stripTags(s: string): string { return s.replace(/<[^>]+>/g, ""); }
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n) => { try { return String.fromCharCode(Number(n)); } catch { return _m; } })
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => { try { return String.fromCharCode(parseInt(n, 16)); } catch { return _m; } });
}
function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<\/h[1-6]>/gi, "\n\n").replace(/<\/p>/gi, "\n\n").replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>/gi, "\n").replace(/<\/li>/gi, "\n").replace(/<\/tr>/gi, "\n")
    .replace(/<\/section>/gi, "\n\n").replace(/<\/article>/gi, "\n\n");
  s = s.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, inner) => {
    const t = stripTags(inner).trim(); if (!t) return "";
    if (/^https?:\/\//i.test(href) && t !== href) return `${t} (${href})`;
    return t;
  });
  s = stripTags(s); s = decodeEntities(s);
  s = s.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ");
  return s.trim();
}
function htmlToMarkdown(html: string): string {
  let s = html;
  s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_m, t) => `# ${stripTags(t).trim()}\n\n`);
  s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_m, t) => `## ${stripTags(t).trim()}\n\n`);
  s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_m, t) => `### ${stripTags(t).trim()}\n\n`);
  return htmlToText(s);
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch a URL and return its content as readable text. HTML is auto-extracted to plain text; JSON/text is returned directly. Use when you need to read a web page, doc, or API response.",
    parameters: Type.Object({
      url: Type.String({ description: "http(s) URL to fetch" }),
      maxChars: Type.Optional(Type.Number({ description: "Max characters to return (default 15000, max 50000)" })),
      extractMode: Type.Optional(Type.String({ description: "Extraction mode: text (default) | markdown | raw" })),
      timeout: Type.Optional(Type.Number({ description: "Timeout in milliseconds (default 15000, max 30000)" })),
      headers: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "Optional extra request headers" })),
    }),
    async execute(_id, params, signal) {
      const rawUrl = String((params as { url?: unknown }).url ?? "").trim();
      if (!rawUrl) return { content: [{ type: "text" as const, text: "web_fetch: url is required" }], isError: true };
      let parsed: URL;
      try { parsed = new URL(rawUrl); } catch {
        return { content: [{ type: "text" as const, text: `Invalid URL: ${rawUrl}` }], isError: true };
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { content: [{ type: "text" as const, text: `Only http(s) URLs are allowed: ${rawUrl}` }], isError: true };
      }
      const maxChars = Math.min(Math.max(Math.floor(Number((params as { maxChars?: unknown }).maxChars ?? DEFAULT_MAX_CHARS) || DEFAULT_MAX_CHARS), 1), MAX_MAX_CHARS);
      const timeoutMs = Math.min(Math.max(Math.floor(Number((params as { timeout?: unknown }).timeout ?? DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS), 1_000), MAX_TIMEOUT_MS);
      const mode = (params as { extractMode?: string }).extractMode === "raw" ? "raw" : (params as { extractMode?: string }).extractMode === "markdown" ? "markdown" : "text";
      const controller = new AbortController();
      const onAbort = () => controller.abort((signal as AbortSignal | undefined)?.reason);
      (signal as AbortSignal | undefined)?.addEventListener("abort", onAbort);
      const timer = setTimeout(() => controller.abort(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
      try {
        const headers: Record<string, string> = {
          "user-agent": DEFAULT_UA,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,application/json;q=0.7,*/*;q=0.5",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
          ...(((params as { headers?: Record<string, string> }).headers as Record<string, string> | undefined) ?? {}),
        };
        const res = await fetch(rawUrl, { method: "GET", headers, redirect: "follow", signal: controller.signal });
        const contentType = res.headers.get("content-type") ?? "";
        const status = res.status;
        const finalUrl = res.url || rawUrl;
        if (!res.ok) {
          const body = (await res.text().catch(() => "")).slice(0, 800);
          return { content: [{ type: "text" as const, text: `HTTP ${status} ${res.statusText} for ${finalUrl}\n${body}`.trim() }], details: { url: finalUrl, status, contentType }, isError: true };
        }
        if (/^(image|video|audio|font)\//i.test(contentType) || /application\/(octet-stream|pdf|zip|gzip)/i.test(contentType)) {
          return { content: [{ type: "text" as const, text: `Binary content (${contentType}) not supported for ${finalUrl}` }], details: { url: finalUrl, status, contentType }, isError: true };
        }
        const rawText = await res.text();
        let output: string;
        if (mode === "raw") output = rawText;
        else if (contentType.includes("application/json") || looksLikeJson(rawText)) output = formatJson(rawText);
        else if (contentType.includes("html") || /<html/i.test(rawText.slice(0, 2000))) output = mode === "markdown" ? htmlToMarkdown(rawText) : htmlToText(rawText);
        else output = rawText;
        const truncated = output.length > maxChars;
        if (truncated) output = output.slice(0, maxChars) + `\n\n[truncated at ${maxChars} chars, total ${rawText.length} chars]`;
        const header = `# ${finalUrl}\nStatus: ${status}  Content-Type: ${contentType || "(unknown)"}  Length: ${output.length}${truncated ? " (truncated)" : ""}\n---\n`;
        const text = (header + output).slice(0, maxChars + 500);
        return { content: [{ type: "text" as const, text }], details: { url: finalUrl, status, contentType, length: output.length, truncated } };
      } catch (error) {
        if ((error as Error)?.name === "AbortError") {
          const reason = (signal as AbortSignal | undefined)?.aborted ? "aborted" : `timeout after ${timeoutMs}ms`;
          return { content: [{ type: "text" as const, text: `web_fetch ${reason}: ${rawUrl}` }], isError: true };
        }
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: `web_fetch failed for ${rawUrl}: ${message}` }], isError: true };
      } finally {
        clearTimeout(timer);
        (signal as AbortSignal | undefined)?.removeEventListener("abort", onAbort);
      }
    },
  });
}
