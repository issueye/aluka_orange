import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "vitest";
import {
  addModelsToProviderInModelsJson,
  parseOpenAiModelsList,
  fetchOpenAiModelList,
  lookupProviderModel,
  modelsListUrl,
  normalizeProxyUrl,
  upsertCustomProviderInModelsJson,
} from "../src/models-json.ts";
import { withProxy } from "../src/ai/provider-fetch.ts";

describe("openai models list", () => {
  it("parses data[] / models[] / string ids", () => {
    const fromData = parseOpenAiModelsList({
      object: "list",
      data: [
        { id: "gpt-4", owned_by: "openai" },
        { id: "gpt-4" },
        { id: "gpt-4o-mini", name: "GPT-4o mini" },
      ],
    });
    assert.equal(fromData.length, 2);
    assert.equal(fromData.some((m) => m.id === "gpt-4" && m.ownedBy === "openai"), true);

    const fromModels = parseOpenAiModelsList({ models: [{ name: "llama3.1" }] });
    assert.equal(fromModels[0]?.id, "llama3.1");

    const fromArray = parseOpenAiModelsList(["a", "b"]);
    assert.deepEqual(fromArray.map((m) => m.id), ["a", "b"]);
  });

  it("builds /models url from openai-compatible baseUrl", () => {
    assert.equal(modelsListUrl("https://api.openai.com/v1"), "https://api.openai.com/v1/models");
    assert.equal(modelsListUrl("https://api.openai.com/v1/models"), "https://api.openai.com/v1/models");
  });

  it("fetches via GET /v1/models and merges into provider", async () => {
    const server = http.createServer((req, res) => {
      if (req.url === "/v1/models") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({
          data: [
            { id: "gpt-test-1", owned_by: "openai" },
            { id: "gpt-test-2" },
          ],
        }));
        return;
      }
      res.statusCode = 404;
      res.end("no");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    const baseUrl = `http://127.0.0.1:${addr.port}/v1`;
    try {
      const remote = await fetchOpenAiModelList({ baseUrl, apiKey: "sk-test" });
      assert.equal(remote.length, 2);

      const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-models-"));
      upsertCustomProviderInModelsJson(agentDir, {
        provider: "openai",
        baseUrl,
        api: "openai-completions",
        modelId: "gpt-test-1",
        apiKey: "sk-test",
      });
      const added = addModelsToProviderInModelsJson(agentDir, {
        provider: "openai",
        models: remote.map((m) => ({ id: m.id })),
      });
      assert.equal(added.providers[0]?.models.length, 2);
      fs.rmSync(agentDir, { recursive: true, force: true });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});

describe("provider proxy", () => {
  it("normalizes host:port and socks5 urls", () => {
    assert.equal(normalizeProxyUrl(""), "");
    assert.equal(normalizeProxyUrl("  127.0.0.1:7890  "), "http://127.0.0.1:7890");
    assert.equal(normalizeProxyUrl("http://127.0.0.1:7890"), "http://127.0.0.1:7890");
    assert.equal(normalizeProxyUrl("socks5://127.0.0.1:1080"), "socks5://127.0.0.1:1080");
    assert.throws(() => normalizeProxyUrl("ftp://127.0.0.1:21"), /仅支持/);
  });

  it("attaches proxy onto fetch init for Aluka runtime", () => {
    const init = withProxy({ method: "POST" }, "http://127.0.0.1:7890");
    assert.equal(init.method, "POST");
    assert.equal(init.proxy, "http://127.0.0.1:7890");
    assert.equal("proxy" in withProxy({}, "  "), false);
  });

  it("persists proxy on provider and lookup", () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-proxy-"));
    try {
      upsertCustomProviderInModelsJson(agentDir, {
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        api: "openai-completions",
        modelId: "gpt-4.1",
        apiKey: "sk-test",
        proxy: "127.0.0.1:7890",
      });
      const found = lookupProviderModel(agentDir, "openai", "gpt-4.1");
      assert.equal(found?.proxy, "http://127.0.0.1:7890");

      upsertCustomProviderInModelsJson(agentDir, {
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        api: "openai-completions",
        modelId: "gpt-4.1",
      });
      const kept = lookupProviderModel(agentDir, "openai", "gpt-4.1");
      assert.equal(kept?.proxy, "http://127.0.0.1:7890");

      upsertCustomProviderInModelsJson(agentDir, {
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        api: "openai-completions",
        modelId: "gpt-4.1",
        proxy: "",
      });
      const cleared = lookupProviderModel(agentDir, "openai", "gpt-4.1");
      assert.equal(cleared?.proxy, undefined);
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  });
});
