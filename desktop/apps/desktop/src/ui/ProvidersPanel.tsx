import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  CloudDownload,
  Eye,
  EyeOff,
  Hexagon,
  Pencil,
  Plug,
  Plus,
  Puzzle,
  Search,
  Trash2,
} from "lucide-react";
import { rpc } from "./bridge.ts";
import { Button, ConfirmDialog, Dialog, Field, Input, Select } from "./components/index.ts";
import type { Toast } from "./types.ts";

/**
 * ProvidersPanel - 供应商管理面板
 *
 * 主从布局：左侧按「内置厂商 / 扩展 / 自定义供应商」分组导航，
 * 右侧编辑选中供应商的 Base URL、API 格式、密钥与模型卡片。
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

/** 供应商 ID 约束：与 agent 侧 CUSTOM_PROVIDER_ID_RE 一致（id 会成为 models.json 键与 provider/model 复合值的一部分） */
const PROVIDER_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const PROVIDER_ID_RULE = "供应商 ID 需以字母或数字开头，仅可包含字母、数字与 . _ -，最长 64 字符";

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
  modelName: string;      // 模型别名
  contextWindow: string;  // 上下文长度（支持 128000 / 128K / 1M）
  apiKey: string;         // API 密钥
  proxy: string;          // HTTP/SOCKS 代理
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
  contextWindow: "",
  apiKey: "",
  proxy: "",
};

function parseContextWindow(raw: string): number | undefined {
  const text = raw.trim().replace(/[,_\s]/g, "");
  if (!text) return undefined;
  const match = text.match(/^(\d+(?:\.\d+)?)([kKmM])?$/);
  if (!match) return undefined;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const unit = match[2]?.toLowerCase();
  if (unit === "k") return Math.round(n * 1000);
  if (unit === "m") return Math.round(n * 1_000_000);
  return Math.floor(n);
}

function readContextWindow(raw: string): number | undefined {
  if (!raw.trim()) return undefined;
  const value = parseContextWindow(raw);
  if (value == null) throw new Error("上下文长度无效，请输入数字，或如 128K、1M");
  return value;
}

function formatContextWindow(n?: number): string | undefined {
  if (!n || n <= 0) return undefined;
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

const API_OPTIONS = [
  { value: "openai-completions", label: "Chat Completions (/chat/completions)" },
  { value: "openai-responses", label: "Responses (/responses)" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
] as const;

type NavItem = {
  id: string;
  name: string;
  group: string;
  configured: boolean;
  hasKey: boolean;
  local?: boolean;
  source?: "builtin" | "extension";
  builtin?: BuiltinProviderView;
  custom?: ModelsJsonProviderView;
};

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
  onToast: (message: string, level?: Toast["level"]) => void;
  onActiveChanged: () => void;
}) {
  const [config, setConfig] = useState<ModelsJsonConfigView | undefined>(); // 当前配置
  const [builtin, setBuiltin] = useState<BuiltinProviderView[] | undefined>(); // 内置厂商目录
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [modelDialog, setModelDialog] = useState<"add" | "edit" | undefined>();
  const [builtinKeyDialog, setBuiltinKeyDialog] = useState<BuiltinProviderView | undefined>(); // 内置厂商启用弹窗
  /** 删除确认（供应商 / 单个模型），确认后由 executeRemovePending 执行 */
  const [removePending, setRemovePending] = useState<
    { kind: "provider"; provider: string } | { kind: "model"; provider: string; modelId: string } | undefined
  >();
  const [keyDraft, setKeyDraft] = useState("");           // API 密钥输入草稿
  /** 当前选中供应商已保存的 API 密钥（回显用；未配置为 undefined） */
  const [savedKey, setSavedKey] = useState<string | undefined>();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT); // 表单草稿
  const [fetchPicker, setFetchPicker] = useState<FetchPicker | undefined>();
  const [busy, setBusy] = useState(false);                 // 操作进行中标记
  const [probeBusy, setProbeBusy] = useState<string | undefined>(); // 测试连接中的目标
  const [refreshBusy, setRefreshBusy] = useState<string | undefined>(); // 刷新模型中的目标
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [query, setQuery] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [nameEditing, setNameEditing] = useState(false);
  const [form, setForm] = useState({ name: "", baseUrl: "", api: "openai-completions" as ApiKind, apiKey: "", proxy: "" });

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

  const navItems = useMemo<NavItem[]>(() => {
    const configured = config?.providers ?? [];
    const byId = new Map(configured.map((p) => [p.provider, p]));
    const items: NavItem[] = [];
    for (const def of builtin ?? []) {
      const custom = byId.get(def.id);
      items.push({
        id: def.id,
        name: def.name,
        group: def.source === "extension" ? "扩展" : "内置厂商",
        configured: Boolean(custom),
        hasKey: Boolean(def.local || def.source === "extension" || custom?.hasApiKeyField),
        local: def.local,
        source: def.source,
        builtin: def,
        custom,
      });
      byId.delete(def.id);
    }
    for (const custom of byId.values()) {
      items.push({
        id: custom.provider,
        name: custom.provider,
        group: "自定义供应商",
        configured: true,
        hasKey: custom.hasApiKeyField,
        custom,
      });
    }
    return items;
  }, [builtin, config]);

  const visibleNav = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? navItems.filter((item) => item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q))
      : navItems;
    const groups: Array<{ label: string; items: NavItem[] }> = [];
    for (const item of filtered) {
      const last = groups[groups.length - 1];
      if (last?.label === item.group) last.items.push(item);
      else groups.push({ label: item.group, items: [item] });
    }
    return groups;
  }, [navItems, query]);

  useEffect(() => {
    setSelectedId((prev) => {
      if (prev && navItems.some((item) => item.id === prev)) return prev;
      if (props.activeProvider && navItems.some((item) => item.id === props.activeProvider)) {
        return props.activeProvider;
      }
      const firstConfigured = navItems.find((item) => item.configured);
      return firstConfigured?.id ?? navItems[0]?.id;
    });
  }, [navItems, props.activeProvider]);

  const selected = navItems.find((item) => item.id === selectedId);

  useEffect(() => {
    setShowKey(false);
    setNameEditing(false);
    const custom = selected?.custom;
    const builtinDef = selected?.builtin;
    setForm({
      name: custom?.provider ?? builtinDef?.name ?? selected?.id ?? "",
      baseUrl: custom?.baseUrl ?? builtinDef?.baseUrl ?? "",
      api: coerceApiKind(custom?.api ?? builtinDef?.api),
      apiKey: "",
      proxy: custom?.proxy ?? "",
    });
  }, [selected?.id, selected?.custom, selected?.builtin]);

  /** 回显已保存的 API 密钥：选中供应商或配置变更时拉取明文（掩码展示，可点眼睛查看） */
  useEffect(() => {
    const providerId = selected?.custom?.provider ?? (selected?.configured ? selected?.id : undefined);
    if (!providerId) {
      setSavedKey(undefined);
      return;
    }
    let cancelled = false;
    void rpc<{ apiKey?: string }>("getProviderApiKey", { provider: providerId })
      .then((res) => {
        if (cancelled) return;
        const key = res.apiKey?.trim() || undefined;
        setSavedKey(key);
        setForm((d) => {
          // 用户正在输入新值时不覆盖；空字段时回显已保存的密钥
          if (d.apiKey !== "" && d.apiKey !== key) return d;
          return { ...d, apiKey: key ?? "" };
        });
      })
      .catch(() => {
        if (!cancelled) setSavedKey(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.id, selected?.configured, selected?.custom?.provider, config]);

  /** 打开添加供应商弹窗，可选预填预设 */
  function openCreate(preset?: Partial<Draft>) {
    setModelDialog(undefined);
    setDraft({ ...EMPTY_DRAFT, ...preset });
    setProviderDialogOpen(true);
  }

  /** 打开编辑模型弹窗 */
  function openEdit(provider: ModelsJsonProviderView, modelId: string) {
    const model = provider.models.find((m) => m.id === modelId);
    setProviderDialogOpen(false);
    setDraft({
      provider: provider.provider,
      baseUrl: provider.baseUrl ?? "",
      api: coerceApiKind(provider.api),
      modelId: model?.id ?? modelId,
      modelName: model?.name ?? "",
      contextWindow: model?.contextWindow ? String(model.contextWindow) : "",
      apiKey: "",
      proxy: provider.proxy ?? "",
      previousProvider: provider.provider,
      previousModelId: modelId,
    });
    setModelDialog("edit");
  }

  function openAddModels(provider: ModelsJsonProviderView) {
    setProviderDialogOpen(false);
    setDraft({
      ...EMPTY_DRAFT,
      provider: provider.provider,
      baseUrl: provider.baseUrl ?? "",
      api: coerceApiKind(provider.api),
      proxy: provider.proxy ?? "",
      previousProvider: provider.provider,
    });
    setModelDialog("add");
  }

  function closeProviderDialog() {
    setProviderDialogOpen(false);
  }

  function closeModelDialog() {
    setModelDialog(undefined);
  }

  /** 保存新供应商到 models.json（按钮在表单外，必填项在此手动校验） */
  async function saveProvider(e?: React.FormEvent) {
    e?.preventDefault();
    const provider = draft.provider.trim();
    if (!provider) {
      props.onToast("请填写供应商 ID", "warning");
      return;
    }
    if (!PROVIDER_ID_RE.test(provider)) {
      props.onToast(PROVIDER_ID_RULE, "warning");
      return;
    }
    if (!draft.baseUrl.trim()) {
      props.onToast("请填写 Base URL", "warning");
      return;
    }
    const modelId = draft.modelId.trim();
    setBusy(true);
    try {
      const next = await rpc<ModelsJsonConfigView>("upsertCustomProvider", {
        provider,
        baseUrl: draft.baseUrl.trim(),
        api: draft.api,
        modelId: modelId || undefined,
        modelName: modelId ? (draft.modelName.trim() || undefined) : undefined,
        contextWindow: modelId ? readContextWindow(draft.contextWindow) : undefined,
        apiKey: draft.apiKey.trim() || undefined,
        proxy: draft.proxy,
      });
      setConfig(next);
      closeProviderDialog();
      setSelectedId(provider);
      props.onToast("供应商已保存", "success");
      props.onActiveChanged();
    } catch (err) {
      props.onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  /** 保存添加/编辑模型 */
  async function saveModel(e?: React.FormEvent) {
    e?.preventDefault();
    const modelId = draft.modelId.trim();
    if (!modelId) {
      props.onToast("请填写模型 ID", "warning");
      return;
    }
    setBusy(true);
    try {
      if (modelDialog === "edit") {
        const next = await rpc<ModelsJsonConfigView>("upsertCustomProvider", {
          provider: draft.provider.trim(),
          baseUrl: draft.baseUrl.trim(),
          api: draft.api,
          modelId,
          modelName: draft.modelName.trim() || undefined,
          contextWindow: readContextWindow(draft.contextWindow),
          proxy: draft.proxy,
          previousProvider: draft.previousProvider,
          previousModelId: draft.previousModelId,
        });
        setConfig(next);
        props.onToast("模型已保存", "success");
      } else {
        const next = await rpc<ModelsJsonConfigView>("addProviderModels", {
          provider: draft.provider.trim(),
          models: [{
            id: modelId,
            name: draft.modelName.trim() || undefined,
            contextWindow: readContextWindow(draft.contextWindow),
          }],
        });
        setConfig(next);
        props.onToast(`已向 ${draft.provider} 添加模型 ${modelId}`, "success");
      }
      closeModelDialog();
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
          contextWindow: first.contextWindow,
          maxTokens: first.maxTokens,
          apiKey: apiKey.trim() || undefined,
        });
        const rest = def.models.slice(1);
        if (rest.length) {
          next = await rpc<ModelsJsonConfigView>("addProviderModels", {
            provider: def.id,
            models: rest.map((m) => ({
              id: m.id,
              name: m.name,
              contextWindow: m.contextWindow,
              maxTokens: m.maxTokens,
            })),
          });
        }
        setConfig(next);
        props.onToast(`${def.name} 已启用（${def.models.length} 个模型）`, "success");
      } else if (apiKey.trim()) {
        const next = await rpc<ModelsJsonConfigView>("setProviderApiKey", {
          provider: def.id,
          apiKey: apiKey.trim(),
        });
        setConfig(next);
        props.onToast(`已保存 ${def.name} 的 API 密钥`, "success");
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
        provider: draft.previousProvider || (modelDialog === "add" ? draft.provider : undefined),
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
      const providerId = fetchPicker.provider || draft.provider.trim();
      const exists = config?.providers.some((p) => p.provider === providerId);
      if (!exists) {
        if (!PROVIDER_ID_RE.test(providerId)) {
          props.onToast(PROVIDER_ID_RULE, "warning");
          return;
        }
        const first = models[0]!;
        next = await rpc<ModelsJsonConfigView>("upsertCustomProvider", {
          provider: providerId,
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
            provider: providerId,
            models: rest,
          });
        }
      } else {
        next = await rpc<ModelsJsonConfigView>("addProviderModels", {
          provider: providerId,
          models,
        });
      }
      setConfig(next);
      setFetchPicker(undefined);
      closeProviderDialog();
      closeModelDialog();
      props.onToast(`已导入 ${models.length} 个模型`, "success");
      props.onActiveChanged();
    } catch (err) {
      props.onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  /** 删除指定供应商及其全部模型（弹确认框后执行） */
  function removeProvider(provider: string) {
    setRemovePending({ kind: "provider", provider });
  }

  /** 删除指定模型（弹确认框后执行） */
  function removeModel(provider: string, modelId: string) {
    setRemovePending({ kind: "model", provider, modelId });
  }

  /** 确认删除后真正执行（供应商或单个模型） */
  async function executeRemovePending() {
    const target = removePending;
    if (!target) return;
    setRemovePending(undefined);
    setBusy(true);
    try {
      if (target.kind === "provider") {
        const next = await rpc<ModelsJsonConfigView>("removeCustomProvider", { provider: target.provider });
        setConfig(next);
        props.onToast(`已删除 ${target.provider}`, "info");
      } else {
        const next = await rpc<ModelsJsonConfigView>("removeCustomModel", {
          provider: target.provider,
          modelId: target.modelId,
        });
        setConfig(next);
        props.onToast(`已删除 ${target.provider}/${target.modelId}`, "info");
      }
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

  /** 清除指定供应商的 API 密钥 */
  async function clearKey(provider: string) {
    setBusy(true);
    try {
      const next = await rpc<ModelsJsonConfigView>("clearProviderApiKey", { provider });
      setConfig(next);
      setSavedKey(undefined);
      setForm((d) => ({ ...d, apiKey: "" }));
      props.onToast(`已清除 ${provider} 的 API 密钥`, "info");
      props.onActiveChanged();
    } catch (err) {
      props.onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveProviderMeta(nextForm = form) {
    const custom = selected?.custom;
    if (!custom) return;
    const first = custom.models[0];
    if (!first) {
      props.onToast("请先添加一个模型再保存供应商设置", "warning");
      return;
    }
    setBusy(true);
    try {
      const apiKeyChanged = Boolean(nextForm.apiKey.trim()) && nextForm.apiKey.trim() !== savedKey;
      const renamed = nextForm.name.trim() && nextForm.name.trim() !== custom.provider;
      const next = await rpc<ModelsJsonConfigView>("upsertCustomProvider", {
        provider: (renamed ? nextForm.name : custom.provider).trim(),
        baseUrl: nextForm.baseUrl.trim(),
        api: nextForm.api,
        modelId: first.id,
        modelName: first.name,
        contextWindow: first.contextWindow,
        maxTokens: first.maxTokens,
        apiKey: apiKeyChanged ? nextForm.apiKey.trim() : undefined,
        proxy: nextForm.proxy,
        previousProvider: custom.provider,
        previousModelId: first.id,
      });
      setConfig(next);
      if (renamed) setSelectedId(nextForm.name.trim());
      if (apiKeyChanged) {
        setSavedKey(nextForm.apiKey.trim());
        setForm((d) => ({ ...d, apiKey: nextForm.apiKey.trim() }));
      }
      props.onToast("供应商已保存", "success");
      props.onActiveChanged();
    } catch (err) {
      props.onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveApiKeyInline() {
    if (!selected) return;
    const key = form.apiKey.trim();
    if (!key || key === savedKey) return;
    if (selected.custom) {
      setBusy(true);
      try {
        const next = await rpc<ModelsJsonConfigView>("setProviderApiKey", {
          provider: selected.custom.provider,
          apiKey: key,
        });
        setConfig(next);
        setSavedKey(key);
        props.onToast(`已保存 ${selected.custom.provider} 的 API 密钥`, "success");
        props.onActiveChanged();
      } catch (err) {
        props.onToast(err instanceof Error ? err.message : String(err), "error");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (selected.builtin) await enableBuiltin(selected.builtin, key);
  }

  const models = selected?.custom?.models
    ?? selected?.builtin?.models.map((m) => ({
      id: m.id,
      name: m.name,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
    }))
    ?? [];

  return (
    <div className="providers-studio-wrap">
      {config?.error ? <p className="hint prov-error">{config.error}</p> : null}
      <div className="providers-studio">
        <aside className="prov-rail">
          <div className="prov-rail-search">
            <Search size={14} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索供应商…"
            />
          </div>
          <div className="prov-rail-scroll">
            {visibleNav.length ? visibleNav.map((group) => (
              <section key={group.label} className="prov-rail-group">
                <div className="prov-rail-label">{group.label}</div>
                {group.items.map((item) => {
                  const Icon = item.source === "extension" ? Puzzle : item.builtin ? Hexagon : Box;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`prov-rail-item${item.id === selectedId ? " is-active" : ""}`}
                      onClick={() => setSelectedId(item.id)}
                    >
                      <Icon size={15} className={`prov-rail-icon${item.builtin && item.source !== "extension" ? " is-catalog" : ""}`} />
                      <span className="prov-rail-name">{item.name}</span>
                      <span className={`prov-dot${item.hasKey ? " is-on" : ""}`} title={item.hasKey ? "已配置密钥" : "未配置密钥"} />
                    </button>
                  );
                })}
              </section>
            )) : (
              <p className="hint prov-rail-empty">{query.trim() ? "无匹配供应商" : "暂无供应商"}</p>
            )}
          </div>
          <button type="button" className="prov-rail-add" disabled={busy} onClick={() => openCreate()}>
            <Plus size={15} /> 添加供应商
          </button>
        </aside>

        <div className="prov-main">
          {selected ? (
            <>
              <header className="prov-head">
                <div className="prov-head-title">
                  {nameEditing && !selected.builtin ? (
                    <input
                      className="prov-name-input"
                      value={form.name}
                      autoFocus
                      onChange={(e) => setForm((d) => ({ ...d, name: e.target.value }))}
                      onBlur={() => {
                        setNameEditing(false);
                        if (form.name.trim() && form.name.trim() !== selected.custom?.provider) {
                          void saveProviderMeta();
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        if (e.key === "Escape") setNameEditing(false);
                      }}
                    />
                  ) : (
                    <span>{selected.builtin?.name ?? selected.custom?.provider ?? selected.id}</span>
                  )}
                  {!selected.builtin ? (
                    <button type="button" className="prov-icon-btn" title="重命名" onClick={() => setNameEditing(true)}>
                      <Pencil size={14} />
                    </button>
                  ) : null}
                  {selected.configured ? (
                    <span className="prov-pill is-on">已启用</span>
                  ) : (
                    <button
                      type="button"
                      className="prov-pill is-action"
                      disabled={busy}
                      onClick={() => {
                        if (selected.builtin) {
                          setBuiltinKeyDialog(selected.builtin);
                          setKeyDraft(form.apiKey);
                        } else openCreate({ provider: selected.id });
                      }}
                    >
                      启用
                    </button>
                  )}
                  <button
                    type="button"
                    className="prov-pill"
                    disabled={busy || !selected.configured}
                    onClick={() => {
                      if (selected.custom) void removeProvider(selected.custom.provider);
                    }}
                  >
                    禁用
                  </button>
                </div>
                {selected.custom ? (
                  <button
                    type="button"
                    className="prov-icon-btn is-danger"
                    title="删除供应商"
                    disabled={busy}
                    onClick={() => void removeProvider(selected.custom!.provider)}
                  >
                    <Trash2 size={15} />
                  </button>
                ) : null}
              </header>

              {selected.builtin?.description ? (
                <p className="prov-desc">
                  {selected.builtin.description}
                  {selected.builtin.docsUrl ? (
                    <>
                      {" "}
                      <a className="prov-docs" href={selected.builtin.docsUrl} target="_blank" rel="noreferrer">
                        文档
                      </a>
                    </>
                  ) : null}
                </p>
              ) : selected.builtin?.docsUrl ? (
                <a className="prov-docs" href={selected.builtin.docsUrl} target="_blank" rel="noreferrer">文档</a>
              ) : null}

              <div className="prov-fields">
                <Input
                  label="Base URL"
                  value={form.baseUrl}
                  placeholder="https://api.openai.com/v1"
                  disabled={busy || (!selected.configured && !selected.local)}
                  onChange={(baseUrl) => setForm((d) => ({ ...d, baseUrl }))}
                  onBlur={() => {
                    if (selected.configured && form.baseUrl !== (selected.custom?.baseUrl ?? "")) void saveProviderMeta();
                  }}
                />
                <Select
                  label="API 格式"
                  value={form.api}
                  options={API_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                  disabled={busy || !selected.configured}
                  onChange={(api) => {
                    const next = { ...form, api: api as ApiKind };
                    setForm(next);
                    if (selected.configured) void saveProviderMeta(next);
                  }}
                />
                <Field label="API Key" hint="仅保存在本地 models.json。已保存的密钥会回显（默认掩码，点击眼睛可查看明文）。">
                  <div className="prov-secret">
                    <input
                      className="ui-input"
                      type={showKey ? "text" : "password"}
                      value={form.apiKey}
                      disabled={busy}
                      placeholder={selected.hasKey ? "••••••••••••" : "sk-…"}
                      onChange={(e) => setForm((d) => ({ ...d, apiKey: e.target.value }))}
                      onBlur={() => void saveApiKeyInline()}
                    />
                    <button type="button" className="prov-secret-toggle" title={showKey ? "隐藏" : "显示"} onClick={() => setShowKey((v) => !v)}>
                      {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  {selected.hasKey && selected.custom ? (
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => void clearKey(selected.custom!.provider)}>
                      清除密钥
                    </Button>
                  ) : null}
                </Field>
                {selected.configured || selected.local ? (
                  <Input
                    label="网络代理"
                    hint="仅该供应商生效。支持 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080。"
                    value={form.proxy}
                    placeholder="http://127.0.0.1:7890"
                    disabled={busy || !selected.configured}
                    onChange={(proxy) => setForm((d) => ({ ...d, proxy }))}
                    onBlur={() => {
                      if (selected.configured && form.proxy !== (selected.custom?.proxy ?? "")) void saveProviderMeta();
                    }}
                  />
                ) : null}
              </div>

              <div className="prov-models-head">
                <h3>模型列表</h3>
                <div className="prov-models-actions">
                  {selected.builtin?.refreshable ? (
                    <Button variant="ghost" size="sm" disabled={refreshBusy === selected.id || busy} onClick={() => void refreshModels(selected.builtin!)}>
                      {refreshBusy === selected.id ? "刷新中…" : "刷新模型"}
                    </Button>
                  ) : null}
                  {selected.custom ? (
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => void fetchModelsForProvider(selected.custom!)}>
                      <CloudDownload size={14} /> 从接口拉取
                    </Button>
                  ) : null}
                  {selected.custom ? (
                    <Button variant="ghost" size="sm" disabled={busy || probeBusy === selected.custom.provider} onClick={() => void probe({
                      provider: selected.custom!.provider,
                      baseUrl: selected.custom!.baseUrl,
                      api: selected.custom!.api,
                      proxy: selected.custom!.proxy,
                    })}>
                      {probeBusy === selected.custom.provider ? "测试中…" : "测试连接"}
                    </Button>
                  ) : selected.builtin ? (
                    <Button variant="ghost" size="sm" disabled={probeBusy === selected.id} onClick={() => void probe({ provider: selected.id })}>
                      {probeBusy === selected.id ? "测试中…" : "测试连接"}
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="prov-model-list">
                {models.length ? models.map((model) => {
                  const active = props.activeProvider === selected.id && props.activeModel === model.id;
                  const ctx = formatContextWindow(model.contextWindow);
                  return (
                    <div key={model.id} className={`prov-model-card${active ? " is-active" : ""}`}>
                      <div className="prov-model-copy">
                        <span className="prov-model-name">{model.name || model.id}</span>
                        {ctx ? <span className="prov-model-badge">{ctx}</span> : null}
                        {active ? <span className="auth-badge ok">当前</span> : null}
                      </div>
                      <div className="prov-model-ops">
                        <button type="button" className="prov-icon-btn" title={active ? "当前模型" : "使用该模型"} disabled={busy || active} onClick={() => void useModel(selected.id, model.id)}>
                          <Plug size={14} />
                        </button>
                        {selected.custom ? (
                          <>
                            <button type="button" className="prov-icon-btn" title="编辑" disabled={busy} onClick={() => openEdit(selected.custom!, model.id)}>
                              <Pencil size={14} />
                            </button>
                            <button type="button" className="prov-icon-btn is-danger" title="删除" disabled={busy} onClick={() => void removeModel(selected.custom!.provider, model.id)}>
                              <Trash2 size={14} />
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  );
                }) : (
                  <p className="hint">暂无模型。可手动添加，或从接口拉取。</p>
                )}
                {selected.custom ? (
                  <button type="button" className="prov-add-model" disabled={busy} onClick={() => openAddModels(selected.custom!)}>
                    <Plus size={15} /> 添加模型
                  </button>
                ) : selected.builtin?.local ? (
                  <button type="button" className="prov-add-model" disabled={busy} onClick={() => openCreate({
                    provider: selected.id,
                    baseUrl: selected.builtin?.baseUrl ?? "",
                    api: coerceApiKind(selected.builtin?.api),
                  })}>
                    <Plus size={15} /> 配置
                  </button>
                ) : null}
              </div>
              {config?.path ? <p className="hint prov-path">{config.path}</p> : null}
            </>
          ) : (
            <div className="prov-empty">
              <h2>选择一个供应商</h2>
              <p>从左侧列表选择，或添加自定义兼容端点。</p>
              <Button onClick={() => openCreate()}><Plus size={14} /> 添加供应商</Button>
            </div>
          )}
        </div>
      </div>

      {providerDialogOpen ? (
        <Dialog
          open
          size="md"
          title="添加供应商"
          footer={
            <>
              <Button variant="secondary" disabled={busy} onClick={closeProviderDialog}>
                取消
              </Button>
              <Button disabled={busy} onClick={() => void saveProvider()}>保存</Button>
            </>
          }
        >
          <form className="ui-dialog__form" onSubmit={(e) => void saveProvider(e)}>
            <Input
              label="供应商 ID"
              hint="用于标识供应商：字母或数字开头，仅可包含字母、数字与 . _ -，如 openai、my-gateway。"
              required
              status={draft.provider.trim() && !PROVIDER_ID_RE.test(draft.provider.trim())
                ? PROVIDER_ID_RULE
                : undefined}
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
            <Input
              label="初始模型 ID"
              hint="可留空：先只保存供应商，之后在详情页「添加模型」或从接口拉取。"
              value={draft.modelId}
              onChange={(modelId) => setDraft((d) => ({ ...d, modelId }))}
              placeholder="可留空，如 gpt-4.1"
            />
            <Input
              label="API 密钥"
              hint="保存在本地 models.json。留空则稍后在详情页设置。"
              type="password"
              value={draft.apiKey}
              onChange={(apiKey) => setDraft((d) => ({ ...d, apiKey }))}
              placeholder="可选，稍后也可单独设置"
            />
          </form>
        </Dialog>
      ) : null}

      {modelDialog ? (
        <Dialog
          open
          size="md"
          title={modelDialog === "edit"
            ? `编辑模型 · ${draft.provider}`
            : `添加模型 · ${draft.provider}`}
          footer={
            <>
              <Button variant="secondary" disabled={busy} onClick={closeModelDialog}>
                取消
              </Button>
              <Button disabled={busy} onClick={() => void saveModel()}>保存</Button>
            </>
          }
        >
          <form className="ui-dialog__form" onSubmit={(e) => void saveModel(e)}>
            <Input
              label="模型 ID"
              hint="请求时发送的 model 字段。"
              required
              autoFocus
              value={draft.modelId}
              onChange={(modelId) => setDraft((d) => ({ ...d, modelId }))}
              placeholder="gpt-4.1"
            />
            <Input
              label="模型别名"
              hint="仅用于界面展示，可留空，默认使用模型 ID。"
              value={draft.modelName}
              onChange={(modelName) => setDraft((d) => ({ ...d, modelName }))}
              placeholder="可选"
            />
            <Input
              label="上下文长度"
              hint="支持 128000、128K、1M。留空则默认 128K。"
              value={draft.contextWindow}
              onChange={(contextWindow) => setDraft((d) => ({ ...d, contextWindow }))}
              placeholder="128K"
            />
          </form>
        </Dialog>
      ) : null}

      {fetchPicker ? (
        <Dialog
          open
          size="lg"
          title="选择要导入的模型"
          cardClassName="model-pick-card"
          footer={
            <>
              <Button variant="secondary" disabled={busy} onClick={() => setFetchPicker(undefined)}>取消</Button>
              <Button disabled={busy} onClick={() => void importFetchedModels()}>
                导入选中
              </Button>
            </>
          }
        >
          <p className="ui-dialog__message">
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
        </Dialog>
      ) : null}

      {builtinKeyDialog ? (
        <Dialog
          open
          size="md"
          title={`${builtinKeyDialog.name} · API 密钥`}
          footer={
            <>
              <Button variant="secondary" disabled={busy} onClick={() => setBuiltinKeyDialog(undefined)}>取消</Button>
              <Button disabled={busy} onClick={() => void enableBuiltin(builtinKeyDialog, keyDraft)}>保存</Button>
            </>
          }
        >
          <form className="ui-dialog__form" onSubmit={(e) => void enableBuiltin(builtinKeyDialog, keyDraft, e)}>
            <p className="ui-dialog__message hint">
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
          </form>
        </Dialog>
      ) : null}

      <ConfirmDialog
        open={Boolean(removePending)}
        title={removePending?.kind === "provider" ? "删除供应商" : "删除模型"}
        variant="danger"
        confirmText="删除"
        message={
          removePending?.kind === "provider"
            ? `确定删除供应商「${removePending.provider}」及其全部模型？`
            : removePending
              ? `确定删除模型 ${removePending.provider}/${removePending.modelId}？`
              : ""
        }
        onCancel={() => setRemovePending(undefined)}
        onConfirm={() => void executeRemovePending()}
      />
    </div>
  );
}
