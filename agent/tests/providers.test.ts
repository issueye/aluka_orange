import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_PROVIDER_CATALOG } from "../src/providers/catalog.generated.ts";
import {
  clearProviderRegistry,
  findProviderEntry,
  findProviderModel,
  listProviderViews,
  providerEnvKeys,
  refreshProviderModels,
} from "../src/providers/registry.ts";
import { createExtensionRuntime } from "../src/extensions/loader.ts";
import { lookupProviderModel } from "../src/models-json.ts";
import { resolveApiKey, resolveRuntimeModel } from "../src/models.ts";
import type { Api } from "../src/ai/types.ts";
import type { ProviderModelConfig } from "../src/extensions/types.ts";

const SUPPORTED_APIS: Api[] = ["openai-completions", "openai-responses", "anthropic-messages"];

function tmpAgentDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-providers-"));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 需要保护的厂商环境变量（测试内临时改写，用后还原） */
const ENV_KEYS = ["GEMINI_API_KEY", "DASHSCOPE_API_KEY", "ALUKA_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "NEWAPI_KEY"];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("统一注册表：内置目录完整性", () => {
  it("厂商 id 唯一且模型协议均受支持", () => {
    const ids = BUILTIN_PROVIDER_CATALOG.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const provider of BUILTIN_PROVIDER_CATALOG) {
      expect(provider.api, provider.id).toBeOneOf(SUPPORTED_APIS);
      for (const model of provider.models) {
        expect(model.api, `${provider.id}/${model.id}`).toBeOneOf(SUPPORTED_APIS);
        expect(model.provider, `${provider.id}/${model.id}`).toBe(provider.id);
        expect(model.contextWindow, `${provider.id}/${model.id}`).toBeGreaterThan(0);
        expect(model.maxTokens, `${provider.id}/${model.id}`).toBeGreaterThan(0);
      }
    }
  });

  it("覆盖主流厂商与代表性模型", () => {
    const ids = new Set(BUILTIN_PROVIDER_CATALOG.map((p) => p.id));
    for (const expected of ["openai", "anthropic", "google", "xai", "deepseek", "openrouter", "zai", "moonshotai-cn", "qwen", "ollama"]) {
      expect(ids.has(expected), expected).toBe(true);
    }
    expect(findProviderModel("anthropic", "claude-sonnet-5")?.api).toBe("anthropic-messages");
    expect(findProviderModel("openai", "gpt-5.5")?.api).toBe("openai-responses");
    // 协议改写：google/mistral 走 OpenAI 兼容端点
    expect(findProviderModel("google", "gemini-2.5-pro")?.api).toBe("openai-completions");
    expect(findProviderModel("google", "gemini-2.5-pro")?.baseUrl).toContain("/openai");
  });

  it("跨厂商查同 id：唯一命中返回，多命中视为歧义", () => {
    expect(findProviderModel(undefined, "gpt-5.5")?.provider).toBe("openai");
    // kimi-k3 同时在 moonshotai 与 moonshotai-cn 目录中 → 歧义
    expect(findProviderModel(undefined, "kimi-k3")).toBeUndefined();
  });

  it("视图投影包含来源标记且不泄漏运行时细节", () => {
    const view = listProviderViews();
    expect(view.length).toBeGreaterThanOrEqual(BUILTIN_PROVIDER_CATALOG.length);
    for (const provider of view) {
      expect(Object.keys(provider)).not.toContain("apiKey");
      for (const model of provider.models) {
        expect(Object.keys(model)).not.toContain("cost");
      }
    }
    expect(view.every((p) => p.source === "builtin" || p.source === "extension")).toBe(true);
  });

  it("findProviderEntry 大小写不敏感", () => {
    expect(findProviderEntry("OpenAI")?.id).toBe("openai");
    expect(findProviderEntry("no-such")).toBeUndefined();
  });
});

describe("厂商环境变量映射", () => {
  it("按声明顺序解析第一个可用值", () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    process.env.DASHSCOPE_API_KEY = "sk-dashscope-test";
    expect(providerEnvKeys("qwen")).toEqual(["DASHSCOPE_API_KEY"]);
    expect(resolveApiKey(findProviderModel("qwen", "qwen3.8-max")!)).toBe("sk-dashscope-test");
    expect(resolveApiKey(findProviderModel("openai", "gpt-5.5")!)).toBeUndefined();
  });

  it("resolveApiKey 优先厂商专属环境变量，再走通用回退", () => {
    const googleModel = findProviderModel("google", "gemini-2.5-pro")!;
    delete process.env.ALUKA_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.GEMINI_API_KEY = "gemini-key";
    expect(resolveApiKey(googleModel)).toBe("gemini-key");
    delete process.env.GEMINI_API_KEY;
    process.env.ALUKA_API_KEY = "generic-key";
    expect(resolveApiKey(googleModel)).toBe("generic-key");
  });
});

describe("解析链兜底：models.json 优先，未命中回退注册表", () => {
  it("models.json 无关条目时，settings 的内置厂商模型解析自目录", () => {
    const agentDir = tmpAgentDir();
    const { model, source } = resolveRuntimeModel({
      agentDir,
      settings: { provider: "zai", model: "glm-5.2" },
    });
    expect(source).toBe("builtin-catalog");
    expect(model.provider).toBe("zai");
    expect(model.api).toBe("openai-completions");
    expect(model.baseUrl).toContain("z.ai");
    expect(model.contextWindow).toBeGreaterThan(0);
  });

  it("显式 provider+model 也走目录兜底", () => {
    const agentDir = tmpAgentDir();
    const { model, source } = resolveRuntimeModel({
      agentDir,
      provider: "deepseek",
      model: "deepseek-v4-pro",
    });
    expect(source).toBe("builtin-catalog");
    expect(model.baseUrl).toContain("deepseek");
  });

  it("lookupProviderModel：models.json 命中优先，未命中回退注册表", () => {
    const agentDir = tmpAgentDir();
    fs.writeFileSync(
      path.join(agentDir, "models.json"),
      JSON.stringify({
        providers: {
          anthropic: {
            baseUrl: "https://my-proxy.example/v1",
            api: "anthropic-messages",
            apiKey: "sk-local",
            models: [{ id: "my-claude", name: "My Claude" }],
          },
        },
      }),
      "utf8",
    );
    // models.json 命中：带出代理端点与密钥
    const local = lookupProviderModel(agentDir, "anthropic", "my-claude");
    expect(local?.baseUrl).toBe("https://my-proxy.example/v1");
    expect(local?.apiKey).toBe("sk-local");
    // 同厂商未配置的模型 → 回退内置目录（无密钥，由 env/settings 兜底）
    const builtin = lookupProviderModel(agentDir, "anthropic", "claude-opus-5");
    expect(builtin?.baseUrl).toBe("https://api.anthropic.com");
    expect(builtin?.apiKey).toBeUndefined();
    expect(builtin?.builtin).toBe(true);
    // 空目录时注册表兜底同样生效
    expect(lookupProviderModel(tmpAgentDir(), "google", "gemini-2.5-flash")?.api).toBe("openai-completions");
  });

  it("目录与 models.json 都未命中时回落默认链", () => {
    const agentDir = tmpAgentDir();
    const { model, source } = resolveRuntimeModel({
      agentDir,
      provider: "unknown-vendor",
      model: "whatever",
    });
    expect(source).toBe("env-default");
    expect(model.provider).toBe("unknown-vendor");
    expect(model.api).toBe("openai-completions");
  });
});

describe("扩展动态注册供应商（与内置目录同一注册表）", () => {
  const EXT_MODEL: ProviderModelConfig = {
    id: "gpt-x",
    name: "GPT X",
    reasoning: false,
    input: ["text"],
    cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
  };

  beforeEach(() => {
    clearProviderRegistry();
  });

  afterEach(() => {
    clearProviderRegistry();
  });

  it("runtime.registerProvider 立即生效，密钥支持 $ENV 模板", () => {
    process.env.NEWAPI_KEY = "sk-newapi-test";
    const runtime = createExtensionRuntime();
    runtime.registerProvider("newapi", {
      name: "NewAPI (gw)",
      baseUrl: "https://gw.example/v1",
      api: "openai-completions",
      apiKey: "$NEWAPI_KEY",
      models: [EXT_MODEL],
    }, "/ext/provider-newapi/index.ts");

    expect(findProviderEntry("newapi")?.baseUrl).toBe("https://gw.example/v1");
    const agentDir = tmpAgentDir();
    const found = lookupProviderModel(agentDir, "newapi", "gpt-x");
    expect(found?.apiKey).toBe("sk-newapi-test");
    expect(found?.extension).toBe(true);

    const { model, source } = resolveRuntimeModel({ agentDir, settings: { provider: "newapi", model: "gpt-x" } });
    expect(source).toBe("extension-provider");
    expect(model.baseUrl).toBe("https://gw.example/v1");
    expect(resolveApiKey(model)).toBe("sk-newapi-test");
  });

  it("优先级：models.json > 扩展注册 > 内置目录；扩展覆盖内置后视图切换来源", () => {
    const agentDir = tmpAgentDir();
    // 扩展覆盖内置厂商同 id（自定义 baseUrl 与模型目录）
    const runtime = createExtensionRuntime();
    runtime.registerProvider("zai", {
      baseUrl: "https://zai-proxy.example/api/paas/v4",
      api: "openai-completions",
      models: [{ ...EXT_MODEL, id: "glm-5.2", contextWindow: 111000 }],
    });
    // 扩展覆盖内置
    const override = lookupProviderModel(agentDir, "zai", "glm-5.2");
    expect(override?.baseUrl).toBe("https://zai-proxy.example/api/paas/v4");
    expect(override?.contextWindow).toBe(111000);
    expect(override?.extension).toBe(true);
    // 统一视图中该条目来源变为 extension
    const view = listProviderViews().find((p) => p.id === "zai");
    expect(view?.source).toBe("extension");
    // models.json 命中优先于扩展
    fs.writeFileSync(
      path.join(agentDir, "models.json"),
      JSON.stringify({
        providers: {
          newapi: {
            baseUrl: "https://local.example/v1",
            api: "openai-completions",
            models: [{ id: "gpt-x" }],
          },
        },
      }),
      "utf8",
    );
    runtime.registerProvider("newapi", { baseUrl: "https://gw.example/v1", models: [EXT_MODEL] });
    expect(lookupProviderModel(agentDir, "newapi", "gpt-x")?.baseUrl).toBe("https://local.example/v1");
  });

  it("refreshModels 动态发现并更新模型目录", async () => {
    const runtime = createExtensionRuntime();
    runtime.registerProvider("discovery-gw", {
      baseUrl: "https://discovery.example/v1",
      api: "openai-completions",
      models: [],
      async refreshModels() {
        return [
          { ...EXT_MODEL, id: "m1" },
          { ...EXT_MODEL, id: "m2" },
        ];
      },
    });
    const before = listProviderViews().find((p) => p.id === "discovery-gw");
    expect(before?.refreshable).toBe(true);
    expect(before?.models).toHaveLength(0);

    const models = await refreshProviderModels("discovery-gw");
    expect(models.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(findProviderEntry("discovery-gw")?.models).toHaveLength(2);
    // 动态发现的模型可直接解析使用
    const found = lookupProviderModel(tmpAgentDir(), "discovery-gw", "m1");
    expect(found?.baseUrl).toBe("https://discovery.example/v1");
  });

  it("unregisterProvider 注销扩展后自动还原内置条目", () => {
    const runtime = createExtensionRuntime();
    runtime.registerProvider("zai", { baseUrl: "https://zai-proxy.example", models: [{ ...EXT_MODEL, id: "glm-5.2" }] });
    expect(lookupProviderModel(tmpAgentDir(), "zai", "glm-5.2")?.extension).toBe(true);
    runtime.unregisterProvider("zai");
    const fallback = lookupProviderModel(tmpAgentDir(), "zai", "glm-5.2");
    expect(fallback?.builtin).toBe(true);
    expect(fallback?.baseUrl).toContain("z.ai");
    // 视图来源也还原为 builtin
    expect(listProviderViews().find((p) => p.id === "zai")?.source).toBe("builtin");
  });

  it("视图投影不泄漏密钥", () => {
    const runtime = createExtensionRuntime();
    runtime.registerProvider("newapi", { baseUrl: "https://gw.example/v1", apiKey: "secret", models: [EXT_MODEL] });
    const view = listProviderViews().find((p) => p.id === "newapi");
    expect(view?.source).toBe("extension");
    expect(JSON.stringify(view)).not.toContain("secret");
  });
});
