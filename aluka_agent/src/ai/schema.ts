/**
 * Schema 工具模块
 *
 * 提供 TypeBox Schema 与 JSON Schema 之间的转换，
 * 以及工具参数的运行时校验功能。
 */

import type { TSchema } from "typebox";
import { Value } from "typebox/value";

/**
 * 将 TypeBox Schema 转换为 JSON Schema
 *
 * TypeBox 生成的 Schema 包含 $id 和 $schema 等字段，
 * 而 LLM API 需要的是标准 JSON Schema 格式。
 * 此函数会自动去除这些额外字段。
 *
 * @returns 标准 JSON Schema 对象；若输入不是合法 Schema 则返回通用 object schema
 */
export function typeboxToJsonSchema(schema: unknown): Record<string, unknown> {
  if (schema && typeof schema === "object") {
    const record = schema as Record<string, unknown>;
    if (record.type || record.properties || record.$schema) {
      const { $id: _id, $schema: _schema, ...rest } = record;
      return rest as Record<string, unknown>;
    }
  }
  // 回退：返回允许任意属性的空对象 schema
  return { type: "object", properties: {}, additionalProperties: true };
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
