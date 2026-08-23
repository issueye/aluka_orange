/**
 * 设置视图（「设置」页面）
 *
 * 左侧分组导航 rail（搜索过滤 + 图标项），右侧 zeno 式内容列
 * （大标题行 + 分区标签 + 分组卡片 + 行式设置项）。
 * 表单草稿（API Key）与设置分区状态均为本视图局部状态；
 * 插件安装/管理在「扩展」页（ExtensionsView）。
 */
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  Folder,
  Info,
  Palette,
  Puzzle,
  Search,
  Sparkles,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { rpc } from "../bridge.ts";
import { ProvidersPanel } from "../ProvidersPanel.tsx";
import { UsagePanel } from "../UsagePanel.tsx";
import { PluginSettingsSection } from "./PluginSettingsSection.tsx";
import { EnvVarsSection } from "./EnvVarsSection.tsx";
import { Button, Input, Slider, Switch } from "../components/index.ts";
import type { WorkspaceItem } from "../WorkspaceSidebar.tsx";
import type {
  SessionUsageView,
  SettingsView as SettingsState,
  Toast,
} from "../types.ts";
import { pathsEqual, formatUsage } from "../lib/utils.ts";

/** 设置页内的子分区 */
type SettingsSection = "workspace" | "providers" | "appearance" | "usage" | "about" | "env" | "plugins";

/** 侧栏宽度默认值 / 允许范围（与 agent 侧 settings.ts 约定一致） */
const SIDEBAR_WIDTH_DEFAULT = 288;
const SIDEBAR_WIDTH_MIN = 220;
const SIDEBAR_WIDTH_MAX = 480;

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
    id: "other",
    label: "其他",
    items: [
      { id: "plugins", label: "插件设置", icon: Puzzle },
      { id: "env", label: "环境变量", icon: TerminalSquare },
      { id: "about", label: "关于", icon: Info },
    ],
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
  chooseWorkspace: (mode: "latest" | "new") => void;
  /** 使用临时工作区 */
  createTempWorkspace: () => Promise<void>;
  /** 切换工作区 */
  selectWorkspace: (cwd: string, mode?: "latest" | "new") => Promise<void>;
  /** 从列表移除工作区（不删除磁盘文件） */
  removeWorkspace: (cwd: string) => Promise<void>;
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
  const [usageReloadKey, setUsageReloadKey] = useState(0);  // 用量面板手动刷新信号

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

  /** 保存通用设置（cwd / 模型 / 供应商 / baseUrl / 主题 / 侧栏宽度 / API Key） */
  async function saveGeneralSettings() {
    const patch: Record<string, unknown> = {
      cwd: (settings.cwd ?? "").trim(),
      model: (settings.model ?? "").trim(),
      provider: (settings.provider ?? "").trim(),
      baseUrl: (settings.baseUrl ?? "").trim(),
      theme: props.theme,
      sidebarWidth: settings.sidebarWidth ?? SIDEBAR_WIDTH_DEFAULT,
    };
    if (apiKeyDraft.trim()) patch.apiKey = apiKeyDraft.trim();
    await rpc("patchSettings", patch);
    setApiKeyDraft("");
    await props.loadSettings();
    await props.refreshSessions();
    toast("设置已保存", "success");
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
                        <div className="settings-row-desc">点击切换到已添加的工作区并恢复最近会话；悬停行可移除（不删除磁盘文件）。</div>
                        <ul className="ws-settings-list">
                          {props.workspaces.map((ws) => (
                            <li key={ws.path} className={pathsEqual(ws.path, settings.cwd) ? "active" : ""}>
                              <button
                                type="button"
                                className="ws-settings-pick"
                                onClick={() => void props.selectWorkspace(ws.path, "latest")}
                              >
                                <strong>{ws.name}</strong>
                                <span>{ws.path}</span>
                              </button>
                              <button
                                type="button"
                                className="ws-settings-remove"
                                title={`移除工作区（不删除文件）：${ws.path}`}
                                onClick={() => void props.removeWorkspace(ws.path)}
                              >
                                <Trash2 size={13} strokeWidth={1.75} />
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
          <div className="settings-page-shell settings-page-shell--providers">
            <ProvidersPanel
              activeProvider={settings.provider}
              activeModel={settings.model}
              onToast={toast}
              onActiveChanged={() => {
                void props.loadSettings();
              }}
            />
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
              <section className="settings-section-block">
                <h2 className="settings-section-label">界面尺寸</h2>
                <div className="settings-card">
                  <div className="settings-row settings-row-col settings-row-last">
                    <div className="settings-row-copy">
                      <div className="settings-row-title">侧栏宽度</div>
                      <div className="settings-row-desc">
                        拖动调节左侧栏宽度（{SIDEBAR_WIDTH_MIN}–{SIDEBAR_WIDTH_MAX}px），调节即时生效，保存后写入设置。下图按实际像素比例预览。
                      </div>
                      <div className="sidebar-width-preview">
                        <div
                          className="sidebar-width-preview__bar"
                          style={{ width: `${settings.sidebarWidth ?? SIDEBAR_WIDTH_DEFAULT}px` }}
                        >
                          <span>侧栏 {settings.sidebarWidth ?? SIDEBAR_WIDTH_DEFAULT}px</span>
                        </div>
                        <div className="sidebar-width-preview__rest">对话区</div>
                      </div>
                    </div>
                    <div className="settings-row-stack">
                      <div className="sidebar-width-controls">
                        <Slider
                          value={settings.sidebarWidth ?? SIDEBAR_WIDTH_DEFAULT}
                          min={SIDEBAR_WIDTH_MIN}
                          max={SIDEBAR_WIDTH_MAX}
                          step={4}
                          suffix="px"
                          onChange={(next) => setSettings((s) => ({ ...s, sidebarWidth: next }))}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={(settings.sidebarWidth ?? SIDEBAR_WIDTH_DEFAULT) === SIDEBAR_WIDTH_DEFAULT}
                          onClick={() => setSettings((s) => ({ ...s, sidebarWidth: SIDEBAR_WIDTH_DEFAULT }))}
                        >
                          默认
                        </Button>
                      </div>
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
                <Button
                  variant="secondary"
                  onClick={() => {
                    void props.refreshUsage(props.activeId);
                    setUsageReloadKey((key) => key + 1);
                  }}
                >
                  刷新用量
                </Button>
              </div>
            </div>
            <UsagePanel reloadKey={usageReloadKey} />
            <div className="settings-page-sections usage-session-section">
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
        {section === "env" && <EnvVarsSection />}
        {section === "plugins" && <PluginSettingsSection />}
      </div>
    </div>
  );
}
