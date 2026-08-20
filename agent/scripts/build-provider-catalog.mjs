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
    id: "deepseek", file: "deepseek", name: "DeepSeek",
    description: "DeepSeek V4 系列",
    envKeys: ["DEEPSEEK_API_KEY"], docsUrl: "https://platform.deepseek.com",
    pick: ["deepseek-v4-pro", "deepseek-v4-flash"],
  },
  {
    id: "zai-coding-cn", file: "zai-coding-cn", name: "智谱 GLM（国内）",
    description: "GLM 编程套餐 API（国内端点 open.bigmodel.cn）",
    envKeys: ["ZHIPU_API_KEY", "ZAI_API_KEY"], docsUrl: "https://bigmodel.cn",
    pick: ["glm-5.2", "glm-5-turbo", "glm-4.7"],
  },
  {
    id: "openrouter", file: "openrouter", name: "OpenRouter",
    description: "聚合网关，一个密钥访问各家模型",
    envKeys: ["OPENROUTER_API_KEY"], docsUrl: "https://openrouter.ai",
    pick: ["anthropic/claude-sonnet-5", "openai/gpt-5.2", "google/gemini-3.1-pro-preview", "deepseek/deepseek-v4-pro", "moonshotai/kimi-k3", "z-ai/glm-5.2"],
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
