/**
 * 扩展视图（「扩展」页面，全宽布局）
 *
 * 三个页签：
 * - 工具：插件市场（发现）与已安装插件、已加载扩展、加载错误
 * - 提示词：.aluka/prompts 下的 Markdown 提示词片段，可一键插入对话输入框
 * - 技能：自动注入系统提示的技能文件清单
 *
 * 安装结果经 package.install 事件回传；全局 header 的「重载扩展」会触发
 * aluka:extensions-reloaded 事件，本视图监听后刷新全部清单。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { rpc, bridge } from "../bridge.ts";
import { Button, LoadingBlock, SectionHead, Spinner } from "../components/index.ts";
import type { InstalledPkg, MarketRow, PromptItem, SkillItem, Toast } from "../types.ts";

/** 市场分页大小（与 zeno 桌面壳一致：每页 20，触底加载下一页） */
const CATALOG_PAGE = 20;

/** 已加载扩展清单条目 */
type ExtEntry = { path: string; tools: string[]; commands: string[] };

/** 顶层页签 */
type ExtTab = "tools" | "prompts" | "skills";
/** 「工具」页签内的子页签 */
type ToolsSubTab = "installed" | "discover";

export function ExtensionsView(props: {
  /** 全局 Toast（由 App 壳提供） */
  onToast: (message: string, level?: Toast["level"]) => void;
  /** 安装/卸载后需要刷新的全局状态（设置 / 模型选项） */
  onSettingsChanged: () => Promise<void>;
  /** 返回对话视图 */
  onBack: () => void;
}) {
  const toast = props.onToast;

  // ── 页签状态 ──
  const [tab, setTab] = useState<ExtTab>("tools");
  const [toolsSubTab, setToolsSubTab] = useState<ToolsSubTab>("installed");

  // ── 扩展清单（已加载扩展 / 错误） ──
  const [extSummary, setExtSummary] = useState("");
  const [extLoading, setExtLoading] = useState(true); // 清单首次/手动刷新加载中
  const [extList, setExtList] = useState<ExtEntry[]>([]);
  const [extErrors, setExtErrors] = useState<Array<{ path: string; error: string }>>([]);

  // ── 提示词 / 技能清单 ──
  const [prompts, setPrompts] = useState<PromptItem[] | undefined>();
  const [promptsFilter, setPromptsFilter] = useState("");
  const [skills, setSkills] = useState<SkillItem[] | undefined>();
  const [skillsFilter, setSkillsFilter] = useState("");

  // ── 市场目录（工具 → 发现） ──
  const [catalogQuery, setCatalogQuery] = useState("");        // 市场搜索词（320ms 防抖自动查询）
  const [catalog, setCatalog] = useState<MarketRow[]>([]);     // 市场结果（累计页）
  const [catalogTotal, setCatalogTotal] = useState(0);         // registry 报告的匹配总数
  const [catalogLoading, setCatalogLoading] = useState(false); // 市场首页加载中
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false); // 市场下一页加载中
  const [catalogError, setCatalogError] = useState<string>();  // 市场查询错误
  const [marketBusy, setMarketBusy] = useState<string | undefined>(); // 市场安装/卸载中的包名
  const [installedPkgs, setInstalledPkgs] = useState<InstalledPkg[]>([]); // npm-packages 已安装插件
  const [installedFilter, setInstalledFilter] = useState("");  // 已安装列表本地过滤词
  const catalogLoadGen = useRef(0);                    // 市场查询代数（丢弃过期响应防竞态）
  const catalogLoadingMoreRef = useRef(false);          // 下一页在途标记（防重复触发）
  const catalogEndRef = useRef<HTMLDivElement | null>(null); // 触底哨兵（无限滚动）

  /** 刷新扩展、提示词、技能列表及加载错误信息 */
  async function refreshInventories() {
    setExtLoading(true);
    try {
      const [inv, promptList, skillList] = await Promise.all([
        rpc<{ extensions?: ExtEntry[]; errors?: Array<{ path: string; error: string }> }>("listExtensions"),
        rpc<PromptItem[]>("listPrompts"),
        rpc<SkillItem[]>("listSkills"),
      ]);
      setExtList(inv?.extensions ?? []);
      setExtErrors(inv?.errors ?? []);
      setPrompts(promptList ?? []);
      setSkills(skillList ?? []);
      const errCount = inv?.errors?.length ?? 0;
      setExtSummary(
        `扩展 ${inv?.extensions?.length ?? 0} · 提示词 ${promptList?.length ?? 0} · 技能 ${skillList?.length ?? 0}`
          + (errCount ? ` · 错误 ${errCount}` : ""),
      );
    } finally {
      setExtLoading(false);
    }
  }

  /** 刷新已安装插件清单（~/.aluka/agent/npm-packages） */
  async function loadInstalledPackages() {
    try {
      setInstalledPkgs(await rpc<InstalledPkg[]>("listInstalledPackages"));
    } catch {
      // 静默失败：清单仅为辅助展示
    }
  }

  /** 市场首页查询（代数计数丢弃过期响应，防抖/切 Tab/回车共用） */
  async function loadCatalog(query = catalogQuery) {
    const gen = ++catalogLoadGen.current;
    setCatalogLoading(true);
    setCatalogError(undefined);
    setCatalogLoadingMore(false);
    catalogLoadingMoreRef.current = false;
    try {
      const result = await rpc<{ packages: MarketRow[]; total: number }>("searchPackages", {
        query: query.trim() || undefined,
        limit: CATALOG_PAGE,
        from: 0,
      });
      if (gen !== catalogLoadGen.current) return;
      setCatalog(result?.packages ?? []);
      setCatalogTotal(result?.total ?? 0);
    } catch (err) {
      if (gen !== catalogLoadGen.current) return;
      setCatalog([]);
      setCatalogTotal(0);
      setCatalogError(err instanceof Error ? err.message : String(err));
    } finally {
      if (gen === catalogLoadGen.current) setCatalogLoading(false);
    }
  }

  /** 市场下一页追加（按包名去重；registry 无更多时钳制 total 停止翻页） */
  async function loadMoreCatalog() {
    if (catalog.length >= catalogTotal || catalogLoading || catalogLoadingMoreRef.current) return;
    catalogLoadingMoreRef.current = true;
    setCatalogLoadingMore(true);
    const gen = catalogLoadGen.current;
    const from = catalog.length;
    try {
      const result = await rpc<{ packages: MarketRow[]; total: number }>("searchPackages", {
        query: catalogQuery.trim() || undefined,
        limit: CATALOG_PAGE,
        from,
      });
      if (gen !== catalogLoadGen.current) return;
      if (!result?.packages?.length) {
        setCatalogTotal(from);
        return;
      }
      setCatalog((prev) => {
        const seen = new Set(prev.map((r) => r.name));
        const next = [...prev];
        for (const row of result.packages) {
          if (seen.has(row.name)) continue;
          seen.add(row.name);
          next.push(row);
        }
        return next;
      });
      setCatalogTotal(result.total);
    } catch (err) {
      if (gen !== catalogLoadGen.current) return;
      setCatalogError(err instanceof Error ? err.message : String(err));
    } finally {
      if (gen === catalogLoadGen.current) {
        catalogLoadingMoreRef.current = false;
        setCatalogLoadingMore(false);
      }
    }
  }

  /** 从市场安装（结果经 package.install 事件回传） */
  function installMarket(name: string) {
    setMarketBusy(name);
    void rpc("installNpmPackage", { spec: name });
  }

  /** 卸载插件并刷新（市场目录 + 已安装清单 + 扩展加载） */
  async function removeMarket(name: string) {
    setMarketBusy(name);
    try {
      const result = await rpc<{ ok?: boolean; error?: string }>("removeNpmPackage", { name });
      if (result?.ok) {
        toast(`已卸载 ${name}`, "info");
        setCatalog((prev) => prev.map((row) => row.name === name ? { ...row, installed: false } : row));
        await Promise.all([loadInstalledPackages(), props.onSettingsChanged(), refreshInventories()]);
      } else {
        toast(result?.error ?? "卸载失败", "error");
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setMarketBusy(undefined);
    }
  }

  /** 插入提示词到对话输入框（App 壳监听 aluka:prompt-insert 并切回对话视图） */
  function insertPrompt(prompt: PromptItem) {
    window.dispatchEvent(
      new CustomEvent("aluka:prompt-insert", { detail: { text: prompt.body || prompt.description } }),
    );
  }

  /** 挂载即加载清单（Toast 由 App 壳统一播报安装结果） */
  useEffect(() => {
    void refreshInventories();
    void loadInstalledPackages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 安装结果回传：同步市场目录与清单（Toast 由 App 壳统一播报） */
  useEffect(() => {
    const onPackageInstall = (raw: unknown) => {
      const result = raw as { ok?: boolean; packageName?: string };
      setMarketBusy(undefined);
      if (result?.ok) {
        setCatalog((prev) => prev.map((row) => row.name === result.packageName ? { ...row, installed: true } : row));
        void props.onSettingsChanged();
        void refreshInventories();
        void loadInstalledPackages();
      }
    };
    const bus = bridge().events;
    bus.on("package.install", onPackageInstall);
    return () => bus.off("package.install", onPackageInstall);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 全局 header「重载扩展」后同步刷新本页清单 */
  useEffect(() => {
    const onReloaded = () => {
      void refreshInventories();
      void loadInstalledPackages();
    };
    window.addEventListener("aluka:extensions-reloaded", onReloaded);
    return () => window.removeEventListener("aluka:extensions-reloaded", onReloaded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 进入「工具 → 发现」时加载市场首页 */
  useEffect(() => {
    if (tab === "tools" && toolsSubTab === "discover") void loadCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, toolsSubTab]);

  /** 搜索词变更 → 320ms 防抖后自动重新查询 */
  useEffect(() => {
    if (tab !== "tools" || toolsSubTab !== "discover") return;
    const handle = window.setTimeout(() => void loadCatalog(catalogQuery), 320);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogQuery]);

  /** 触底无限滚动：哨兵进入 settings-page 可视区即加载下一页 */
  useEffect(() => {
    if (tab !== "tools" || toolsSubTab !== "discover") return;
    if (catalog.length >= catalogTotal || catalogLoading) return;
    const sentinel = catalogEndRef.current;
    if (!sentinel) return;
    const root = sentinel.closest(".settings-page");
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMoreCatalog();
      },
      { root: root instanceof Element ? root : null, rootMargin: "160px", threshold: 0 },
    );
    io.observe(sentinel);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, toolsSubTab, catalog.length, catalogTotal, catalogLoading, catalogLoadingMore, catalogQuery]);

  /** 已安装列表本地过滤（按名称/描述，大小写不敏感） */
  const installedFiltered = useMemo(() => {
    const needle = installedFilter.trim().toLowerCase();
    if (!needle) return installedPkgs;
    return installedPkgs.filter((p) =>
      p.name.toLowerCase().includes(needle) ||
      (p.description ?? "").toLowerCase().includes(needle),
    );
  }, [installedPkgs, installedFilter]);

  /** 提示词本地过滤（按名称/描述/路径） */
  const promptsFiltered = useMemo(() => {
    const needle = promptsFilter.trim().toLowerCase();
    const list = prompts ?? [];
    if (!needle) return list;
    return list.filter((p) =>
      p.name.toLowerCase().includes(needle) ||
      p.description.toLowerCase().includes(needle) ||
      p.path.toLowerCase().includes(needle),
    );
  }, [prompts, promptsFilter]);

  /** 技能本地过滤（按名称/描述/路径） */
  const skillsFiltered = useMemo(() => {
    const needle = skillsFilter.trim().toLowerCase();
    const list = skills ?? [];
    if (!needle) return list;
    return list.filter((s) =>
      s.name.toLowerCase().includes(needle) ||
      s.description.toLowerCase().includes(needle) ||
      s.path.toLowerCase().includes(needle),
    );
  }, [skills, skillsFilter]);

  function formatMonthlyDownloads(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}K/月` : `${n}/月`;
  }

  return (
    <div className="settings-page settings-page--full" data-aluka-drag="no-drag">
      <div className="settings-page-inner">
        <SectionHead
          title="扩展"
          hint="工具：插件市场与已加载扩展；提示词：.aluka/prompts 下的 Markdown 片段，可插入输入框复用；技能：自动注入系统提示的技能文件。安装插件后可点击顶栏 ↻ 重载生效。"
        />
        <div className="ext-head-actions">
          {extLoading ? (
            <span className="hint ext-head-loading">
              <Spinner size={12} label="加载清单中" /> 加载清单中…
            </span>
          ) : (
            <span className="hint">{extSummary || "暂无数据"}</span>
          )}
          <Button variant="secondary" disabled={extLoading} onClick={() => {
            void refreshInventories();
            void loadInstalledPackages();
            if (tab === "tools" && toolsSubTab === "discover") void loadCatalog();
          }}>{extLoading ? "刷新中…" : "刷新"}</Button>
        </div>

        <div className="page-tabs">
          <button
            type="button"
            className="page-tab"
            data-active={tab === "tools"}
            onClick={() => setTab("tools")}
          >
            工具
          </button>
          <button
            type="button"
            className="page-tab"
            data-active={tab === "prompts"}
            onClick={() => setTab("prompts")}
          >
            提示词
          </button>
          <button
            type="button"
            className="page-tab"
            data-active={tab === "skills"}
            onClick={() => setTab("skills")}
          >
            技能
          </button>
        </div>

        {tab === "tools" ? (
          <div className="ext-tab-body">
            <div className="page-tabs page-tabs--sub">
              <button
                type="button"
                className="page-tab"
                data-active={toolsSubTab === "installed"}
                onClick={() => setToolsSubTab("installed")}
              >
                已安装
              </button>
              <button
                type="button"
                className="page-tab"
                data-active={toolsSubTab === "discover"}
                onClick={() => setToolsSubTab("discover")}
              >
                发现
              </button>
            </div>

            {toolsSubTab === "discover" ? (
              <>
                <div className="discover-toolbar">
                  <input
                    className="ui-input discover-search"
                    value={catalogQuery}
                    placeholder="搜索插件：mcp、web-access、subagents…（留空列出热门）"
                    onChange={(e) => setCatalogQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void loadCatalog();
                    }}
                  />
                  <a
                    className="discover-web-link"
                    href="https://pi.dev/packages"
                    target="_blank"
                    rel="noreferrer"
                  >
                    打开网页市场
                  </a>
                </div>
                {catalogError ? <p className="discover-error">{catalogError}</p> : null}
                {catalogLoading && catalog.length === 0 ? (
                  <LoadingBlock text="正在查询插件市场…" />
                ) : catalog.length === 0 ? (
                  <div className="pkg-empty">
                    <p>没有匹配的包。换个关键词试试，或打开网页市场浏览全部。</p>
                  </div>
                ) : (
                  <>
                    <ul className="pkg-list">
                      {catalog.map((row) => {
                        const chips = (row.keywords ?? [])
                          .filter((k) => k !== "pi-package" && k !== "mcp-server")
                          .slice(0, 3);
                        return (
                          <li key={row.name} className="pkg-card">
                            <div className="market-info">
                              <div className="market-name">
                                <a href={row.npmUrl ?? `https://www.npmjs.com/package/${row.name}`} target="_blank" rel="noreferrer">
                                  {row.name}
                                </a>
                                {row.version ? <span className="hint">v{row.version}</span> : null}
                                {row.installed ? <span className="auth-badge ok">已安装</span> : null}
                              </div>
                              {row.description ? <div className="hint market-desc">{row.description}</div> : null}
                              <div className="hint market-meta">
                                {[
                                  row.author,
                                  row.monthlyDownloads ? formatMonthlyDownloads(row.monthlyDownloads) : undefined,
                                ].filter(Boolean).join(" · ") || "—"}
                              </div>
                              {chips.length ? (
                                <div className="pkg-chips">
                                  {chips.map((k) => <span key={k} className="pkg-chip">{k}</span>)}
                                </div>
                              ) : null}
                            </div>
                            <Button
                              variant={row.installed ? "ghost" : "secondary"}
                              size="sm"
                              disabled={marketBusy === row.name}
                              onClick={() => (row.installed ? void removeMarket(row.name) : installMarket(row.name))}
                            >
                              {marketBusy === row.name ? <><Spinner size={11} label="处理中" /> 处理中…</> : row.installed ? "移除" : "安装"}
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                    <div ref={catalogEndRef} className="pkg-sentinel hint">
                      {catalogLoadingMore ? (
                        <span className="pkg-sentinel-loading">
                          <Spinner size={12} label="加载更多" /> 加载更多…
                        </span>
                      ) : catalog.length < catalogTotal
                        ? `已展示 ${catalog.length} / ${catalogTotal}`
                        : `已加载全部 ${catalog.length} 条结果`}
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                <div className="discover-toolbar">
                  <input
                    className="ui-input discover-search"
                    value={installedFilter}
                    placeholder="过滤已安装插件（按名称 / 描述）…"
                    onChange={(e) => setInstalledFilter(e.target.value)}
                  />
                  <span className="hint discover-count">
                    {installedPkgs.length ? `共 ${installedPkgs.length} 个插件` : ""}
                  </span>
                </div>
                {installedFiltered.length ? (
                  <ul className="pkg-list">
                    {installedFiltered.map((pkg) => (
                      <li key={pkg.name} className="pkg-card">
                        <div className="market-info">
                          <div className="market-name">
                            <a href={`https://www.npmjs.com/package/${pkg.name}`} target="_blank" rel="noreferrer">
                              {pkg.name}
                            </a>
                            {pkg.version ? <span className="hint">v{pkg.version}</span> : null}
                            <span className="pkg-chip">npm</span>
                          </div>
                          {pkg.description ? <div className="hint market-desc">{pkg.description}</div> : null}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={marketBusy === pkg.name}
                          onClick={() => void removeMarket(pkg.name)}
                        >
                          {marketBusy === pkg.name ? <><Spinner size={11} label="移除中" /> 移除中…</> : "移除"}
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="pkg-empty">
                    <p>
                      {installedPkgs.length
                        ? "没有匹配过滤条件的插件。"
                        : "暂无已安装插件。~/.aluka/agent/npm-packages 为空，可切到「发现」从市场安装。"}
                    </p>
                  </div>
                )}

                <h3 className="sidebar-section-label">已加载扩展（当前目录）</h3>
                <ul className="inv-list">
                  {extList.length ? extList.map((ext) => (
                    <li key={ext.path}>
                      <strong>{ext.path}</strong>
                      <div className="hint">工具：{ext.tools.join(", ") || "—"}</div>
                      <div className="hint">命令：{ext.commands.join(", ") || "—"}</div>
                    </li>
                  )) : <li className="hint">未加载扩展</li>}
                </ul>
                <h3 className="sidebar-section-label">加载错误</h3>
                <ul className="inv-list">
                  {extErrors.length ? extErrors.map((err) => (
                    <li key={err.path}><strong>{err.path}</strong><div style={{ color: "var(--danger)" }}>{err.error}</div></li>
                  )) : <li className="hint">无</li>}
                </ul>
              </>
            )}
          </div>
        ) : tab === "prompts" ? (
          <div className="ext-tab-body">
            <div className="discover-toolbar">
              <input
                className="ui-input discover-search"
                value={promptsFilter}
                placeholder="过滤提示词（按名称 / 描述 / 路径）…"
                onChange={(e) => setPromptsFilter(e.target.value)}
              />
              <span className="hint discover-count">
                {prompts === undefined ? <><Spinner size={11} label="加载中" /> 加载中…</> : prompts.length ? `共 ${prompts.length} 个提示词` : ""}
              </span>
            </div>
            {promptsFiltered.length ? (
              <ul className="pkg-list">
                {promptsFiltered.map((p) => (
                  <li key={p.path} className="pkg-card">
                    <div className="market-info">
                      <div className="market-name" title={p.path}>{p.name}</div>
                      {p.description ? <div className="hint market-desc">{p.description}</div> : null}
                      <div className="hint market-meta skill-path" title={p.path}>{p.path}</div>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => insertPrompt(p)}>
                      插入输入框
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="pkg-empty">
                <p>
                  {prompts?.length
                    ? "没有匹配过滤条件的提示词。"
                    : "还没有提示词。在当前目录 .aluka/prompts 或 ~/.aluka/agent/prompts 下创建带 frontmatter（name / description）的 Markdown 文件即可。"}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="ext-tab-body">
            <div className="discover-toolbar">
              <input
                className="ui-input discover-search"
                value={skillsFilter}
                placeholder="过滤技能（按名称 / 描述 / 路径）…"
                onChange={(e) => setSkillsFilter(e.target.value)}
              />
              <span className="hint discover-count">
                {skills === undefined ? <><Spinner size={11} label="加载中" /> 加载中…</> : skills.length ? `共 ${skills.length} 个技能` : ""}
              </span>
            </div>
            {skillsFiltered.length ? (
              <ul className="pkg-list">
                {skillsFiltered.map((s) => (
                  <li key={s.path} className="pkg-card">
                    <div className="market-info">
                      <div className="market-name">{s.name}</div>
                      {s.description ? <div className="hint market-desc">{s.description}</div> : null}
                      <div className="hint market-meta skill-path" title={s.path}>{s.path}</div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="pkg-empty">
                <p>
                  {skills?.length
                    ? "没有匹配过滤条件的技能。"
                    : "当前工作区还没有技能。在当前目录 .aluka/skills 或 ~/.aluka/agent/skills 下创建带 frontmatter（name / description）的 Markdown 文件即可。"}
                </p>
              </div>
            )}
          </div>
        )}

        <div className="settings-inline-actions">
          <Button variant="secondary" onClick={props.onBack}>返回</Button>
        </div>
      </div>
    </div>
  );
}
