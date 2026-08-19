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
    "id": "anthropic",
    "name": "Anthropic",
    "description": "Claude 官方 Messages API",
    "api": "anthropic-messages",
    "baseUrl": "https://api.anthropic.com",
    "envKeys": [
      "ANTHROPIC_API_KEY"
    ],
    "docsUrl": "https://console.anthropic.com",
    "models": [
      {
        "id": "claude-opus-5",
        "name": "Claude Opus 5",
        "api": "anthropic-messages",
        "provider": "anthropic",
        "baseUrl": "https://api.anthropic.com",
        "reasoning": true,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25
        },
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "compat": {
          "forceAdaptiveThinking": true,
          "supportsTemperature": false,
          "supportsStrictTools": true
        },
        "thinkingLevelMap": {
          "xhigh": "xhigh",
          "max": "max"
        }
      },
      {
        "id": "claude-sonnet-5",
        "name": "Claude Sonnet 5",
        "api": "anthropic-messages",
        "provider": "anthropic",
        "baseUrl": "https://api.anthropic.com",
        "reasoning": true,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 2,
          "output": 10,
          "cacheRead": 0.2,
          "cacheWrite": 2.5
        },
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "compat": {
          "forceAdaptiveThinking": true,
          "supportsStrictTools": true
        },
        "thinkingLevelMap": {
          "xhigh": "xhigh",
          "max": "max"
        }
      },
      {
        "id": "claude-haiku-4-5",
        "name": "Claude Haiku 4.5 (latest)",
        "api": "anthropic-messages",
        "provider": "anthropic",
        "baseUrl": "https://api.anthropic.com",
        "reasoning": true,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 1,
          "output": 5,
          "cacheRead": 0.1,
          "cacheWrite": 1.25
        },
        "contextWindow": 200000,
        "maxTokens": 64000,
        "compat": {
          "supportsStrictTools": true
        }
      },
      {
        "id": "claude-opus-4-8",
        "name": "Claude Opus 4.8",
        "api": "anthropic-messages",
        "provider": "anthropic",
        "baseUrl": "https://api.anthropic.com",
        "reasoning": true,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 5,
          "output": 25,
          "cacheRead": 0.5,
          "cacheWrite": 6.25
        },
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "compat": {
          "forceAdaptiveThinking": true,
          "supportsTemperature": false,
          "supportsStrictTools": true
        },
        "thinkingLevelMap": {
          "xhigh": "xhigh",
          "max": "max"
        }
      },
      {
        "id": "claude-sonnet-4-6",
        "name": "Claude Sonnet 4.6",
        "api": "anthropic-messages",
        "provider": "anthropic",
        "baseUrl": "https://api.anthropic.com",
        "reasoning": true,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 3,
          "output": 15,
          "cacheRead": 0.3,
          "cacheWrite": 3.75
        },
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "compat": {
          "forceAdaptiveThinking": true,
          "supportsStrictTools": true
        },
        "thinkingLevelMap": {
          "max": "max"
        }
      }
    ]
  },
  {
    "id": "openai",
    "name": "OpenAI",
    "description": "GPT 官方 Responses API",
    "api": "openai-responses",
    "baseUrl": "https://api.openai.com/v1",
    "envKeys": [
      "OPENAI_API_KEY"
    ],
    "docsUrl": "https://platform.openai.com",
    "models": [
      {
        "id": "gpt-5.5",
        "name": "GPT-5.5",
        "api": "openai-responses",
        "provider": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "reasoning": true,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 5,
          "output": 30,
          "cacheRead": 0.5,
          "cacheWrite": 0
        },
        "contextWindow": 272000,
        "maxTokens": 128000,
        "compat": {
          "supportsStrictMode": true,
          "supportsOpenAIGrammarTools": true,
          "supportsToolSearch": true
        },
        "thinkingLevelMap": {
          "off": "none",
          "minimal": null,
          "low": "low",
          "medium": "medium",
          "high": "high",
          "xhigh": "xhigh",
          "max": null
        }
      },
      {
        "id": "gpt-5.5-pro",
        "name": "GPT-5.5 Pro",
        "api": "openai-responses",
        "provider": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "reasoning": true,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 30,
          "output": 180,
          "cacheRead": 0,
          "cacheWrite": 0
        },
        "contextWindow": 1050000,
        "maxTokens": 128000,
        "compat": {
          "supportsStrictMode": true,
          "supportsOpenAIGrammarTools": true
        },
        "thinkingLevelMap": {
          "off": null,
          "minimal": null,
          "low": null,
          "medium": "medium",
          "high": "high",
          "xhigh": "xhigh",
          "max": null
        }
      },
      {
        "id": "gpt-5.2",
        "name": "GPT-5.2",
        "api": "openai-responses",
        "provider": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "reasoning": true,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 1.75,
          "output": 14,
          "cacheRead": 0.175,
          "cacheWrite": 0
        },
        "contextWindow": 400000,
        "maxTokens": 128000,
        "compat": {
          "supportsStrictMode": true,
          "supportsOpenAIGrammarTools": true
        },
        "thinkingLevelMap": {
          "off": "none",
          "minimal": null,
          "low": "low",
          "medium": "medium",
          "high": "high",
          "xhigh": "xhigh",
          "max": null
        }
      },
      {
        "id": "gpt-5.3-codex",
        "name": "GPT-5.3 Codex",
        "api": "openai-responses",
        "provider": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "reasoning": true,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 1.75,
          "output": 14,
          "cacheRead": 0.175,
          "cacheWrite": 0
        },
        "contextWindow": 400000,
        "maxTokens": 128000,
        "compat": {
          "supportsStrictMode": true,
          "supportsOpenAIGrammarTools": true
        },
        "thinkingLevelMap": {
          "off": "none",
          "minimal": null,
          "low": "low",
          "medium": "medium",
          "high": "high",
          "xhigh": "xhigh",
          "max": null
        }
      },
      {
        "id": "gpt-5-mini",
        "name": "GPT-5 Mini",
        "api": "openai-responses",
        "provider": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "reasoning": true,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 0.25,
          "output": 2,
          "cacheRead": 0.025,
          "cacheWrite": 0
        },
        "contextWindow": 400000,
        "maxTokens": 128000,
        "compat": {
          "supportsStrictMode": true,
          "supportsOpenAIGrammarTools": true
        },
        "thinkingLevelMap": {
          "off": null,
          "minimal": "minimal",
          "low": "low",
          "medium": "medium",
          "high": "high",
          "xhigh": null,
          "max": null
        }
      },
      {
        "id": "gpt-4.1",
        "name": "GPT-4.1",
        "api": "openai-responses",
        "provider": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "reasoning": false,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 2,
          "output": 8,
          "cacheRead": 0.5,
          "cacheWrite": 0
        },
        "contextWindow": 1047576,
        "maxTokens": 32768,
        "compat": {
          "supportsStrictMode": true
        }
      }
    ]
  },
  {
    "id": "google",
    "name": "Google Gemini",
    "description": "Gemini 系列经 OpenAI 兼容端点接入",
    "api": "openai-completions",
    "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
    "envKeys": [
      "GEMINI_API_KEY",
      "GOOGLE_API_KEY"
    ],
    "docsUrl": "https://aistudio.google.com",
    "models": [
      {
        "id": "gemini-3.6-flash",
        "name": "Gemini 3.6 Flash",
        "api": "openai-completions",
        "provider": "google",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
        "reasoning": true,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 1.5,
          "output": 7.5,
          "cacheRead": 0.15,
          "cacheWrite": 0
        },
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "thinkingLevelMap": {
          "off": null
        }
      },
      {
        "id": "gemini-3.5-flash",
        "name": "Gemini 3.5 Flash",
        "api": "openai-completions",
        "provider": "google",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
        "reasoning": true,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 1.5,
          "output": 9,
          "cacheRead": 0.15,
          "cacheWrite": 0
        },
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "thinkingLevelMap": {
          "off": null
        }
      },
      {
        "id": "gemini-3.1-pro-preview",
        "name": "Gemini 3.1 Pro Preview",
        "api": "openai-completions",
        "provider": "google",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
        "reasoning": true,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 2,
          "output": 12,
          "cacheRead": 0.2,
          "cacheWrite": 0
        },
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "thinkingLevelMap": {
          "off": null,
          "minimal": null,
          "low": "LOW",
          "medium": null,
          "high": "HIGH"
        }
      },
      {
        "id": "gemini-3-pro-preview",
        "name": "Gemini 3 Pro Preview",
        "api": "openai-completions",
        "provider": "google",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
        "reasoning": true,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 2,
          "output": 12,
          "cacheRead": 0.2,
          "cacheWrite": 0
        },
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "thinkingLevelMap": {
          "off": null,
          "minimal": null,
          "low": "LOW",
          "medium": null,
          "high": "HIGH"
        }
      },
      {
        "id": "gemini-2.5-pro",
        "name": "Gemini 2.5 Pro",
        "api": "openai-completions",
        "provider": "google",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
        "reasoning": true,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 1.25,
          "output": 10,
          "cacheRead": 0.125,
          "cacheWrite": 0
        },
        "contextWindow": 1048576,
        "maxTokens": 65536
      },
      {
        "id": "gemini-2.5-flash",
        "name": "Gemini 2.5 Flash",
        "api": "openai-completions",
        "provider": "google",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
        "reasoning": true,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 0.3,
          "output": 2.5,
          "cacheRead": 0.03,
          "cacheWrite": 0
        },
        "contextWindow": 1048576,
        "maxTokens": 65536
      }
    ]
  },
  {
    "id": "xai",
    "name": "xAI Grok",
    "description": "Grok 官方 API（各模型沿用自身协议）",
    "api": "openai-responses",
    "baseUrl": "https://api.x.ai/v1",
    "envKeys": [
      "XAI_API_KEY"
    ],
    "docsUrl": "https://console.x.ai",
    "models": [
      {
        "id": "grok-4.5",
        "name": "Grok 4.5",
        "api": "openai-responses",
        "provider": "xai",
        "baseUrl": "https://api.x.ai/v1",
        "reasoning": true,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 2,
          "output": 6,
          "cacheRead": 0.3,
          "cacheWrite": 0
        },
        "contextWindow": 500000,
        "maxTokens": 500000,
        "compat": {
          "supportsLongCacheRetention": false
        },
        "thinkingLevelMap": {
          "off": null,
          "minimal": null,
          "low": "low",
          "medium": "medium",
          "high": "high",
          "xhigh": null,
          "max": null
        }
      },
      {
        "id": "grok-4.3",
        "name": "Grok 4.3",
        "api": "openai-completions",
        "provider": "xai",
        "baseUrl": "https://api.x.ai/v1",
        "reasoning": true,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 1.25,
          "output": 2.5,
          "cacheRead": 0.2,
          "cacheWrite": 0
        },
        "contextWindow": 1000000,
        "maxTokens": 30000,
        "compat": {
          "supportsStore": false,
          "supportsDeveloperRole": false,
          "supportsReasoningEffort": false
        }
      }
    ]
  },
  {
    "id": "groq",
    "name": "Groq",
    "description": "超低延迟推理云（Llama / gpt-oss 等）",
    "api": "openai-completions",
    "baseUrl": "https://api.groq.com/openai/v1",
    "envKeys": [
      "GROQ_API_KEY"
    ],
    "docsUrl": "https://console.groq.com",
    "models": [
      {
        "id": "llama-3.3-70b-versatile",
        "name": "Llama 3.3 70B",
        "api": "openai-completions",
        "provider": "groq",
        "baseUrl": "https://api.groq.com/openai/v1",
        "reasoning": false,
        "input": [
          "text"
        ],
        "cost": {
          "input": 0.59,
          "output": 0.79,
          "cacheRead": 0,
          "cacheWrite": 0
        },
        "contextWindow": 131072,
        "maxTokens": 32768
      },
      {
        "id": "openai/gpt-oss-120b",
        "name": "GPT OSS 120B",
        "api": "openai-completions",
        "provider": "groq",
        "baseUrl": "https://api.groq.com/openai/v1",
        "reasoning": true,
        "input": [
          "text"
        ],
        "cost": {
          "input": 0.15,
          "output": 0.6,
          "cacheRead": 0.075,
          "cacheWrite": 0
        },
        "contextWindow": 131072,
        "maxTokens": 65536,
        "thinkingLevelMap": {
          "off": null,
          "minimal": null,
          "low": "low",
          "medium": "medium",
          "high": "high",
          "xhigh": null,
          "max": null
        }
      },
      {
        "id": "openai/gpt-oss-20b",
        "name": "GPT OSS 20B",
        "api": "openai-completions",
        "provider": "groq",
        "baseUrl": "https://api.groq.com/openai/v1",
        "reasoning": true,
        "input": [
          "text"
        ],
        "cost": {
          "input": 0.075,
          "output": 0.3,
          "cacheRead": 0.0375,
          "cacheWrite": 0
        },
        "contextWindow": 131072,
        "maxTokens": 65536,
        "thinkingLevelMap": {
          "off": null,
          "minimal": null,
          "low": "low",
          "medium": "medium",
          "high": "high",
          "xhigh": null,
          "max": null
        }
      },
      {
        "id": "qwen/qwen3.6-27b",
        "name": "Qwen3.6 27B",
        "api": "openai-completions",
        "provider": "groq",
        "baseUrl": "https://api.groq.com/openai/v1",
        "reasoning": true,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 0.6,
          "output": 3,
          "cacheRead": 0.3,
          "cacheWrite": 0
        },
        "contextWindow": 131072,
        "maxTokens": 16384,
        "thinkingLevelMap": {
          "off": "none",
          "minimal": null,
          "low": null,
          "medium": null,
          "high": "default",
          "xhigh": null,
          "max": null
        }
      }
    ]
  },
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
    "id": "moonshotai",
    "name": "Moonshot Kimi",
    "description": "Kimi 官方 API（国际端点 api.moonshot.ai）",
    "api": "openai-completions",
    "baseUrl": "https://api.moonshot.ai/v1",
    "envKeys": [
      "MOONSHOT_API_KEY"
    ],
    "docsUrl": "https://platform.moonshot.ai",
    "models": [
      {
        "id": "kimi-k3",
        "name": "Kimi K3",
        "api": "openai-completions",
        "provider": "moonshotai",
        "baseUrl": "https://api.moonshot.ai/v1",
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
        "provider": "moonshotai",
        "baseUrl": "https://api.moonshot.ai/v1",
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
        "provider": "moonshotai",
        "baseUrl": "https://api.moonshot.ai/v1",
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
    "id": "zai",
    "name": "智谱 GLM",
    "description": "GLM 编程套餐 API（国际端点 api.z.ai）",
    "api": "openai-completions",
    "baseUrl": "https://api.z.ai/api/coding/paas/v4",
    "envKeys": [
      "ZAI_API_KEY",
      "ZHIPU_API_KEY"
    ],
    "docsUrl": "https://z.ai",
    "models": [
      {
        "id": "glm-5.2",
        "name": "GLM-5.2",
        "api": "openai-completions",
        "provider": "zai",
        "baseUrl": "https://api.z.ai/api/coding/paas/v4",
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
        "provider": "zai",
        "baseUrl": "https://api.z.ai/api/coding/paas/v4",
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
        "provider": "zai",
        "baseUrl": "https://api.z.ai/api/coding/paas/v4",
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
    "id": "minimax",
    "name": "MiniMax",
    "description": "MiniMax M 系列（Anthropic 兼容端点）",
    "api": "anthropic-messages",
    "baseUrl": "https://api.minimax.io/anthropic",
    "envKeys": [
      "MINIMAX_API_KEY"
    ],
    "docsUrl": "https://www.minimax.io",
    "models": [
      {
        "id": "MiniMax-M3",
        "name": "MiniMax-M3",
        "api": "anthropic-messages",
        "provider": "minimax",
        "baseUrl": "https://api.minimax.io/anthropic",
        "reasoning": true,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 0.3,
          "output": 1.2,
          "cacheRead": 0.06,
          "cacheWrite": 0
        },
        "contextWindow": 1000000,
        "maxTokens": 128000
      },
      {
        "id": "MiniMax-M2.7",
        "name": "MiniMax-M2.7",
        "api": "anthropic-messages",
        "provider": "minimax",
        "baseUrl": "https://api.minimax.io/anthropic",
        "reasoning": true,
        "input": [
          "text"
        ],
        "cost": {
          "input": 0.3,
          "output": 1.2,
          "cacheRead": 0.06,
          "cacheWrite": 0.375
        },
        "contextWindow": 204800,
        "maxTokens": 131072
      }
    ]
  },
  {
    "id": "minimax-cn",
    "name": "MiniMax（国内）",
    "description": "MiniMax M 系列（国内端点 api.minimaxi.com）",
    "api": "anthropic-messages",
    "baseUrl": "https://api.minimaxi.com/anthropic",
    "envKeys": [
      "MINIMAX_API_KEY"
    ],
    "docsUrl": "https://www.minimaxi.com",
    "models": [
      {
        "id": "MiniMax-M3",
        "name": "MiniMax-M3",
        "api": "anthropic-messages",
        "provider": "minimax-cn",
        "baseUrl": "https://api.minimaxi.com/anthropic",
        "reasoning": true,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 0.3,
          "output": 1.2,
          "cacheRead": 0.06,
          "cacheWrite": 0
        },
        "contextWindow": 1000000,
        "maxTokens": 128000
      },
      {
        "id": "MiniMax-M2.7",
        "name": "MiniMax-M2.7",
        "api": "anthropic-messages",
        "provider": "minimax-cn",
        "baseUrl": "https://api.minimaxi.com/anthropic",
        "reasoning": true,
        "input": [
          "text"
        ],
        "cost": {
          "input": 0.3,
          "output": 1.2,
          "cacheRead": 0.06,
          "cacheWrite": 0.375
        },
        "contextWindow": 204800,
        "maxTokens": 131072
      }
    ]
  },
  {
    "id": "mistral",
    "name": "Mistral",
    "description": "Mistral 系列经 OpenAI 兼容端点接入",
    "api": "openai-completions",
    "baseUrl": "https://api.mistral.ai/v1",
    "envKeys": [
      "MISTRAL_API_KEY"
    ],
    "docsUrl": "https://console.mistral.ai",
    "models": [
      {
        "id": "mistral-large-latest",
        "name": "Mistral Large (latest)",
        "api": "openai-completions",
        "provider": "mistral",
        "baseUrl": "https://api.mistral.ai/v1",
        "reasoning": false,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 0.5,
          "output": 1.5,
          "cacheRead": 0.05,
          "cacheWrite": 0
        },
        "contextWindow": 262144,
        "maxTokens": 262144
      },
      {
        "id": "devstral-latest",
        "name": "Devstral 2",
        "api": "openai-completions",
        "provider": "mistral",
        "baseUrl": "https://api.mistral.ai/v1",
        "reasoning": false,
        "input": [
          "text"
        ],
        "cost": {
          "input": 0.4,
          "output": 2,
          "cacheRead": 0.04,
          "cacheWrite": 0
        },
        "contextWindow": 262144,
        "maxTokens": 262144
      },
      {
        "id": "magistral-medium-latest",
        "name": "Magistral Medium (latest)",
        "api": "openai-completions",
        "provider": "mistral",
        "baseUrl": "https://api.mistral.ai/v1",
        "reasoning": true,
        "input": [
          "text"
        ],
        "cost": {
          "input": 2,
          "output": 5,
          "cacheRead": 0.2,
          "cacheWrite": 0
        },
        "contextWindow": 128000,
        "maxTokens": 16384
      },
      {
        "id": "codestral-latest",
        "name": "Codestral (latest)",
        "api": "openai-completions",
        "provider": "mistral",
        "baseUrl": "https://api.mistral.ai/v1",
        "reasoning": false,
        "input": [
          "text"
        ],
        "cost": {
          "input": 0.3,
          "output": 0.9,
          "cacheRead": 0.03,
          "cacheWrite": 0
        },
        "contextWindow": 256000,
        "maxTokens": 4096
      }
    ]
  },
  {
    "id": "openrouter",
    "name": "OpenRouter",
    "description": "聚合网关，一个密钥访问各家模型",
    "api": "openai-completions",
    "baseUrl": "https://openrouter.ai/api/v1",
    "envKeys": [
      "OPENROUTER_API_KEY"
    ],
    "docsUrl": "https://openrouter.ai",
    "models": [
      {
        "id": "anthropic/claude-sonnet-5",
        "name": "Anthropic: Claude Sonnet 5",
        "api": "openai-completions",
        "provider": "openrouter",
        "baseUrl": "https://openrouter.ai/api/v1",
        "reasoning": true,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 2,
          "output": 10,
          "cacheRead": 0.2,
          "cacheWrite": 2.5
        },
        "contextWindow": 1000000,
        "maxTokens": 128000,
        "compat": {
          "thinkingFormat": "openrouter",
          "cacheControlFormat": "anthropic"
        },
        "thinkingLevelMap": {
          "xhigh": "xhigh",
          "max": "max"
        }
      },
      {
        "id": "openai/gpt-5.2",
        "name": "OpenAI: GPT-5.2",
        "api": "openai-completions",
        "provider": "openrouter",
        "baseUrl": "https://openrouter.ai/api/v1",
        "reasoning": true,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 1.75,
          "output": 14,
          "cacheRead": 0.175,
          "cacheWrite": 0
        },
        "contextWindow": 400000,
        "maxTokens": 128000,
        "compat": {
          "thinkingFormat": "openrouter"
        },
        "thinkingLevelMap": {
          "xhigh": "xhigh"
        }
      },
      {
        "id": "google/gemini-3.1-pro-preview",
        "name": "Google: Gemini 3.1 Pro Preview",
        "api": "openai-completions",
        "provider": "openrouter",
        "baseUrl": "https://openrouter.ai/api/v1",
        "reasoning": true,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 2,
          "output": 12,
          "cacheRead": 0.2,
          "cacheWrite": 0.375
        },
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "compat": {
          "supportsDeveloperRole": false,
          "thinkingFormat": "openrouter"
        }
      },
      {
        "id": "deepseek/deepseek-v4-pro",
        "name": "DeepSeek: DeepSeek V4 Pro",
        "api": "openai-completions",
        "provider": "openrouter",
        "baseUrl": "https://openrouter.ai/api/v1",
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
        "contextWindow": 1048576,
        "maxTokens": 384000,
        "compat": {
          "supportsDeveloperRole": false,
          "thinkingFormat": "openrouter",
          "requiresReasoningContentOnAssistantMessages": true
        },
        "thinkingLevelMap": {
          "minimal": null,
          "low": null,
          "medium": null,
          "high": "high",
          "max": null,
          "xhigh": "xhigh"
        }
      },
      {
        "id": "moonshotai/kimi-k3",
        "name": "MoonshotAI: Kimi K3",
        "api": "openai-completions",
        "provider": "openrouter",
        "baseUrl": "https://openrouter.ai/api/v1",
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
          "supportsDeveloperRole": false,
          "thinkingFormat": "openrouter"
        }
      },
      {
        "id": "z-ai/glm-5.2",
        "name": "Z.ai: GLM 5.2",
        "api": "openai-completions",
        "provider": "openrouter",
        "baseUrl": "https://openrouter.ai/api/v1",
        "reasoning": true,
        "input": [
          "text"
        ],
        "cost": {
          "input": 0.6902,
          "output": 2.1692,
          "cacheRead": 0.12818,
          "cacheWrite": 0
        },
        "contextWindow": 1048576,
        "maxTokens": 131072,
        "compat": {
          "supportsDeveloperRole": false,
          "thinkingFormat": "openrouter"
        },
        "thinkingLevelMap": {
          "xhigh": "xhigh"
        }
      }
    ]
  },
  {
    "id": "qwen",
    "name": "阿里云百炼 Qwen",
    "description": "Qwen 系列经 DashScope OpenAI 兼容端点接入",
    "api": "openai-completions",
    "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "envKeys": [
      "DASHSCOPE_API_KEY"
    ],
    "docsUrl": "https://bailian.console.aliyun.com",
    "models": [
      {
        "id": "qwen3.8-max",
        "name": "Qwen3.8 Max",
        "api": "openai-completions",
        "provider": "qwen",
        "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "reasoning": true,
        "input": [
          "text",
          "image"
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
          "thinkingFormat": "qwen",
          "supportsDeveloperRole": false,
          "supportsStore": false,
          "supportsReasoningEffort": true
        },
        "thinkingLevelMap": {
          "minimal": null,
          "low": "low",
          "medium": "medium",
          "high": null,
          "xhigh": "xhigh",
          "max": null
        }
      },
      {
        "id": "qwen3.7-plus",
        "name": "Qwen3.7 Plus",
        "api": "openai-completions",
        "provider": "qwen",
        "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "reasoning": true,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 0,
          "output": 0,
          "cacheRead": 0,
          "cacheWrite": 0
        },
        "contextWindow": 1000000,
        "maxTokens": 65536,
        "compat": {
          "thinkingFormat": "qwen",
          "supportsDeveloperRole": false,
          "supportsStore": false,
          "supportsReasoningEffort": false
        }
      },
      {
        "id": "qwen3.6-flash",
        "name": "Qwen3.6 Flash",
        "api": "openai-completions",
        "provider": "qwen",
        "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "reasoning": true,
        "input": [
          "text",
          "image"
        ],
        "cost": {
          "input": 0,
          "output": 0,
          "cacheRead": 0,
          "cacheWrite": 0
        },
        "contextWindow": 1000000,
        "maxTokens": 65536,
        "compat": {
          "thinkingFormat": "qwen",
          "supportsDeveloperRole": false,
          "supportsStore": false,
          "supportsReasoningEffort": false
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
