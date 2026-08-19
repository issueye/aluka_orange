/**
 * 生成内置厂商目录 catalog.generated.ts
 *
 * 数据来源：pi packages/ai/src/providers/data/*.json（上游 models.dev 快照），
 * 按下方 PROVIDERS 白名单精编；协议不受 aluka 支持（google-generative-ai /
 * mistral-conversations）的厂商改走其 OpenAI 兼容端点。
 *
 * 用法：node agent/scripts/build-provider-catalog.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PI_DATA = "E:/codes/github/pi/packages/ai/src/providers/data";
const OUT = path.resolve(__dirname, "../src/providers/catalog.generated.ts");

/** aluka 支持的协议 */
const SUPPORTED_APIS = new Set(["openai-completions", "openai-responses", "anthropic-messages"]);

/**
 * 厂商白名单。file=从 pi 的哪个 data json 取模型；api/baseUrl 缺省沿用数据；
 * stripCompat=协议改写后丢弃原 compat 标记；manual=完全手写条目。
 */
const PROVIDERS = [
  {
    id: "anthropic", file: "anthropic", name: "Anthropic",
    description: "Claude 官方 Messages API",
    envKeys: ["ANTHROPIC_API_KEY"], docsUrl: "https://console.anthropic.com",
    pick: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5", "claude-opus-4-8", "claude-sonnet-4-6"],
  },
  {
    id: "openai", file: "openai", name: "OpenAI",
    description: "GPT 官方 Responses API",
    envKeys: ["OPENAI_API_KEY"], docsUrl: "https://platform.openai.com",
    pick: ["gpt-5.5", "gpt-5.5-pro", "gpt-5.2", "gpt-5.3-codex", "gpt-5-mini", "gpt-4.1"],
  },
  {
    id: "google", file: "google", name: "Google Gemini",
    description: "Gemini 系列经 OpenAI 兼容端点接入",
    api: "openai-completions", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    stripCompat: true,
    envKeys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"], docsUrl: "https://aistudio.google.com",
    pick: ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.1-pro-preview", "gemini-3-pro-preview", "gemini-2.5-pro", "gemini-2.5-flash"],
  },
  {
    id: "xai", file: "xai", name: "xAI Grok",
    description: "Grok 官方 API（各模型沿用自身协议）",
    envKeys: ["XAI_API_KEY"], docsUrl: "https://console.x.ai",
    pick: ["grok-4.5", "grok-4.3"],
  },
  {
    id: "groq", file: "groq", name: "Groq",
    description: "超低延迟推理云（Llama / gpt-oss 等）",
    envKeys: ["GROQ_API_KEY"], docsUrl: "https://console.groq.com",
    pick: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.6-27b"],
  },
  {
    id: "deepseek", file: "deepseek", name: "DeepSeek",
    description: "DeepSeek V4 系列",
    envKeys: ["DEEPSEEK_API_KEY"], docsUrl: "https://platform.deepseek.com",
    pick: ["deepseek-v4-pro", "deepseek-v4-flash"],
  },
  {
    id: "moonshotai", file: "moonshotai", name: "Moonshot Kimi",
    description: "Kimi 官方 API（国际端点 api.moonshot.ai）",
    envKeys: ["MOONSHOT_API_KEY"], docsUrl: "https://platform.moonshot.ai",
    pick: ["kimi-k3", "kimi-k2.7-code", "kimi-k2.6"],
  },
  {
    id: "moonshotai-cn", file: "moonshotai-cn", name: "Moonshot Kimi（国内）",
    description: "Kimi 官方 API（国内端点 api.moonshot.cn）",
    envKeys: ["MOONSHOT_API_KEY"], docsUrl: "https://platform.moonshot.cn",
    pick: ["kimi-k3", "kimi-k2.7-code", "kimi-k2.6"],
  },
  {
    id: "zai", file: "zai", name: "智谱 GLM",
    description: "GLM 编程套餐 API（国际端点 api.z.ai）",
    envKeys: ["ZAI_API_KEY", "ZHIPU_API_KEY"], docsUrl: "https://z.ai",
    pick: ["glm-5.2", "glm-5-turbo", "glm-4.7"],
  },
  {
    id: "zai-coding-cn", file: "zai-coding-cn", name: "智谱 GLM（国内）",
    description: "GLM 编程套餐 API（国内端点 open.bigmodel.cn）",
    envKeys: ["ZHIPU_API_KEY", "ZAI_API_KEY"], docsUrl: "https://bigmodel.cn",
    pick: ["glm-5.2", "glm-5-turbo", "glm-4.7"],
  },
  {
    id: "minimax", file: "minimax", name: "MiniMax",
    description: "MiniMax M 系列（Anthropic 兼容端点）",
    envKeys: ["MINIMAX_API_KEY"], docsUrl: "https://www.minimax.io",
    pick: ["MiniMax-M3", "MiniMax-M2.7"],
  },
  {
    id: "minimax-cn", file: "minimax-cn", name: "MiniMax（国内）",
    description: "MiniMax M 系列（国内端点 api.minimaxi.com）",
    envKeys: ["MINIMAX_API_KEY"], docsUrl: "https://www.minimaxi.com",
    pick: ["MiniMax-M3", "MiniMax-M2.7"],
  },
  {
    id: "mistral", file: "mistral", name: "Mistral",
    description: "Mistral 系列经 OpenAI 兼容端点接入",
    api: "openai-completions", baseUrl: "https://api.mistral.ai/v1",
    stripCompat: true,
    envKeys: ["MISTRAL_API_KEY"], docsUrl: "https://console.mistral.ai",
    pick: ["mistral-large-latest", "devstral-latest", "magistral-medium-latest", "codestral-latest"],
  },
  {
    id: "openrouter", file: "openrouter", name: "OpenRouter",
    description: "聚合网关，一个密钥访问各家模型",
    envKeys: ["OPENROUTER_API_KEY"], docsUrl: "https://openrouter.ai",
    pick: ["anthropic/claude-sonnet-5", "openai/gpt-5.2", "google/gemini-3.1-pro-preview", "deepseek/deepseek-v4-pro", "moonshotai/kimi-k3", "z-ai/glm-5.2"],
  },
  {
    id: "qwen", file: "qwen-token-plan", name: "阿里云百炼 Qwen",
    description: "Qwen 系列经 DashScope OpenAI 兼容端点接入",
    api: "openai-completions", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    envKeys: ["DASHSCOPE_API_KEY"], docsUrl: "https://bailian.console.aliyun.com",
    pick: ["qwen3.8-max", "qwen3.7-plus", "qwen3.6-flash"],
  },
  {
    id: "ollama", manual: true, name: "Ollama（本地）",
    description: "本地模型运行时，无需密钥，模型从接口拉取",
    api: "openai-completions", baseUrl: "http://127.0.0.1:11434/v1",
    envKeys: [], docsUrl: "https://ollama.com", local: true,
    pick: [],
  },
];

/** 需要保留的模型字段（对齐 agent/src/ai/types.ts 的 Model） */
const MODEL_FIELDS = ["id", "name", "api", "provider", "baseUrl", "reasoning", "input", "cost", "contextWindow", "maxTokens", "compat", "thinkingLevelMap"];

function loadModels(file) {
  const raw = JSON.parse(fs.readFileSync(path.join(PI_DATA, `${file}.json`), "utf8"));
  const byId = new Map();
  for (const models of Object.values(raw)) {
    for (const [id, entry] of Object.entries(models)) byId.set(id, entry);
  }
  return byId;
}

function pickModel(entry, def) {
  const out = {};
  for (const key of MODEL_FIELDS) {
    if (entry[key] === undefined) continue;
    if (key === "compat" && def.stripCompat) continue;
    out[key] = entry[key];
  }
  // tiers（批量定价分层）为 aluka ModelCost 之外的扩展字段，丢弃
  if (out.cost && out.cost.tiers) {
    out.cost = { ...out.cost };
    delete out.cost.tiers;
  }
  // 厂商级覆盖（协议改写 / 端点替换 / 统一 provider id）
  out.provider = def.id;
  if (def.api) out.api = def.api;
  if (def.baseUrl) out.baseUrl = def.baseUrl;
  if (!SUPPORTED_APIS.has(out.api)) {
    throw new Error(`${def.id}/${entry.id}: 不支持的协议 ${out.api}`);
  }
  return out;
}

const providers = [];
for (const def of PROVIDERS) {
  const models = [];
  if (def.manual) {
    // 手写厂商（当前仅 ollama：无静态模型目录）
  } else {
    const byId = loadModels(def.file);
    for (const id of def.pick) {
      const entry = byId.get(id);
      if (!entry) throw new Error(`${def.id}: pi 目录中找不到模型 ${id}`);
      models.push(pickModel(entry, def));
    }
  }
  providers.push({
    id: def.id, name: def.name, description: def.description,
    api: def.api ?? models[0]?.api ?? "openai-completions",
    baseUrl: def.baseUrl ?? models[0]?.baseUrl,
    envKeys: def.envKeys, docsUrl: def.docsUrl, ...(def.local ? { local: true } : {}),
    models,
  });
}

const header = `/**
 * 内置厂商目录 —— 自动生成，请勿手改
 *
 * 生成时间：${new Date().toISOString().slice(0, 10)}
 * 数据来源：pi packages/ai/src/providers/data/*.json（上游 models.dev 快照 2026-08-07）
 * 生成脚本：agent/scripts/build-provider-catalog.mjs
 */
import type { BuiltinProviderDef } from "./builtin.ts";

export const BUILTIN_PROVIDER_CATALOG: BuiltinProviderDef[] = ${JSON.stringify(providers, null, 2)};
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, header, "utf8");
console.log(`wrote ${OUT} (${providers.length} providers, ${providers.reduce((n, p) => n + p.models.length, 0)} models)`);
