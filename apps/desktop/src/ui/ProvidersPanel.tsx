import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2, KeyRound } from "lucide-react";
import { rpc } from "./bridge.ts";
import { Button, Input, SectionHead, Select } from "./components/index.ts";

export type ModelsJsonProviderView = {
  provider: string;
  baseUrl?: string;
  api?: string;
  hasApiKeyField: boolean;
  models: Array<{ id: string; name?: string; reasoning?: boolean; contextWindow?: number; maxTokens?: number }>;
};

export type ModelsJsonConfigView = {
  path: string;
  exists: boolean;
  error?: string;
  providers: ModelsJsonProviderView[];
};

type ApiKind = "openai-completions" | "anthropic-messages";

type Draft = {
  provider: string;
  baseUrl: string;
  api: ApiKind;
  modelId: string;
  modelName: string;
  apiKey: string;
  previousProvider?: string;
  previousModelId?: string;
};

const EMPTY_DRAFT: Draft = {
  provider: "",
  baseUrl: "http://127.0.0.1:11434/v1",
  api: "openai-completions",
  modelId: "",
  modelName: "",
  apiKey: "",
};

const QUICK_PRESETS: Array<{ label: string; draft: Partial<Draft> }> = [
  {
    label: "OpenAI",
    draft: {
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      api: "openai-completions",
      modelId: "gpt-4.1",
      modelName: "GPT-4.1",
    },
  },
  {
    label: "Anthropic",
    draft: {
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      api: "anthropic-messages",
      modelId: "claude-sonnet-4-20250514",
      modelName: "Claude Sonnet 4",
    },
  },
  {
    label: "Ollama",
    draft: {
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      api: "openai-completions",
      modelId: "llama3.1",
      modelName: "Llama 3.1",
      apiKey: "ollama",
    },
  },
];

export function ProvidersPanel(props: {
  activeProvider?: string;
  activeModel?: string;
  onToast: (message: string, level?: "info" | "warning" | "error") => void;
  onActiveChanged: () => void;
}) {
  const [config, setConfig] = useState<ModelsJsonConfigView | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [keyDialog, setKeyDialog] = useState<string | undefined>();
  const [keyDraft, setKeyDraft] = useState("");
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const next = await rpc<ModelsJsonConfigView>("getModelsJsonConfig");
    setConfig(next);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function openCreate(preset?: Partial<Draft>) {
    setDraft({ ...EMPTY_DRAFT, ...preset });
    setDialogOpen(true);
  }

  function openEdit(provider: ModelsJsonProviderView, modelId: string) {
    const model = provider.models.find((m) => m.id === modelId);
    setDraft({
      provider: provider.provider,
      baseUrl: provider.baseUrl ?? "",
      api: provider.api === "anthropic-messages" ? "anthropic-messages" : "openai-completions",
      modelId: model?.id ?? modelId,
      modelName: model?.name ?? "",
      apiKey: "",
      previousProvider: provider.provider,
      previousModelId: modelId,
    });
    setDialogOpen(true);
  }

  async function saveDraft(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    try {
      const next = await rpc<ModelsJsonConfigView>("upsertCustomProvider", {
        provider: draft.provider.trim(),
        baseUrl: draft.baseUrl.trim(),
        api: draft.api,
        modelId: draft.modelId.trim(),
        modelName: draft.modelName.trim() || undefined,
        apiKey: draft.apiKey.trim() || undefined,
        previousProvider: draft.previousProvider,
        previousModelId: draft.previousModelId,
      });
      setConfig(next);
      setDialogOpen(false);
      props.onToast("供应商已保存", "info");
      props.onActiveChanged();
    } catch (err) {
      props.onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function removeProvider(provider: string) {
    if (!confirm(`确定删除供应商「${provider}」及其全部模型？`)) return;
    setBusy(true);
    try {
      const next = await rpc<ModelsJsonConfigView>("removeCustomProvider", { provider });
      setConfig(next);
      props.onToast(`已删除 ${provider}`, "info");
      props.onActiveChanged();
    } catch (err) {
      props.onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function removeModel(provider: string, modelId: string) {
    if (!confirm(`确定删除模型 ${provider}/${modelId}？`)) return;
    setBusy(true);
    try {
      const next = await rpc<ModelsJsonConfigView>("removeCustomModel", { provider, modelId });
      setConfig(next);
      props.onToast(`已删除 ${provider}/${modelId}`, "info");
      props.onActiveChanged();
    } catch (err) {
      props.onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function useModel(provider: string, modelId: string) {
    setBusy(true);
    try {
      await rpc("selectModel", { provider, modelId });
      props.onToast(`当前模型 → ${provider}/${modelId}`, "info");
      props.onActiveChanged();
    } catch (err) {
      props.onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveKey(e?: React.FormEvent) {
    e?.preventDefault();
    if (!keyDialog) return;
    setBusy(true);
    try {
      const next = await rpc<ModelsJsonConfigView>("setProviderApiKey", {
        provider: keyDialog,
        apiKey: keyDraft.trim(),
      });
      setConfig(next);
      setKeyDialog(undefined);
      setKeyDraft("");
      props.onToast(`已保存 ${keyDialog} 的 API 密钥`, "info");
      props.onActiveChanged();
    } catch (err) {
      props.onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function clearKey(provider: string) {
    setBusy(true);
    try {
      const next = await rpc<ModelsJsonConfigView>("clearProviderApiKey", { provider });
      setConfig(next);
      props.onToast(`已清除 ${provider} 的 API 密钥`, "info");
      props.onActiveChanged();
    } catch (err) {
      props.onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="providers-panel">
      <div className="providers-head">
        <SectionHead
          as="h3"
          title="模型供应商"
          hint={`配置写入 ~/.aluka/agent/models.json${config?.path ? `（${config.path}）` : ""}。仅支持 API Key，暂不支持 OAuth。`}
        />
        <div className="providers-actions">
          {QUICK_PRESETS.map((p) => (
            <Button key={p.label} variant="secondary" size="sm" disabled={busy} onClick={() => openCreate(p.draft)}>
              {p.label}
            </Button>
          ))}
          <Button size="sm" disabled={busy} onClick={() => openCreate()}>
            <Plus size={14} /> 添加
          </Button>
        </div>
      </div>
      {config?.error ? <p className="hint" style={{ color: "var(--danger)" }}>{config.error}</p> : null}
      <ul className="inv-list provider-list">
        {(config?.providers ?? []).length === 0 ? (
          <li className="hint">暂无供应商。可用上方快捷按钮添加 OpenAI / Anthropic / Ollama，或自定义兼容端点。</li>
        ) : (
          (config?.providers ?? []).map((provider) => (
            <li key={provider.provider}>
              <div className="pkg-row">
                <div>
                  <strong>{provider.provider}</strong>
                  <span className={`auth-badge ${provider.hasApiKeyField ? "ok" : "miss"}`}>
                    {provider.hasApiKeyField ? "已配置密钥" : "缺少密钥"}
                  </span>
                  <div className="hint">
                    {provider.api || "openai-completions"} · {provider.baseUrl || "—"} · {provider.models.length} 个模型
                  </div>
                </div>
                <div className="row-actions">
                  <Button variant="secondary" size="sm" title="设置 API 密钥" disabled={busy} onClick={() => {
                    setKeyDialog(provider.provider);
                    setKeyDraft("");
                  }}>
                    <KeyRound size={14} />
                  </Button>
                  {provider.hasApiKeyField ? (
                    <Button variant="secondary" size="sm" disabled={busy} onClick={() => void clearKey(provider.provider)}>
                      清除密钥
                    </Button>
                  ) : null}
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => void removeProvider(provider.provider)}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
              <ul className="model-sublist">
                {provider.models.map((model) => {
                  const active =
                    props.activeProvider === provider.provider && props.activeModel === model.id;
                  return (
                    <li key={model.id} className={active ? "active" : ""}>
                      <span>
                        {model.name || model.id}
                        <span className="hint"> · {model.id}</span>
                        {active ? <span className="auth-badge ok">当前</span> : null}
                      </span>
                      <span className="row-actions">
                        <Button variant="secondary" size="sm" disabled={busy || active} onClick={() => void useModel(provider.provider, model.id)}>
                          使用
                        </Button>
                        <Button variant="secondary" size="sm" disabled={busy} onClick={() => openEdit(provider, model.id)}>
                          <Pencil size={14} />
                        </Button>
                        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void removeModel(provider.provider, model.id)}>
                          <Trash2 size={14} />
                        </Button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))
        )}
      </ul>

      {dialogOpen ? (
        <div className="modal" data-aluka-drag="no-drag">
          <form className="modal-card" onSubmit={(e) => void saveDraft(e)}>
            <h3>{draft.previousModelId ? "编辑模型" : "添加供应商 / 模型"}</h3>
            <Input
              label="供应商 ID"
              hint="用于标识供应商，建议小写英文，如 openai、ollama。"
              required
              value={draft.provider}
              onChange={(provider) => setDraft((d) => ({ ...d, provider }))}
              placeholder="openai / anthropic / ollama / my-gateway"
            />
            <Select
              label="API 类型"
              hint="OpenAI 兼容接口或 Anthropic Messages。"
              value={draft.api}
              options={[
                { value: "openai-completions", label: "openai-completions（OpenAI 兼容）" },
                { value: "anthropic-messages", label: "anthropic-messages" },
              ]}
              onChange={(api) => setDraft((d) => ({ ...d, api: api as ApiKind }))}
            />
            <Input
              label="Base URL"
              hint="接口根地址，例如 https://api.openai.com/v1。"
              required
              value={draft.baseUrl}
              onChange={(baseUrl) => setDraft((d) => ({ ...d, baseUrl }))}
              placeholder="https://api.openai.com/v1"
            />
            <Input
              label="模型 ID"
              hint="请求时发送的 model 字段。"
              required
              value={draft.modelId}
              onChange={(modelId) => setDraft((d) => ({ ...d, modelId }))}
              placeholder="gpt-4.1"
            />
            <Input
              label="显示名称"
              hint="仅用于界面展示，可留空。"
              value={draft.modelName}
              onChange={(modelName) => setDraft((d) => ({ ...d, modelName }))}
              placeholder="可选"
            />
            <Input
              label="API 密钥"
              hint="保存在本地 models.json。留空则不改动已有密钥。"
              type="password"
              value={draft.apiKey}
              onChange={(apiKey) => setDraft((d) => ({ ...d, apiKey }))}
              placeholder={draft.previousModelId ? "留空则保留原密钥" : "可选，稍后也可单独设置"}
            />
            <div className="modal-actions">
              <Button variant="secondary" disabled={busy} onClick={() => setDialogOpen(false)}>取消</Button>
              <Button type="submit" disabled={busy}>保存</Button>
            </div>
          </form>
        </div>
      ) : null}

      {keyDialog ? (
        <div className="modal" data-aluka-drag="no-drag">
          <form className="modal-card" onSubmit={(e) => void saveKey(e)}>
            <h3>API 密钥 · {keyDialog}</h3>
            <Input
              label="API 密钥"
              hint="仅保存在本地 models.json，不会上传。"
              type="password"
              required
              autoFocus
              value={keyDraft}
              onChange={setKeyDraft}
              placeholder="sk-…"
            />
            <div className="modal-actions">
              <Button variant="secondary" disabled={busy} onClick={() => setKeyDialog(undefined)}>取消</Button>
              <Button type="submit" disabled={busy}>保存密钥</Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
