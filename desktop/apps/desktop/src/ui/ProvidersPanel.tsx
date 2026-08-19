import { useCallback, useEffect, useState } from "react";
import { Activity, CloudDownload, Pencil, Plus, Trash2, KeyRound } from "lucide-react";
import { rpc } from "./bridge.ts";
import { Button, Input, SectionHead, Select, Textarea } from "./components/index.ts";

/**
 * ProvidersPanel - 供应商管理面板
 *
 * 两个分区：
 * 1. 内置厂商目录：Anthropic / OpenAI / Gemini / Kimi / GLM / DeepSeek 等，
 *    厂商信息与精编模型来自 agent 侧内置目录（pi models.dev 快照），
 *    填密钥即用；也支持只设环境变量后直接选模型。
 * 2. 自定义供应商：读写 ~/.aluka/agent/models.json 的完全自定义条目。
 *
 * 密钥解析顺序（agent 侧）：显式 > settings.apiKey > models.json > 厂商专属环境变量。
 */

/** 供应商视图：对应 models.json 中的一个供应商配置 */
export type ModelsJsonProviderView = {
  provider: string;
  baseUrl?: string;
  api?: string;
  proxy?: string;
  /** 是否已配置 API 密钥 */
  hasApiKeyField: boolean;
  /** 该供应商下的所有模型 */
  models: Array<{ id: string; name?: string; reasoning?: boolean; contextWindow?: number; maxTokens?: number }>;
};

/** models.json 配置视图：包含路径信息和所有供应商 */
export type ModelsJsonConfigView = {
  path: string;          // 配置文件路径
  exists: boolean;        // 文件是否存在
  error?: string;         // 加载错误信息
  providers: ModelsJsonProviderView[];
};

/** 内置厂商视图：对应 agent 侧 providers/builtin.ts 的投影（永不含密钥） */
type BuiltinProviderView = {
  id: string;
  name: string;
  description: string;
  api: ApiKind;
  baseUrl?: string;
  envKeys: string[];
  docsUrl?: string;
  local?: boolean;
  models: Array<{
    id: string;
    name: string;
    api: ApiKind;
    reasoning: boolean;
    input: Array<"text" | "image">;
    contextWindow: number;
    maxTokens: number;
  }>;
  /** builtin=内置目录；extension=扩展动态注册 */
  source: "builtin" | "extension";
  /** 扩展声明了 refreshModels，支持动态发现模型 */
  refreshable?: boolean;
  /** 注册来源扩展路径 */
  extensionPath?: string;
};

/** 测试连接结果 */
type ProbeResult = {
  ok: boolean;
  status?: number;
  latencyMs: number;
  modelCount?: number;
  error?: string;
  url?: string;
};

/** API 类型：Chat Completions / Responses / Anthropic Messages */
type ApiKind = "openai-completions" | "openai-responses" | "anthropic-messages";

function coerceApiKind(api?: string): ApiKind {
  if (api === "anthropic-messages" || api === "openai-responses") return api;
  return "openai-completions";
}

/** 添加/编辑供应商的表单草稿状态 */
type Draft = {
  provider: string;       // 供应商 ID
  baseUrl: string;        // 接口地址
  api: ApiKind;           // API 类型
  modelId: string;        // 模型 ID
  modelName: string;      // 显示名称
  apiKey: string;         // API 密钥
  proxy: string;          // HTTP/SOCKS 代理
  modelIdsText: string;   // 批量添加：每行一个模型 ID
  previousProvider?: string;  // 编辑时的原供应商 ID（用于重命名）
  previousModelId?: string;   // 编辑时的原模型 ID
};

type RemoteModel = { id: string; name?: string; ownedBy?: string };

type FetchPicker = {
  provider: string;
  models: RemoteModel[];
  selected: string[];
  query: string;
  existing: string[];
};

const EMPTY_DRAFT: Draft = {
  provider: "",
  baseUrl: "",
  api: "openai-completions",
  modelId: "",
  modelName: "",
  apiKey: "",
  proxy: "",
  modelIdsText: "",
};

function displayProxy(proxy: string): string {
  try {
    const url = new URL(proxy);
    if (url.password) url.password = "****";
    let text = url.toString();
    if (text.endsWith("/") && url.pathname === "/") text = text.slice(0, -1);
    return text;
  } catch {
    return proxy;
  }
}

function parseModelIds(text: string): string[] {
  return [...new Set(text.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean))];
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function visibleRemoteModels(picker: FetchPicker): RemoteModel[] {
  const q = picker.query.trim().toLowerCase();
  if (!q) return picker.models;
  return picker.models.filter((model) => {
    return model.id.toLowerCase().includes(q) || (model.ownedBy ?? "").toLowerCase().includes(q);
  });
}

/**
 * 供应商管理面板组件
 * @param activeProvider - 当前激活的供应商
 * @param activeModel - 当前激活的模型
 * @param onToast - Toast 通知回调
 * @param onActiveChanged - 激活模型变更时的回调
 */
export function ProvidersPanel(props: {
  activeProvider?: string;
  activeModel?: string;
  onToast: (message: string, level?: "info" | "warning" | "error") => void;
  onActiveChanged: () => void;
}) {
  const [config, setConfig] = useState<ModelsJsonConfigView | undefined>(); // 当前配置
  const [builtin, setBuiltin] = useState<BuiltinProviderView[] | undefined>(); // 内置厂商目录
  const [dialogOpen, setDialogOpen] = useState(false);   // 添加/编辑弹窗是否打开
  const [keyDialog, setKeyDialog] = useState<string | undefined>(); // API 密钥弹窗的目标供应商
  const [builtinKeyDialog, setBuiltinKeyDialog] = useState<BuiltinProviderView | undefined>(); // 内置厂商启用弹窗
  const [keyDraft, setKeyDraft] = useState("");           // API 密钥输入草稿
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT); // 表单草稿
  const [addModelsMode, setAddModelsMode] = useState(false);
  const [fetchPicker, setFetchPicker] = useState<FetchPicker | undefined>();
  const [busy, setBusy] = useState(false);                 // 操作进行中标记
  const [probeBusy, setProbeBusy] = useState<string | undefined>(); // 测试连接中的目标
  const [refreshBusy, setRefreshBusy] = useState<string | undefined>(); // 刷新模型中的目标

  /** 刷新 models.json 配置与内置厂商目录 */
  const refresh = useCallback(async () => {
    const [nextConfig, builtinProviders] = await Promise.all([
      rpc<ModelsJsonConfigView>("getModelsJsonConfig"),
      rpc<BuiltinProviderView[]>("listBuiltinProviders"),
    ]);
    setConfig(nextConfig);
    setBuiltin(builtinProviders);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** 打开添加弹窗，可选预填预设 */
  function openCreate(preset?: Partial<Draft>) {
    setAddModelsMode(false);
    setDraft({ ...EMPTY_DRAFT, ...preset });
    setDialogOpen(true);
  }

  /** 打开编辑弹窗，预填现有供应商和模型信息 */
  function openEdit(provider: ModelsJsonProviderView, modelId: string) {
    const model = provider.models.find((m) => m.id === modelId);
    setAddModelsMode(false);
    setDraft({
      provider: provider.provider,
      baseUrl: provider.baseUrl ?? "",
      api: coerceApiKind(provider.api),
      modelId: model?.id ?? modelId,
      modelName: model?.name ?? "",
      apiKey: "",
      proxy: provider.proxy ?? "",
      modelIdsText: "",
      previousProvider: provider.provider,
      previousModelId: modelId,
    });
    setDialogOpen(true);
  }

  function openAddModels(provider: ModelsJsonProviderView) {
    setAddModelsMode(true);
    setDraft({
      ...EMPTY_DRAFT,
      provider: provider.provider,
      baseUrl: provider.baseUrl ?? "",
      api: coerceApiKind(provider.api),
      proxy: provider.proxy ?? "",
      previousProvider: provider.provider,
    });
    setDialogOpen(true);
  }

  /** 保存供应商/模型草稿到 models.json */
  async function saveDraft(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    try {
      if (addModelsMode) {
        const models = parseModelIds(draft.modelIdsText).map((id) => ({ id }));
        const next = await rpc<ModelsJsonConfigView>("addProviderModels", {
          provider: draft.provider.trim(),
          models,
        });
        setConfig(next);
        setDialogOpen(false);
        setAddModelsMode(false);
        props.onToast(`已向 ${draft.provider} 添加 ${models.length} 个模型`, "info");
        props.onActiveChanged();
        return;
      }
      const next = await rpc<ModelsJsonConfigView>("upsertCustomProvider", {
        provider: draft.provider.trim(),
        baseUrl: draft.baseUrl.trim(),
        api: draft.api,
        modelId: draft.modelId.trim(),
        modelName: draft.modelName.trim() || undefined,
        apiKey: draft.apiKey.trim() || undefined,
        proxy: draft.proxy,
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

  /**
   * 启用内置厂商：把目录条目落盘到 models.json（baseUrl/api/精编模型），
   * 密钥可选（留空则依赖环境变量或稍后再填）。
   */
  async function enableBuiltin(def: BuiltinProviderView, apiKey: string, e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    try {
      const existing = config?.providers.find((p) => p.provider === def.id);
      if (!existing) {
        const first = def.models[0];
        if (!first) throw new Error("该厂商没有内置模型目录，请用「配置」手动添加");
        let next = await rpc<ModelsJsonConfigView>("upsertCustomProvider", {
          provider: def.id,
          baseUrl: def.baseUrl ?? "",
          api: def.api,
          modelId: first.id,
          modelName: first.name,
          apiKey: apiKey.trim() || undefined,
        });
        const rest = def.models.slice(1);
        if (rest.length) {
          next = await rpc<ModelsJsonConfigView>("addProviderModels", {
            provider: def.id,
            models: rest.map((m) => ({ id: m.id, name: m.name })),
          });
        }
        setConfig(next);
        props.onToast(`${def.name} 已启用（${def.models.length} 个模型）`, "info");
      } else if (apiKey.trim()) {
        const next = await rpc<ModelsJsonConfigView>("setProviderApiKey", {
          provider: def.id,
          apiKey: apiKey.trim(),
        });
        setConfig(next);
        props.onToast(`已保存 ${def.name} 的 API 密钥`, "info");
      } else {
        props.onToast(`${def.name} 已在自定义列表中`, "info");
      }
      setBuiltinKeyDialog(undefined);
      setKeyDraft("");
      props.onActiveChanged();
    } catch (err) {
      props.onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  /** 调用扩展的 refreshModels 动态发现模型 */
  async function refreshModels(def: BuiltinProviderView) {
    setRefreshBusy(def.id);
    try {
      const models = await rpc<Array<{ id: string }>>("refreshProviderModels", { provider: def.id });
      props.onToast(`${def.name}：发现 ${models.length} 个模型`, "info");
      await refresh();
    } catch (err) {
      props.onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setRefreshBusy(undefined);
    }
  }

  /** 测试连通性：GET models，不消耗 token */
  async function probe(target: { provider?: string; baseUrl?: string; api?: string; apiKey?: string; proxy?: string }) {
    const key = target.provider ?? target.baseUrl ?? "";
    setProbeBusy(key);
    try {
      const result = await rpc<ProbeResult>("testProviderConnection", target);
      if (result.ok) {
        props.onToast(`连接正常 · ${result.modelCount ?? "?"} 个模型 · ${result.latencyMs}ms`, "info");
      } else {
        props.onToast(`连接失败：${result.error ?? "未知错误"}`, "error");
      }
    } catch (err) {
      props.onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setProbeBusy(undefined);
    }
  }

  async function fetchModelsForProvider(provider: ModelsJsonProviderView, apiKey?: string) {
    if (provider.api === "anthropic-messages" && provider.baseUrl?.includes("api.anthropic.com")) {
      props.onToast("Anthropic 官方端点暂不支持批量拉取，请用「测试连接」或手动添加", "warning");
      return;
    }
    setBusy(true);
    try {
      const result = await rpc<{ models?: RemoteModel[] } | RemoteModel[]>("fetchRemoteModels", {
        provider: provider.provider,
        apiKey: apiKey?.trim() || undefined,
      });
      const models = Array.isArray(result) ? result : result.models ?? [];
      if (!models.length) {
        props.onToast("模型列表为空", "warning");
        return;
      }
      setFetchPicker({
        provider: provider.provider,
        models,
        selected: [],
        query: "",
        existing: provider.models.map((m) => m.id),
      });
    } catch (err) {
      props.onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function fetchModelsFromDraft() {
    setBusy(true);
    try {
      const result = await rpc<{ models?: RemoteModel[] } | RemoteModel[]>("fetchRemoteModels", {
        provider: draft.previousProvider || (addModelsMode ? draft.provider : undefined),
        baseUrl: draft.baseUrl.trim() || undefined,
        apiKey: draft.apiKey.trim() || undefined,
        proxy: draft.proxy.trim() || undefined,
      });
      const models = Array.isArray(result) ? result : result.models ?? [];
      if (!models.length) {
        props.onToast("模型列表为空", "warning");
        return;
      }
      const existing = config?.providers.find(
        (p) => p.provider === (draft.previousProvider || draft.provider.trim()),
      );
      setFetchPicker({
        provider: draft.previousProvider || draft.provider.trim(),
        models,
        selected: [],
        query: "",
        existing: existing?.models.map((m) => m.id) ?? [],
      });
    } catch (err) {
      props.onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function importFetchedModels() {
    if (!fetchPicker) return;
    const models = fetchPicker.models
      .filter((m) => fetchPicker.selected.includes(m.id) && !fetchPicker.existing.includes(m.id))
      .map((m) => ({ id: m.id, name: m.name }));
    if (!models.length) {
      props.onToast("请选择要导入的新模型", "warning");
      return;
    }
    setBusy(true);
    try {
      let next: ModelsJsonConfigView;
      const exists = config?.providers.some((p) => p.provider === fetchPicker.provider);
      if (!exists) {
        const first = models[0]!;
        next = await rpc<ModelsJsonConfigView>("upsertCustomProvider", {
          provider: fetchPicker.provider || draft.provider.trim(),
          baseUrl: draft.baseUrl.trim(),
          api: draft.api,
          modelId: first.id,
          modelName: first.name,
          apiKey: draft.apiKey.trim() || undefined,
          proxy: draft.proxy,
        });
        const rest = models.slice(1);
        if (rest.length) {
          next = await rpc<ModelsJsonConfigView>("addProviderModels", {
            provider: fetchPicker.provider || draft.provider.trim(),
            models: rest,
          });
        }
      } else {
        next = await rpc<ModelsJsonConfigView>("addProviderModels", {
          provider: fetchPicker.provider,
          models,
        });
      }
      setConfig(next);
      setFetchPicker(undefined);
      setDialogOpen(false);
      setAddModelsMode(false);
      props.onToast(`已导入 ${models.length} 个模型`, "info");
      props.onActiveChanged();
    } catch (err) {
      props.onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  /** 删除指定供应商及其全部模型 */
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

  /** 删除指定模型 */
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

  /** 选择并激活指定模型（内置目录模型无需落盘，agent 侧解析时自动兜底） */
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

  /** 保存 API 密钥到 models.json */
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

  /** 清除指定供应商的 API 密钥 */
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
          hint={`内置厂商填密钥即用；自定义条目写入 ~/.aluka/agent/models.json${config?.path ? `（${config.path}）` : ""}。仅支持 API Key，暂不支持 OAuth。`}
        />
      </div>
      {config?.error ? <p className="hint" style={{ color: "var(--danger)" }}>{config.error}</p> : null}

      {/* ── 内置厂商目录 ── */}
      <section className="builtin-section">
        <div className="builtin-section__head">
          <strong>内置厂商</strong>
          <span className="hint">{builtin?.length ?? "…"} 家 · 模型信息来自内置目录（models.dev 快照），无需手填</span>
        </div>
        <div className="builtin-grid">
          {(builtin ?? []).map((def) => {
            const configured = config?.providers.find((p) => p.provider === def.id);
            const isExtension = def.source === "extension";
            const keyOk = def.local || isExtension || Boolean(configured?.hasApiKeyField);
            return (
              <div key={def.id} className="builtin-card">
                <header className="builtin-card__head">
                  <strong title={isExtension ? def.extensionPath : def.id}>{def.name}</strong>
                  {isExtension ? (
                    <span className="auth-badge ext">扩展</span>
                  ) : (
                    <span className={`auth-badge ${keyOk ? "ok" : "miss"}`}>
                      {def.local ? "本地" : keyOk ? "密钥已存" : "未配置密钥"}
                    </span>
                  )}
                </header>
                <p className="hint">{def.description}</p>
                <p className="builtin-card__meta hint">
                  {def.baseUrl || "—"}
                  {def.envKeys.length ? <br /> : null}
                  {def.envKeys.length ? `环境变量：${def.envKeys.join(" / ")}` : isExtension ? "密钥由扩展管理" : "无需密钥"}
                </p>
                {def.models.length ? (
                  <ul className="builtin-card__models">
                    {def.models.map((m) => {
                      const active = props.activeProvider === def.id && props.activeModel === m.id;
                      return (
                        <li key={m.id} className={active ? "is-active" : ""}>
                          <span title={`${m.id} · 上下文 ${m.contextWindow.toLocaleString()} · 最大输出 ${m.maxTokens.toLocaleString()}`}>
                            {m.name}
                          </span>
                          <Button variant="ghost" size="sm" disabled={busy || active} onClick={() => void useModel(def.id, m.id)}>
                            {active ? "当前" : "使用"}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="hint">
                    {def.refreshable
                      ? "暂无模型目录，点「刷新模型」从接口动态发现。"
                      : "无内置模型目录，可先测试连接再从接口拉取。"}
                  </p>
                )}
                <footer className="row-actions">
                  {def.local ? (
                    <Button variant="secondary" size="sm" disabled={busy} onClick={() => openCreate({
                      provider: def.id,
                      baseUrl: def.baseUrl ?? "",
                      api: coerceApiKind(def.api),
                    })}>
                      配置
                    </Button>
                  ) : isExtension ? null : (
                    <Button variant="secondary" size="sm" disabled={busy} onClick={() => {
                      setBuiltinKeyDialog(def);
                      setKeyDraft("");
                    }}>
                      <KeyRound size={14} /> {configured ? "更新密钥" : "启用"}
                    </Button>
                  )}
                  {def.refreshable ? (
                    <Button variant="secondary" size="sm" disabled={refreshBusy === def.id || busy} onClick={() => void refreshModels(def)}>
                      {refreshBusy === def.id ? "刷新中…" : "刷新模型"}
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="sm" disabled={probeBusy === def.id} onClick={() => void probe({ provider: def.id })}>
                    <Activity size={14} /> {probeBusy === def.id ? "测试中…" : "测试连接"}
                  </Button>
                  {def.docsUrl ? (
                    <a className="builtin-card__link hint" href={def.docsUrl} target="_blank" rel="noreferrer">获取密钥</a>
                  ) : null}
                </footer>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── 自定义供应商 ── */}
      <section className="custom-providers">
        <div className="builtin-section__head">
          <strong>自定义供应商</strong>
          <span className="hint">完全自定义的端点（自建网关、第三方中转等），写入 models.json</span>
          <div className="row-actions" style={{ marginLeft: "auto" }}>
            <Button size="sm" disabled={busy} onClick={() => openCreate()}>
              <Plus size={14} /> 添加
            </Button>
          </div>
        </div>
        {(config?.providers ?? []).length === 0 ? (
          <p className="hint">暂无自定义供应商。上方内置厂商已覆盖常用场景；兼容端点（中转 / 自建网关）可点「添加」。</p>
        ) : (
          <div className="provider-groups">
            {(config?.providers ?? []).map((provider) => (
              <section key={provider.provider} className="provider-group">
                <header className="provider-group__head">
                  <div className="provider-group__id">
                    <strong>{provider.provider}</strong>
                    <span className={`auth-badge ${provider.hasApiKeyField ? "ok" : "miss"}`}>
                      {provider.hasApiKeyField ? "已配置密钥" : "缺少密钥"}
                    </span>
                  </div>
                  <p className="provider-group__meta">
                    {provider.api || "openai-completions"} · {provider.baseUrl || "—"} · {provider.models.length} 个模型
                    {provider.proxy ? ` · 代理 ${displayProxy(provider.proxy)}` : ""}
                  </p>
                  <div className="row-actions">
                    <Button
                      variant="ghost"
                      size="sm"
                      title="测试连接"
                      disabled={busy || probeBusy === provider.provider}
                      onClick={() => void probe({
                        provider: provider.provider,
                        baseUrl: provider.baseUrl,
                        api: provider.api,
                        proxy: provider.proxy,
                      })}
                    >
                      <Activity size={14} />
                    </Button>
                    <Button variant="ghost" size="sm" title="设置 API 密钥" disabled={busy} onClick={() => {
                      setKeyDialog(provider.provider);
                      setKeyDraft("");
                    }}>
                      <KeyRound size={14} />
                    </Button>
                    <Button variant="ghost" size="sm" title="添加模型" disabled={busy} onClick={() => openAddModels(provider)}>
                      <Plus size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      title="从 /models 接口拉取"
                      disabled={busy}
                      onClick={() => void fetchModelsForProvider(provider)}
                    >
                      <CloudDownload size={14} />
                    </Button>
                    {provider.hasApiKeyField ? (
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void clearKey(provider.provider)}>
                        清除密钥
                      </Button>
                    ) : null}
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => void removeProvider(provider.provider)}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </header>
                {provider.models.map((model) => {
                  const active =
                    props.activeProvider === provider.provider && props.activeModel === model.id;
                  return (
                    <div key={model.id} className={`model-row${active ? " is-active" : ""}`}>
                      <div className="model-row__name">
                        <span>{model.name || model.id}</span>
                        {model.name && model.name !== model.id ? <span className="hint">{model.id}</span> : null}
                        {active ? <span className="auth-badge ok">当前</span> : null}
                      </div>
                      <div className="row-actions">
                        <Button variant="ghost" size="sm" disabled={busy || active} onClick={() => void useModel(provider.provider, model.id)}>
                          使用
                        </Button>
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => openEdit(provider, model.id)}>
                          <Pencil size={14} />
                        </Button>
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void removeModel(provider.provider, model.id)}>
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
        )}
      </section>

      {dialogOpen ? (
        <div className="modal" data-aluka-drag="no-drag">
          <form className="modal-card" onSubmit={(e) => void saveDraft(e)}>
            <h3>
              {addModelsMode
                ? `添加模型 · ${draft.provider}`
                : draft.previousModelId
                  ? "编辑模型"
                  : "添加供应商 / 模型"}
            </h3>
            {addModelsMode ? null : (
              <>
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
                  hint="Chat Completions（/chat/completions）、Responses（/responses）或 Anthropic Messages。部分新模型 / 网关只支持 Responses。"
                  value={draft.api}
                  options={[
                    { value: "openai-completions", label: "openai-completions（Chat Completions）" },
                    { value: "openai-responses", label: "openai-responses（Responses）" },
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
                  label="网络代理"
                  hint="仅该供应商生效。支持 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080，也可只填 host:port。留空则直连。"
                  value={draft.proxy}
                  onChange={(proxy) => setDraft((d) => ({ ...d, proxy }))}
                  placeholder="http://127.0.0.1:7890"
                />
              </>
            )}
            {addModelsMode ? (
              <Textarea
                label="模型 ID"
                hint="每行一个，也可用逗号分隔。可先点「从接口拉取」。"
                required
                rows={8}
                value={draft.modelIdsText}
                onChange={(modelIdsText) => setDraft((d) => ({ ...d, modelIdsText }))}
                placeholder={"gpt-4.1\ngpt-4o-mini"}
              />
            ) : (
              <>
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
              </>
            )}
            {addModelsMode ? null : (
              <Input
                label="API 密钥"
                hint="保存在本地 models.json。留空则不改动已有密钥。"
                type="password"
                value={draft.apiKey}
                onChange={(apiKey) => setDraft((d) => ({ ...d, apiKey }))}
                placeholder={draft.previousModelId ? "留空则保留原密钥" : "可选，稍后也可单独设置"}
              />
            )}
            <div className="modal-actions">
              <Button variant="secondary" disabled={busy} onClick={() => void fetchModelsFromDraft()}>
                <CloudDownload size={14} /> 从接口拉取
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setDialogOpen(false);
                  setAddModelsMode(false);
                }}
              >
                取消
              </Button>
              <Button type="submit" disabled={busy}>保存</Button>
            </div>
          </form>
        </div>
      ) : null}

      {fetchPicker ? (
        <div className="modal" data-aluka-drag="no-drag">
          <div className="modal-card model-pick-card">
            <h3>选择要导入的模型</h3>
            <p className="modal-body">
              来自 OpenAI 兼容 GET /models，已存在的会标为已添加。
              显示 {visibleRemoteModels(fetchPicker).length} / 共 {fetchPicker.models.length} 个。
            </p>
            <Input
              label="筛选"
              value={fetchPicker.query}
              onChange={(query) => setFetchPicker((p) => (p ? { ...p, query } : p))}
              placeholder="muse-spark、glm、deepseek"
            />
            <div className="model-pick-toolbar">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const visible = visibleRemoteModels(fetchPicker);
                  setFetchPicker((p) => p ? { ...p, selected: uniqueIds([...p.selected, ...visible.map((m) => m.id)]) } : p);
                }}
              >
                全选可见
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setFetchPicker((p) => p ? { ...p, selected: [] } : p)}>
                清空
              </Button>
            </div>
            <ul className="model-pick-list">
              {visibleRemoteModels(fetchPicker).length === 0 ? (
                <li className="model-pick-empty">
                  {fetchPicker.models.length === 0
                    ? "未拉取到模型"
                    : `没有匹配「${fetchPicker.query}」的模型`}
                </li>
              ) : visibleRemoteModels(fetchPicker).map((model) => {
                const exists = fetchPicker.existing.includes(model.id);
                const checked = exists || fetchPicker.selected.includes(model.id);
                return (
                  <li key={model.id}>
                    <label className={exists ? "is-existing" : ""}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={exists || busy}
                        onChange={() => {
                          setFetchPicker((p) => {
                            if (!p) return p;
                            const on = p.selected.includes(model.id);
                            return {
                              ...p,
                              selected: on ? p.selected.filter((id) => id !== model.id) : [...p.selected, model.id],
                            };
                          });
                        }}
                      />
                      <span>
                        {model.id}
                        {model.ownedBy ? <span className="hint"> · {model.ownedBy}</span> : null}
                        {exists ? <span className="auth-badge ok">已添加</span> : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="modal-actions">
              <Button variant="secondary" disabled={busy} onClick={() => setFetchPicker(undefined)}>取消</Button>
              <Button disabled={busy} onClick={() => void importFetchedModels()}>
                导入选中
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {builtinKeyDialog ? (
        <div className="modal" data-aluka-drag="no-drag">
          <form className="modal-card" onSubmit={(e) => void enableBuiltin(builtinKeyDialog, keyDraft, e)}>
            <h3>{builtinKeyDialog.name} · API 密钥</h3>
            <p className="modal-body hint">
              {config?.providers.some((p) => p.provider === builtinKeyDialog.id)
                ? "仅更新密钥，不影响已配置的模型。"
                : `保存后将把内置目录的 ${builtinKeyDialog.models.length} 个模型写入 models.json。`}
              {builtinKeyDialog.envKeys.length
                ? ` 也可不填，改为设置环境变量 ${builtinKeyDialog.envKeys.join(" / ")}。`
                : ""}
            </p>
            <Input
              label="API 密钥"
              hint="仅保存在本地 models.json，不会上传。"
              type="password"
              autoFocus
              value={keyDraft}
              onChange={setKeyDraft}
              placeholder="sk-…（可留空，稍后在自定义列表中设置）"
            />
            <div className="modal-actions">
              <Button variant="secondary" disabled={busy} onClick={() => setBuiltinKeyDialog(undefined)}>取消</Button>
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
