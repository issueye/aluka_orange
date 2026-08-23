import type { ExtensionAPI } from "@aluka/coding-agent";
import { Type } from "typebox";

/**
 * Tavily Web Search 工具扩展
 *
 * - 工具名：web_search（agent 可自主联网查询）
 * - API Key：经环境变量 TAVILY_API_KEY 配置（设置页 → 环境变量 分区，持久化并注入进程）
 * - 端点：POST https://api.tavily.com/search
 */

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "通过 Tavily 搜索互联网获取最新信息（新闻/文档/技术内容）。用户需要实时或外部信息时使用；搜索前可通过带引号短语提高精度",
    parameters: Type.Object({
      query: Type.String({ description: "搜索查询（可用引号包裹词组提高相关度）" }),
      max_results: Type.Optional(
        Type.Number({ description: "返回结果条数（默认 5，1-10）", default: 5 }),
      ),
      search_depth: Type.Optional(
        Type.String({
          description: "搜索深度：basic（默认，快速）| advanced（慢但更全面）",
          default: "basic",
        }),
      ),
      include_answer: Type.Optional(
        Type.Boolean({ description: "是否附带 Tavily 生成的摘要答案（默认 true）", default: true }),
      ),
    }),
    async execute(_id, params) {
      const apiKey = process.env.TAVILY_API_KEY;
      if (!apiKey || !apiKey.trim()) {
        return {
          content: [
            {
              type: "text" as const,
              text: "web_search 需要 TAVILY_API_KEY：请在 设置 → 环境变量 中添加后重试。",
            },
          ],
          details: { error: "TAVILY_API_KEY not configured" },
        };
      }
      try {
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            api_key: apiKey.trim(),
            query: params.query,
            max_results: Math.min(Math.max(Number(params.max_results ?? 5) || 5, 1), 10),
            search_depth: params.search_depth === "advanced" ? "advanced" : "basic",
            include_answer: params.include_answer !== false,
          }),
        });
        if (!res.ok) {
          const body = String((await res.text()).slice(0, 300));
          return {
            content: [{ type: "text" as const, text: `Tavily 请求失败（${res.status}）：${body}` }],
            details: { status: res.status },
          };
        }
        const data = (await res.json()) as {
          answer?: string;
          results?: Array<{ title: string; url: string; content?: string; score?: number }>;
        };
        const results = data.results ?? [];
        const lines: string[] = [];
        if (data.answer) lines.push(`摘要：${data.answer}`);
        results.forEach((result, index) => {
          lines.push(
            `${index + 1}. ${result.title}\n   ${result.url}\n   ${String(result.content ?? "").slice(0, 400)}`,
          );
        });
        if (!lines.length) lines.push("未找到相关结果。");
        return {
          content: [{ type: "text" as const, text: lines.join("\n\n") }],
          details: { count: results.length, answer: data.answer },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `web_search 执行失败：${message}` }],
          details: { error: message },
        };
      }
    },
  });
}