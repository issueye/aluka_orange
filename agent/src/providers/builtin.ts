/**
 * 内置厂商目录类型定义
 *
 * 目录数据在 catalog.generated.ts（由 scripts/build-provider-catalog.mjs
 * 从 pi 的 models.dev 快照生成），运行时经 providers/registry.ts 的
 * 统一注册管道灌入 —— 与扩展 registerProvider 同一条链路。
 */

import type { Api, Model } from "../ai/types.ts";

export interface BuiltinProviderDef {
  id: string;
  name: string;
  description: string;
  /** 厂商默认协议（模型条目可逐个覆盖，如 xai 的 grok-4.5 走 responses） */
  api: Api;
  baseUrl?: string;
  /** 依次尝试的 API Key 环境变量 */
  envKeys: string[];
  docsUrl?: string;
  /** 本地/自托管端点（无需密钥，UI 提示从接口拉取模型） */
  local?: boolean;
  models: Model[];
}

/** 模型的 UI 投影（不含 cost/compat 等运行时细节） */
export interface BuiltinModelView {
  id: string;
  name: string;
  api: Api;
  reasoning: boolean;
  input: Array<"text" | "image">;
  contextWindow: number;
  maxTokens: number;
}

/** 厂商的 UI 投影（永不包含密钥信息，只提示环境变量名） */
export interface BuiltinProviderView {
  id: string;
  name: string;
  description: string;
  api: Api;
  baseUrl?: string;
  envKeys: string[];
  docsUrl?: string;
  /** 本地/自托管端点（无需密钥，UI 提示从接口拉取模型） */
  local?: boolean;
  models: BuiltinModelView[];
  /** 条目来源：内置目录或扩展动态注册 */
  source: "builtin" | "extension";
  /** 扩展声明了 refreshModels，支持动态发现模型 */
  refreshable?: boolean;
  /** 注册来源扩展路径（source=extension 时） */
  extensionPath?: string;
}
