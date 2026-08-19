/**
 * Schema 工具模块
 *
 * 提供 TypeBox Schema 与 JSON Schema 之间的转换，
 * 以及工具参数的运行时校验功能。
 */

import type { TSchema } from "typebox";
import { Value } from "typebox/value";

/**
 * Console Go / DeepSeek 工具 schema 白名单。
 * `minimum` / `anyOf` / `additionalProperties` 等都会触发 unsupported_keyword。
 */
const TOOL_SCHEMA_KEYS = new Set([
  "type",
  "properties",
  "required",
  "description",
  "items",
  "enum",
]);

const EMPTY_OBJECT_SCHEMA: Record<string, unknown> = { type: "object", properties: {} };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * 将 TypeBox Schema 转换为工具调用可用的 JSON Schema。
 *
 * 会去掉 TypeBox 元数据（$id / $schema / ~kind）以及网关不支持的关键字
 *（additionalProperties、minimum、anyOf 等）。
 */
export function typeboxToJsonSchema(schema: unknown): Record<string, unknown> {
  const sanitized = sanitizeToolJsonSchema(schema);
  if (isRecord(sanitized) && (sanitized.type || sanitized.properties)) return sanitized;
  return { ...EMPTY_OBJECT_SCHEMA };
}

/** 把 anyOf/oneOf/allOf 收成单一 schema，优先保留 object 分支 */
function flattenComposition(src: Record<string, unknown>): unknown | undefined {
  const union = src.anyOf ?? src.oneOf ?? src.allOf;
  if (!Array.isArray(union) || union.length === 0) return undefined;
  const branches = union.map(sanitizeToolJsonSchema).filter(isRecord);
  if (branches.length === 0) return undefined;
  const objectBranch = branches.find((branch) => branch.type === "object" || branch.properties);
  const picked: Record<string, unknown> = { ...(objectBranch ?? branches[0]) };
  if (typeof src.description === "string") picked.description = src.description;
  if (typeof src.type === "string") picked.type = src.type;
  return sanitizeToolJsonSchema(picked);
}

/** 递归清洗工具 JSON Schema，只保留白名单关键字 */
export function sanitizeToolJsonSchema(input: unknown): unknown {
  if (Array.isArray(input)) return input.map((item) => sanitizeToolJsonSchema(item));
  if (!isRecord(input)) return input;

  const flattened = flattenComposition(input);
  if (flattened !== undefined) return flattened;

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(input)) {
    if (!TOOL_SCHEMA_KEYS.has(key)) continue;
    const value = input[key];
    if (key === "properties" && isRecord(value)) {
      const properties: Record<string, unknown> = {};
      for (const [name, nested] of Object.entries(value)) {
        properties[name] = sanitizeToolJsonSchema(nested);
      }
      out.properties = properties;
      continue;
    }
    if (key === "required" && Array.isArray(value)) {
      out.required = value.filter((item) => typeof item === "string");
      continue;
    }
    if (key === "enum" || key === "type") {
      out[key] = value;
      continue;
    }
    if (key === "items" && Array.isArray(value)) {
      out.items = value.length ? sanitizeToolJsonSchema(value[0]) : {};
      continue;
    }
    out[key] = sanitizeToolJsonSchema(value);
  }
  return out;
}

/**
 * 使用 TypeBox Schema 校验工具参数
 *
 * 如果参数不匹配 Schema，会抛出包含第一个错误信息的异常。
 * 如果 Schema 无效或不存在，直接返回原始参数（不做校验）。
 *
 * @param schema - TypeBox Schema 或任意值
 * @param args - 待校验的工具参数
 * @returns 校验通过的参数（类型为 T）
 */
export function validateArgs<T>(schema: TSchema | unknown, args: unknown): T {
  if (!schema || typeof schema !== "object") return args as T;
  try {
    const errors = [...Value.Errors(schema as TSchema, args ?? {})];
    if (errors.length > 0) {
      const first = errors[0] as { path?: string; message: string };
      throw new Error(`Invalid tool arguments at ${first.path || "/"}: ${first.message}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Invalid tool arguments")) throw error;
  }
  return args as T;
}
