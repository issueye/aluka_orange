/**
 * 扩展视图（「扩展」页面，设置式左右分栏布局）
 *
 * 与设置页同构：左侧 rail（返回 + 搜索胶囊 + 分组菜单），右侧内容列
 * （大标题行 + 清单摘要/刷新 + 页签内容）。顶层页签挂在左侧菜单：
 * - 工具：已加载扩展（当前目录）与加载错误
 * - 提示词：.aluka/prompts 下的 Markdown 提示词片段，可一键插入对话输入框
 * - 技能：自动注入系统提示的技能文件清单
 *
 * 全局 header 的「重载扩展」会触发 aluka:extensions-reloaded 事件，
 * 本视图监听后刷新全部清单。
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookOpen, MessageSquareText, Search, Wrench } from "lucide-react";
import { rpc, bridge } from "../bridge.ts";
import { Button, Spinner } from "../components/index.ts";
import { ExtensionContributionsPanel } from "./ExtensionContributionsPanel.tsx";
import type { PromptItem, SkillItem } from "../types.ts";

/** 已加载扩展清单条目 */
type ExtEntry = { path: string; tools: string[]; commands: string[] };

/** 顶层页签 */
type ExtTab = "tools" | "prompts" | "skills";

export function ExtensionsView(props: { onBack: () => void }) {
  // ── 页签状态 ──
  const [tab, setTab] = useState<ExtTab>("tools");

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

  /** 插入提示词到对话输入框（App 壳监听 aluka:prompt-insert 并切回对话视图） */
  function insertPrompt(prompt: PromptItem) {
    window.dispatchEvent(
      new CustomEvent("aluka:prompt-insert", { detail: { text: prompt.body || prompt.description } }),
    );
  }

  /** 挂载即加载清单 */
  useEffect(() => {
    void refreshInventories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 全局 header「重载扩展」后同步刷新本页清单 */
  useEffect(() => {
    const onReloaded = () => {
      void refreshInventories();
    };
    window.addEventListener("aluka:extensions-reloaded", onReloaded);
    return () => window.removeEventListener("aluka:extensions-reloaded", onReloaded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  /** 左侧搜索胶囊：按当前页签绑定过滤词（工具页为清单页，无过滤目标） */
  const navSearchValue = tab === "prompts" ? promptsFilter : skillsFilter;

  const navSearchPlaceholder = tab === "prompts" ? "过滤提示词…" : "过滤技能…";

  function setNavSearch(value: string) {
    if (tab === "prompts") setPromptsFilter(value);
    else setSkillsFilter(value);
  }

  return (
    <div className="settings-split" data-aluka-drag="no-drag">
      <nav className="settings-nav">
        <button type="button" className="settings-rail-back" onClick={props.onBack}>
          <ArrowLeft size={14} strokeWidth={1.75} />
          <span className="truncate">返回对话</span>
        </button>
        {tab !== "tools" ? (
          <div className="settings-nav-search">
            <Search size={14} strokeWidth={1.75} className="settings-search-icon" />
            <input
              type="search"
              className="settings-search-input"
              value={navSearchValue}
              placeholder={navSearchPlaceholder}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setNavSearch(e.target.value)}
            />
          </div>
        ) : null}
        <div className="settings-nav-scroll">
          <div className="settings-nav-group">
            <p className="settings-rail-group-label">扩展</p>
            <div className="settings-rail-items">
              <button
                type="button"
                className="settings-rail-item"
                data-active={tab === "tools"}
                onClick={() => setTab("tools")}
              >
                <Wrench size={14} strokeWidth={1.75} className="settings-rail-item-icon" />
                <span className="truncate">工具</span>
              </button>
              <button
                type="button"
                className="settings-rail-item"
                data-active={tab === "prompts"}
                onClick={() => setTab("prompts")}
              >
                <MessageSquareText size={14} strokeWidth={1.75} className="settings-rail-item-icon" />
                <span className="truncate">提示词</span>
              </button>
              <button
                type="button"
                className="settings-rail-item"
                data-active={tab === "skills"}
                onClick={() => setTab("skills")}
              >
                <BookOpen size={14} strokeWidth={1.75} className="settings-rail-item-icon" />
                <span className="truncate">技能</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="settings-content">
        <div className="settings-page-shell">
          <div className="settings-page-title-row">
            <h1 className="settings-page-title">扩展</h1>
            <div className="settings-page-title-action ext-title-actions">
              {extLoading ? (
                <span className="hint ext-head-loading">
                  <Spinner size={12} label="加载清单中" /> 加载清单中…
                </span>
              ) : (
                <span className="hint">{extSummary || "暂无数据"}</span>
              )}
              <Button variant="secondary" disabled={extLoading} onClick={() => void refreshInventories()}>
                {extLoading ? "刷新中…" : "刷新"}
              </Button>
            </div>
          </div>
          <p className="hint ext-page-subtitle">
            工具：已加载扩展与加载错误；提示词：.aluka/prompts 下的 Markdown 片段，可插入输入框复用；技能：自动注入系统提示的技能文件。安装本地扩展后可点击顶栏 ↻ 重载生效。
          </p>

          {tab === "tools" ? (
            <div className="ext-tab-body">
              <ExtensionContributionsPanel />
              <section className="settings-section-block">
                <h2 className="settings-section-label">已加载扩展（当前目录）</h2>
                <ul className="inv-list">
                  {extList.length ? extList.map((ext) => (
                    <li key={ext.path}>
                      <strong>{ext.path}</strong>
                      <div className="hint">工具：{ext.tools.join(", ") || "—"}</div>
                      <div className="hint">命令：{ext.commands.join(", ") || "—"}</div>
                    </li>
                  )) : <li className="hint">未加载扩展</li>}
                </ul>
              </section>
              <section className="settings-section-block">
                <h2 className="settings-section-label">加载错误</h2>
                <ul className="inv-list">
                  {extErrors.length ? extErrors.map((err) => (
                    <li key={err.path}><strong>{err.path}</strong><div style={{ color: "var(--danger)" }}>{err.error}</div></li>
                  )) : <li className="hint">无</li>}
                </ul>
              </section>
            </div>
          ) : tab === "prompts" ? (
            <div className="ext-tab-body">
              <div className="discover-toolbar">
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
        </div>
      </div>
    </div>
  );
}
