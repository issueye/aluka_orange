/**
 * 运行时供应商解析：settings.json + models.json + env
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveRuntimeModel,
  resolveRuntimeApiKey,
  hasRuntimeApiKey,
} from "../src/models.ts";
import { upsertCustomProviderInModelsJson } from "../src/models-json.ts";
import { saveSettings } from "../src/desktop/settings.ts";

describe("resolveRuntimeModel / ApiKey", () => {
  it("prefers models.json entry over env defaults", () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-agent-"));
    upsertCustomProviderInModelsJson(agentDir, {
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      api: "openai-completions",
      modelId: "llama3.1",
      modelName: "Llama",
      apiKey: "ollama-secret",
    });

    const { model, source } = resolveRuntimeModel({ agentDir });
    assert.equal(source, "models.json");
    assert.equal(model.provider, "ollama");
    assert.equal(model.id, "llama3.1");
    assert.equal(model.baseUrl, "http://127.0.0.1:11434/v1");
    assert.equal(model.api, "openai-completions");

    const key = resolveRuntimeApiKey({ agentDir, model });
    assert.equal(key, "ollama-secret");
    assert.equal(hasRuntimeApiKey({ agentDir, model }), true);

    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  it("uses settings provider/model to select models.json row", () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-agent-"));
    upsertCustomProviderInModelsJson(agentDir, {
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      api: "openai-completions",
      modelId: "gpt-4.1",
      apiKey: "sk-from-models",
    });
    upsertCustomProviderInModelsJson(agentDir, {
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      api: "anthropic-messages",
      modelId: "claude-sonnet-4-20250514",
      apiKey: "sk-ant",
    });
    saveSettings({ provider: "anthropic", model: "claude-sonnet-4-20250514" }, agentDir);

    const { model, source } = resolveRuntimeModel({
      agentDir,
      settings: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    });
    assert.equal(source, "settings+models.json");
    assert.equal(model.provider, "anthropic");
    assert.equal(model.api, "anthropic-messages");
    assert.equal(resolveRuntimeApiKey({ agentDir, model }), "sk-ant");

    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  it("explicit CLI-like overrides win over settings when models.json matches", () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-agent-"));
    upsertCustomProviderInModelsJson(agentDir, {
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      api: "openai-completions",
      modelId: "qwen2.5",
      apiKey: "ollama",
    });
    const { model, source } = resolveRuntimeModel({
      agentDir,
      settings: { provider: "openai", model: "gpt-4.1" },
      provider: "ollama",
      model: "qwen2.5",
    });
    assert.equal(source, "explicit");
    assert.equal(model.id, "qwen2.5");
    assert.equal(model.provider, "ollama");
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  it("settings apiKey overrides models.json key", () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-agent-"));
    upsertCustomProviderInModelsJson(agentDir, {
      provider: "local",
      baseUrl: "http://127.0.0.1:8080/v1",
      api: "openai-completions",
      modelId: "x",
      apiKey: "from-models",
    });
    const { model } = resolveRuntimeModel({
      agentDir,
      provider: "local",
      model: "x",
    });
    assert.equal(
      resolveRuntimeApiKey({ agentDir, model, apiKey: "from-settings" }),
      "from-settings",
    );
    fs.rmSync(agentDir, { recursive: true, force: true });
  });
});
