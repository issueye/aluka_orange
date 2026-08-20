/**
 * 内置厂商目录 —— 自动生成，请勿手改
 *
 * 生成时间：2026-08-19
 * 数据来源：pi packages/ai/src/providers/data/*.json（上游 models.dev 快照 2026-08-07）
 * 生成脚本：agent/scripts/build-provider-catalog.mjs
 */
import type { BuiltinProviderDef } from "./builtin.ts";

export const BUILTIN_PROVIDER_CATALOG: BuiltinProviderDef[] = [
  {
    "id": "deepseek",
    "name": "DeepSeek",
    "description": "DeepSeek V4 系列",
    "api": "openai-completions",
    "baseUrl": "https://api.deepseek.com",
    "envKeys": [
      "DEEPSEEK_API_KEY"
    ],
    "docsUrl": "https://platform.deepseek.com",
    "models": [
      {
        "id": "deepseek-v4-pro",
        "name": "DeepSeek V4 Pro",
        "api": "openai-completions",
        "provider": "deepseek",
        "baseUrl": "https://api.deepseek.com",
        "reasoning": true,
        "input": [
          "text"
        ],
        "cost": {
          "input": 0.435,
          "output": 0.87,
          "cacheRead": 0.003625,
          "cacheWrite": 0
        },
        "contextWindow": 1000000,
        "maxTokens": 384000,
        "compat": {
          "supportsStore": false,
          "supportsDeveloperRole": false,
          "requiresReasoningContentOnAssistantMessages": true,
          "thinkingFormat": "deepseek"
        },
        "thinkingLevelMap": {
          "minimal": null,
          "low": null,
          "medium": null,
          "high": "high",
          "max": "max"
        }
      },
      {
        "id": "deepseek-v4-flash",
        "name": "DeepSeek V4 Flash",
        "api": "openai-completions",
        "provider": "deepseek",
        "baseUrl": "https://api.deepseek.com",
        "reasoning": true,
        "input": [
          "text"
        ],
        "cost": {
          "input": 0.14,
          "output": 0.28,
          "cacheRead": 0.0028,
          "cacheWrite": 0
        },
        "contextWindow": 1000000,
        "maxTokens": 384000,
        "compat": {
          "supportsStore": false,
          "supportsDeveloperRole": false,
          "requiresReasoningContentOnAssistantMessages": true,
          "thinkingFormat": "deepseek"
        },
        "thinkingLevelMap": {
          "minimal": null,
          "low": null,
          "medium": null,
          "high": "high",
          "max": "max"
        }
      }
    ]
  },
  {
    "id": "moonshotai-cn",
    "name": "Moonshot Kimi（国内）",
    "description": "Kimi 官方 API（国内端点 api.moonshot.cn）",
    "api": "openai-completions",
    "baseUrl": "https://api.moonshot.cn/v1",
    "envKeys": [
      "MOONSHOT_API_KEY"
    ],
    "docsUrl": "https://platform.moonshot.cn",
    "models": [
      {
        "id": "kimi-k3",
        "name": "Kimi K3",
        "api": "openai-completions",
        "provider": "moonshotai-cn",
        "baseUrl": "https://api.moonshot.cn/v1",
        "reasoning": true,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 3,
          "output": 15,
          "cacheRead": 0.3,
          "cacheWrite": 0
        },
        "contextWindow": 1048576,
        "maxTokens": 131072,
        "compat": {
          "supportsStore": false,
          "supportsDeveloperRole": false,
          "supportsReasoningEffort": true,
          "maxTokensField": "max_tokens",
          "supportsStrictMode": false,
          "thinkingFormat": "openai",
          "requiresReasoningContentOnAssistantMessages": true,
          "deferredToolsMode": "kimi"
        },
        "thinkingLevelMap": {
          "off": null,
          "minimal": null,
          "low": "low",
          "medium": null,
          "high": "high",
          "xhigh": null,
          "max": "max"
        }
      },
      {
        "id": "kimi-k2.7-code",
        "name": "Kimi K2.7 Code",
        "api": "openai-completions",
        "provider": "moonshotai-cn",
        "baseUrl": "https://api.moonshot.cn/v1",
        "reasoning": true,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 0.95,
          "output": 4,
          "cacheRead": 0.19,
          "cacheWrite": 0
        },
        "contextWindow": 262144,
        "maxTokens": 262144,
        "compat": {
          "supportsStore": false,
          "supportsDeveloperRole": false,
          "supportsReasoningEffort": false,
          "maxTokensField": "max_tokens",
          "supportsStrictMode": false,
          "thinkingFormat": "deepseek"
        },
        "thinkingLevelMap": {
          "off": null
        }
      },
      {
        "id": "kimi-k2.6",
        "name": "Kimi K2.6",
        "api": "openai-completions",
        "provider": "moonshotai-cn",
        "baseUrl": "https://api.moonshot.cn/v1",
        "reasoning": true,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 0.95,
          "output": 4,
          "cacheRead": 0.16,
          "cacheWrite": 0
        },
        "contextWindow": 262144,
        "maxTokens": 262144,
        "compat": {
          "supportsStore": false,
          "supportsDeveloperRole": false,
          "supportsReasoningEffort": false,
          "maxTokensField": "max_tokens",
          "supportsStrictMode": false,
          "thinkingFormat": "deepseek"
        }
      }
    ]
  },
  {
    "id": "zai-coding-cn",
    "name": "智谱 GLM（国内）",
    "description": "GLM 编程套餐 API（国内端点 open.bigmodel.cn）",
    "api": "openai-completions",
    "baseUrl": "https://open.bigmodel.cn/api/coding/paas/v4",
    "envKeys": [
      "ZHIPU_API_KEY",
      "ZAI_API_KEY"
    ],
    "docsUrl": "https://bigmodel.cn",
    "models": [
      {
        "id": "glm-5.2",
        "name": "GLM-5.2",
        "api": "openai-completions",
        "provider": "zai-coding-cn",
        "baseUrl": "https://open.bigmodel.cn/api/coding/paas/v4",
        "reasoning": true,
        "input": [
          "text"
        ],
        "cost": {
          "input": 0,
          "output": 0,
          "cacheRead": 0,
          "cacheWrite": 0
        },
        "contextWindow": 1000000,
        "maxTokens": 131072,
        "compat": {
          "supportsStore": false,
          "supportsDeveloperRole": false,
          "supportsReasoningEffort": true,
          "maxTokensField": "max_tokens",
          "thinkingFormat": "zai",
          "zaiToolStream": true
        },
        "thinkingLevelMap": {
          "minimal": null,
          "low": "high",
          "medium": "high",
          "high": "high",
          "max": "max"
        }
      },
      {
        "id": "glm-5-turbo",
        "name": "GLM-5-Turbo",
        "api": "openai-completions",
        "provider": "zai-coding-cn",
        "baseUrl": "https://open.bigmodel.cn/api/coding/paas/v4",
        "reasoning": true,
        "input": [
          "text"
        ],
        "cost": {
          "input": 0,
          "output": 0,
          "cacheRead": 0,
          "cacheWrite": 0
        },
        "contextWindow": 200000,
        "maxTokens": 131072,
        "compat": {
          "supportsStore": false,
          "supportsDeveloperRole": false,
          "supportsReasoningEffort": false,
          "maxTokensField": "max_tokens",
          "thinkingFormat": "zai",
          "zaiToolStream": true
        }
      },
      {
        "id": "glm-4.7",
        "name": "GLM-4.7",
        "api": "openai-completions",
        "provider": "zai-coding-cn",
        "baseUrl": "https://open.bigmodel.cn/api/coding/paas/v4",
        "reasoning": true,
        "input": [
          "text"
        ],
        "cost": {
          "input": 0,
          "output": 0,
          "cacheRead": 0,
          "cacheWrite": 0
        },
        "contextWindow": 204800,
        "maxTokens": 131072,
        "compat": {
          "supportsStore": false,
          "supportsDeveloperRole": false,
          "supportsReasoningEffort": false,
          "maxTokensField": "max_tokens",
          "thinkingFormat": "zai",
          "zaiToolStream": true
        }
      }
    ]
  },
  {
    "id": "ollama",
    "name": "Ollama（本地）",
    "description": "本地模型运行时，无需密钥，模型从接口拉取",
    "api": "openai-completions",
    "baseUrl": "http://127.0.0.1:11434/v1",
    "envKeys": [],
    "docsUrl": "https://ollama.com",
    "local": true,
    "models": []
  }
];
