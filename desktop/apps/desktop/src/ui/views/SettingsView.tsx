/**
 * 设置视图（「设置」页面）
 *
 * 左侧分组导航 rail（搜索过滤 + 图标项），右侧 zeno 式内容列
 * （大标题行 + 分区标签 + 分组卡片 + 行式设置项）。
 * 表单草稿（API Key / 包路径 / npm 规格）与设置分区状态均为本视图局部状态。
 */
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  Boxes,
  Folder,
  Info,
  Palette,
  Search,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { rpc, bridge } from "../bridge.ts";
import { ProvidersPanel } from "../ProvidersPanel.tsx";
import { Button, Input, Switch } from "../components/index.ts";
import type { WorkspaceItem } from "../WorkspaceSidebar.tsx";
import type {
  SessionUsageView,
  SettingsView as SettingsState,
  Toast,
} from "../types.ts";
import { pathsEqual, formatUsage } from "../lib/utils.ts";

/** 设置页内的子分区 */
type SettingsSection = "workspace" | "providers" | "appearance" | "packages" | "usage" | "about";

/** 设置页左侧导航：分组 + 图标（参考 zeno settings rail 的信息架构） */
const SETTINGS_NAV_GROUPS: Array<{
  id: string;
  label: string;
  items: Array<{ id: SettingsSection; label: string; icon: LucideIcon }>;
}> = [
  {
    id: "general",
    label: "通用",
    items: [
      { id: "workspace", label: "工作区", icon: Folder },
      { id: "appearance", label: "外观", icon: Palette },
    ],
  },
  {
    id: "models",
    label: "模型",
    items: [
      { id: "providers", label: "供应商", icon: Sparkles },
      { id: "usage", label: "用量", icon: BarChart3 },
    ],
  },
  {
    id: "extensions",
    label: "扩展",
    items: [{ id: "packages", label: "扩展包", icon: Boxes }],
  },
  {
    id: "other",
    label: "其他",
    items: [{ id: "about", label: "关于", icon: Info }],
  },
];

export function SettingsView(props: {
  settings: SettingsState;
  setSettings: (next: SettingsState | ((prev: SettingsState) => SettingsState)) => void;
  /** 当前主题（由设置派生，App 壳持有） */
  theme: "dark" | "light";
  workspaces: WorkspaceItem[];
  /** 会话用量（App 壳持有，对话页也使用） */
  usage: SessionUsageView | undefined;
  /** 关于信息（版本 · 阶段，来自 Host 启动） */
  about: string;
  /** 更新检查提示（App 壳监听 update.check 事件维护） */
  updateHint: string;
  /** 触发更新检查 */
  onCheckUpdates: () => void;
  /** 刷新指定会话用量 */
  refreshUsage: (id?: string) => Promise<void>;
  activeId: string | undefined;
  /** 选择工作区（原生文件夹选择，失败时由 App 打开路径弹窗） */
  chooseWorkspace: (mode: "latest" | "new") => Promise<void>;
  /** 使用临时工作区 */
  createTempWorkspace: () => Promise<void>;
  /** 切换工作区 */
  selectWorkspace: (cwd: string, mode?: "latest" | "new") => Promise<void>;
  /** 返回对话视图 */
  onBack: () => void;
  /** 重载全局设置（保存 / 安装后由 App 壳刷新 settings 与模型选项） */
  loadSettings: () => Promise<void>;
  /** 刷新工作区树（保存 cwd 变更后） */
  refreshSessions: () => Promise<void>;
  onToast: (message: string, level?: Toast["level"]) => void;
}) {
  const { settings, setSettings } = props;
  const toast = props.onToast;

  // ── 本视图局部状态 ──
  const [section, setSection] = useState<SettingsSection>("workspace"); // 当前子分区
  const [navQuery, setNavQuery] = useState("");             // 设置导航过滤词
  const [apiKeyDraft, setApiKeyDraft] = useState("");       // API Key 输入草稿
  const [pkgPath, setPkgPath] = useState("");               // 本地扩展包路径输入
  const [npmSpec, setNpmSpec] = useState("");               // npm 包规格输入
  const [npmHint, setNpmHint] = useState("");               // npm 安装结果提示
  const [packages, setPackages] = useState<string[]>([]);   // 已注册的本地扩展包
  const [modelsPreviewHtml, setModelsPreview] = useState<string>(""); // models.json 预览

  /** 挂载即加载本地扩展包清单与 models.json 预览 */
  useEffect(() => {
    void (async () => {
      try {
        const pkgs = (await rpc<string[]>("listLocalPackages")) ?? settings.extraExtensions ?? [];
        setPackages(pkgs);
      } catch {
        setPackages(settings.extraExtensions ?? []);
      }
      const preview = await rpc<{
        sources: Array<{
          path: string;
          exists: boolean;
          error?: string;
          providers: Array<{
            provider: string;
            baseUrl?: string;
            api?: string;
            hasApiKeyField: boolean;
            models: Array<{ id: string; name?: string }>;
          }>;
        }>;
      }>("getModelsJsonPreview");
      const blocks: string[] = [];
      for (const source of preview?.sources ?? []) {
        blocks.push(`${source.path} — ${source.exists ? (source.error ?? "ok") : "missing"}`);
        for (const p of source.providers ?? []) {
          blocks.push(
            `  ${p.provider}: ${p.api || "?"} · ${p.baseUrl || "default"} · models ${p.models.map((m) => m.id).join(", ") || "—"} · key:${p.hasApiKeyField ? "yes" : "no"}`,
          );
        }
      }
      setModelsPreview(blocks.join("\n") || "未找到 models.json");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 手动安装（settings 页 npm 表单）结果回传：更新提示与清单 */
  useEffect(() => {
    const onPackageInstall = (raw: unknown) => {
      const result = raw as { ok?: boolean; error?: string; packageName?: string; entryPath?: string; runner?: string };
      if (result?.ok) {
        setNpmHint(`已通过 ${result.runner} 安装 ${result.packageName} → ${result.entryPath}`);
        setNpmSpec("");
        void rpc<string[]>("listLocalPackages").then((pkgs) => setPackages(pkgs ?? [])).catch(() => {});
      } else {
        setNpmHint(result?.error ?? "安装失败");
      }
    };
    const bus = bridge().events;
    bus.on("package.install", onPackageInstall);
    return () => bus.off("package.install", onPackageInstall);
  }, []);

  /** 设置导航分组过滤（按分组名 / 项目名，大小写不敏感） */
  const navGroups = useMemo(() => {
    const needle = navQuery.trim().toLowerCase();
    if (!needle) return SETTINGS_NAV_GROUPS;
    return SETTINGS_NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          item.label.toLowerCase().includes(needle) ||
          group.label.toLowerCase().includes(needle),
      ),
    })).filter((group) => group.items.length > 0);
  }, [navQuery]);

  /** 保存通用设置（cwd / 模型 / 供应商 / baseUrl / 主题 / API Key） */
  async function saveGeneralSettings() {
    const patch: Record<string, unknown> = {
      cwd: (settings.cwd ?? "").trim(),
      model: (settings.model ?? "").trim(),
      provider: (settings.provider ?? "").trim(),
      baseUrl: (settings.baseUrl ?? "").trim(),
      theme: props.theme,
    };
    if (apiKeyDraft.trim()) patch.apiKey = apiKeyDraft.trim();
    await rpc("patchSettings", patch);
    setApiKeyDraft("");
    await props.loadSettings();
    await props.refreshSessions();
    toast("设置已保存", "info");
  }

  return (
    <div className="settings-split" data-aluka-drag="no-drag">
      <nav className="settings-nav">
        <button type="button" className="settings-rail-back" onClick={props.onBack}>
          <ArrowLeft size={14} strokeWidth={1.75} />
          <span className="truncate">返回对话</span>
        </button>
        <div className="settings-nav-search">
          <Search size={14} strokeWidth={1.75} className="settings-search-icon" />
          <input
            type="search"
            className="settings-search-input"
            value={navQuery}
            placeholder="搜索设置项…"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setNavQuery(e.target.value)}
          />
        </div>
        <div className="settings-nav-scroll">
          {navGroups.length === 0 ? (
            <p className="settings-nav-empty">没有匹配的设置项</p>
          ) : (
            navGroups.map((group) => (
              <div key={group.id} className="settings-nav-group">
                <p className="settings-rail-group-label">{group.label}</p>
                <div className="settings-rail-items">
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="settings-rail-item"
                      data-active={section === item.id}
                      onClick={() => setSection(item.id)}
                    >
                      <item.icon size={14} strokeWidth={1.75} className="settings-rail-item-icon" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </nav>

      <div className="settings-content">
        {section === "workspace" && (
          <div className="settings-page-shell">
            <div className="settings-page-title-row">
              <h1 className="settings-page-title">工作区</h1>
              <div className="settings-page-title-action">
                <Button onClick={() => void saveGeneralSettings()}>保存</Button>
              </div>
            </div>
            <div className="settings-page-sections">
              <section className="settings-section-block">
                <h2 className="settings-section-label">工作目录</h2>
                <div className="settings-card">
                  <div className={`settings-row settings-row-col${props.workspaces.length ? "" : " settings-row-last"}`}>
                    <div className="settings-row-copy">
                      <div className="settings-row-title">当前目录（cwd）</div>
                      <div className="settings-row-desc">
                        Agent 运行时的工作目录，影响相对路径、技能与本地扩展解析。留空并保存不会改路径；新对话未选择时使用临时目录。
                      </div>
                    </div>
                    <div className="settings-row-stack">
                      <Input
                        value={settings.cwd ?? ""}
                        placeholder="E:\codes\my-project"
                        onChange={(cwd) => setSettings((s) => ({ ...s, cwd }))}
                      />
                      <div className="settings-inline-actions">
                        <Button variant="secondary" size="sm" onClick={() => void props.chooseWorkspace("latest")}>
                          浏览文件夹
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => void props.createTempWorkspace()}>
                          使用临时目录
                        </Button>
                      </div>
                    </div>
                  </div>
                  {props.workspaces.length ? (
                    <div className="settings-row settings-row-col settings-row-last">
                      <div className="settings-row-copy">
                        <div className="settings-row-title">快速切换</div>
                        <div className="settings-row-desc">点击切换到已添加的工作区并恢复最近会话。</div>
                        <ul className="ws-settings-list">
                          {props.workspaces.map((ws) => (
                            <li key={ws.path} className={pathsEqual(ws.path, settings.cwd) ? "active" : ""}>
                              <button type="button" onClick={() => void props.selectWorkspace(ws.path, "latest")}>
                                <strong>{ws.name}</strong>
                                <span>{ws.path}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ) : null}
                </div>
              </section>
              <section className="settings-section-block">
                <h2 className="settings-section-label">模型与密钥</h2>
                <div className="settings-card">
                  <div className="settings-row settings-row-col settings-row-last">
                    <div className="settings-row-copy">
                      <div className="settings-row-title">全局回退 API Key</div>
                      <div className="settings-row-desc">
                        写入 settings.json，用作各供应商密钥的全局回退。
                        当前模型：{settings.provider || "—"}/{settings.model || "—"}
                        {settings.baseUrl ? ` · ${settings.baseUrl}` : ""}
                      </div>
                    </div>
                    <div className="settings-row-stack">
                      <Input
                        type="password"
                        value={apiKeyDraft}
                        placeholder="留空则保持不变"
                        onChange={setApiKeyDraft}
                      />
                      <p className="hint">
                        {settings.hasApiKey ? "已配置全局/环境密钥" : "未配置全局/环境密钥"}
                      </p>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        )}

        {section === "providers" && (
          <div className="settings-page-shell">
            <div className="settings-page-title-row">
              <h1 className="settings-page-title">供应商</h1>
            </div>
            <div className="settings-page-sections">
              <section className="settings-section-block">
                <ProvidersPanel
                  activeProvider={settings.provider}
                  activeModel={settings.model}
                  onToast={toast}
                  onActiveChanged={() => {
                    void props.loadSettings();
                  }}
                />
              </section>
              <details className="settings-details">
                <summary>models.json 只读预览（含 ~/.pi）</summary>
                <pre className="hint models-preview">{modelsPreviewHtml}</pre>
              </details>
            </div>
          </div>
        )}

        {section === "appearance" && (
          <div className="settings-page-shell">
            <div className="settings-page-title-row">
              <h1 className="settings-page-title">外观</h1>
              <div className="settings-page-title-action">
                <Button onClick={() => void saveGeneralSettings()}>保存</Button>
              </div>
            </div>
            <div className="settings-page-sections">
              <section className="settings-section-block">
                <h2 className="settings-section-label">主题</h2>
                <div className="settings-card">
                  <div className="settings-row settings-row-compact settings-row-last">
                    <div className="settings-row-copy">
                      <div className="settings-row-title">深色主题</div>
                      <div className="settings-row-desc">关闭后切换为浅色主题，立即预览；保存后写入设置。</div>
                    </div>
                    <div className="settings-row-control">
                      <Switch
                        checked={props.theme === "dark"}
                        onChange={(on) => {
                          const next = on ? "dark" : "light";
                          setSettings((s) => ({ ...s, theme: next }));
                          document.documentElement.setAttribute("data-theme", next);
                        }}
                      />
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        )}

        {section === "packages" && (
          <div className="settings-page-shell">
            <div className="settings-page-title-row">
              <h1 className="settings-page-title">扩展包</h1>
            </div>
            <div className="settings-page-sections">
              <section className="settings-section-block">
                <h2 className="settings-section-label">已注册本地扩展</h2>
                <div className="settings-card">
                  {packages.length ? (
                    packages.map((pkg, index) => (
                      <div
                        key={pkg}
                        className={`settings-row settings-row-compact${index === packages.length - 1 ? " settings-row-last" : ""}`}
                      >
                        <div className="settings-row-copy">
                          <div className="settings-row-title settings-row-title-mono">{pkg}</div>
                        </div>
                        <div className="settings-row-control">
                          <Button variant="ghost" size="sm" onClick={() => void (async () => {
                            await rpc("removeLocalPackage", { path: pkg });
                            const pkgs = (await rpc<string[]>("listLocalPackages")) ?? [];
                            setPackages(pkgs);
                          })()}>移除</Button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="settings-row settings-row-last">
                      <div className="settings-row-desc">
                        尚未注册本地扩展包。插件市场的搜索 / 安装 / 移除请使用侧栏「扩展」界面。
                      </div>
                    </div>
                  )}
                </div>
              </section>
              <section className="settings-section-block">
                <h2 className="settings-section-label">手动添加</h2>
                <div className="settings-card">
                  <div className="settings-row settings-row-col">
                    <div className="settings-row-copy">
                      <div className="settings-row-title">本地路径</div>
                      <div className="settings-row-desc">扩展入口文件或目录的绝对路径。</div>
                    </div>
                    <div className="settings-row-stack">
                      <Input
                        value={pkgPath}
                        placeholder="E:\path\to\extension.ts"
                        onChange={setPkgPath}
                      />
                      <div className="settings-inline-actions">
                        <Button variant="secondary" size="sm" onClick={() => void (async () => {
                          if (!pkgPath.trim()) return;
                          await rpc("addLocalPackage", { path: pkgPath.trim() });
                          setPkgPath("");
                          const pkgs = (await rpc<string[]>("listLocalPackages")) ?? [];
                          setPackages(pkgs);
                        })()}>添加路径</Button>
                      </div>
                    </div>
                  </div>
                  <div className="settings-row settings-row-col settings-row-last">
                    <div className="settings-row-copy">
                      <div className="settings-row-title">npm 包</div>
                      <div className="settings-row-desc">
                        npm 包名，或 file:./my-ext 本地包。安装到 ~/.aluka/agent/npm-packages；
                        同时会自动加载 ~/.pi/agent/settings.json 里 packages（npm: / git:）已安装的插件。
                      </div>
                    </div>
                    <div className="settings-row-stack">
                      <Input
                        value={npmSpec}
                        placeholder="npm 包名或 file:./my-ext"
                        onChange={setNpmSpec}
                      />
                      <div className="settings-inline-actions">
                        <Button variant="secondary" size="sm" onClick={() => {
                          if (!npmSpec.trim()) return;
                          setNpmHint(`正在安装 ${npmSpec}…`);
                          void rpc("installNpmPackage", { spec: npmSpec.trim() });
                        }}>安装</Button>
                      </div>
                      {npmHint ? <p className="settings-meta">{npmHint}</p> : null}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        )}

        {section === "usage" && (
          <div className="settings-page-shell">
            <div className="settings-page-title-row">
              <h1 className="settings-page-title">用量</h1>
              <div className="settings-page-title-action">
                <Button variant="secondary" onClick={() => void props.refreshUsage(props.activeId)}>刷新用量</Button>
              </div>
            </div>
            <div className="settings-page-sections">
              <section className="settings-section-block">
                <h2 className="settings-section-label">当前会话</h2>
                <div className="settings-card">
                  <div className="settings-row settings-row-col settings-row-last">
                    <div className="settings-row-copy">
                      <div className="settings-row-title">Token 用量与估算费用</div>
                      <p className="settings-meta" id="usage-summary">
                        {props.usage
                          ? `${formatUsage(props.usage)}\n${props.usage.note}`
                          : "当前会话尚无 token 用量。"}
                      </p>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        )}

        {section === "about" && (
          <div className="settings-page-shell">
            <div className="settings-page-title-row">
              <h1 className="settings-page-title">关于</h1>
              <div className="settings-page-title-action">
                <Button variant="secondary" onClick={props.onCheckUpdates}>检查更新</Button>
              </div>
            </div>
            <div className="settings-page-sections">
              <section className="settings-section-block">
                <h2 className="settings-section-label">版本</h2>
                <div className="settings-card">
                  <div className="settings-row settings-row-col">
                    <div className="settings-row-copy">
                      <div className="settings-row-title">Aluka Desktop</div>
                      <div className="settings-row-desc">{props.about}</div>
                    </div>
                  </div>
                  <div className="settings-row settings-row-col settings-row-last">
                    <div className="settings-row-copy">
                      <div className="settings-row-title">更新</div>
                      <div className="settings-row-desc">
                        可选：设置环境变量 ALUKA_DESKTOP_RELEASES_URL 指向 GitHub releases/latest JSON，以启用检查更新。
                      </div>
                      <p className="settings-meta">{props.updateHint}</p>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
