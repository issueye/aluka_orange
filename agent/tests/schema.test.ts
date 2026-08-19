import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import { sanitizeToolJsonSchema, typeboxToJsonSchema } from "../src/ai/schema.ts";

describe("tool json schema", () => {
  it("strips typebox metadata and unsupported keywords", () => {
    const schema = typeboxToJsonSchema({
      type: "object",
      $id: "Read",
      $schema: "https://json-schema.org/draft/2020-12/schema",
      "~kind": "Object",
      additionalProperties: false,
      properties: {
        path: { type: "string", description: "Path", "~kind": "String", $id: "p" },
        offset: { type: "number", description: "Start" },
      },
      required: ["path"],
    });
    expect(schema).toEqual({
      type: "object",
      properties: {
        path: { type: "string", description: "Path" },
        offset: { type: "number", description: "Start" },
      },
      required: ["path"],
    });
    expect(JSON.stringify(schema)).not.toContain("~kind");
    expect(JSON.stringify(schema)).not.toContain("additionalProperties");
  });

  it("strips minimum and flattens anyOf for Console Go", () => {
    const schema = typeboxToJsonSchema({
      type: "object",
      properties: {
        timeoutMs: { type: "number", minimum: 1, description: "timeout" },
        args: {
          description: "Tool arguments",
          anyOf: [
            { type: "string", description: "JSON string" },
            { type: "object", properties: {}, description: "object" },
          ],
        },
      },
    });
    expect(schema).toEqual({
      type: "object",
      properties: {
        timeoutMs: { type: "number", description: "timeout" },
        args: { type: "object", properties: {}, description: "Tool arguments" },
      },
    });
    expect(JSON.stringify(schema)).not.toContain("minimum");
    expect(JSON.stringify(schema)).not.toContain("anyOf");
  });

  it("sanitizes real Type.Object tool parameters", () => {
    const schema = typeboxToJsonSchema(
      Type.Object({
        path: Type.String({ description: "Path to the file" }),
        offset: Type.Optional(Type.Number({ description: "1-based start line" })),
        limit: Type.Optional(Type.Number({ description: "Max number of lines" })),
      }),
    );
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["path"]);
    expect(Object.keys(schema).sort()).toEqual(["properties", "required", "type"]);
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    expect(properties.path).toEqual({ type: "string", description: "Path to the file" });
    expect(properties.offset).toEqual({ type: "number", description: "1-based start line" });
  });

  it("falls back to a plain object schema", () => {
    expect(typeboxToJsonSchema(undefined)).toEqual({ type: "object", properties: {} });
    expect(sanitizeToolJsonSchema({ "~kind": "Object" })).toEqual({});
  });
});
