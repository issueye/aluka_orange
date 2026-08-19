import { describe, expect, it } from "vitest";
import { inspectToolsPayload } from "../src/ai/request-log.ts";

describe("inspectToolsPayload", () => {
  it("flags TypeBox and extra schema keywords", () => {
    const body = JSON.stringify({
      model: "deepseek-v4-flash",
      tools: [
        {
          type: "function",
          function: {
            name: "read",
            description: "Read a file",
            parameters: {
              type: "object",
              "~kind": "Object",
              additionalProperties: false,
              properties: {
                path: { type: "string", description: "Path", "~kind": "String" },
              },
              required: ["path"],
            },
          },
        },
      ],
    });
    const inspected = inspectToolsPayload(body);
    expect(inspected.unexpectedKeys).toEqual(["additionalProperties", "~kind"]);
    expect(inspected.schemaKeys).toContain("parameters");
    expect(inspected.schemaKeys).toContain("~kind");
  });
});
