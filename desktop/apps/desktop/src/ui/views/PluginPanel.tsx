/**
 * 插件声明式面板（M4，见 docs/http-and-plugin-roadmap.md）
 *
 * 渲染扩展 contributes() 声明的贡献：标题 / 描述 / 动作。
 * v1 只含声明式内容（无插件代码）：
 * - command → 「运行命令」把 /command 预填到对话输入框并切回对话（复用 aluka:prompt-insert）
 * - url     → 「打开链接」外部浏览器
 */
import { Button } from "../components/index.ts";
import type { UiContribution } from "../types.ts";

export function PluginPanel(props: { contribution: UiContribution }) {
  const { contribution } = props;

  function runCommand() {
    if (!contribution.command) return;
    window.dispatchEvent(
      new CustomEvent("aluka:prompt-insert", { detail: { text: `/${contribution.command} ` } }),
    );
  }

  return (
    <div className="settings-split" data-aluka-drag="no-drag">
      <div className="settings-content">
        <div className="settings-page-shell">
          <div className="settings-page-title-row">
            <h1 className="settings-page-title">{contribution.title}</h1>
            <div className="settings-page-title-action ext-title-actions">
              {contribution.url ? (
                <a className="discover-web-link" href={contribution.url} target="_blank" rel="noreferrer">
                  打开链接
                </a>
              ) : null}
              {contribution.command ? (
                <Button variant="secondary" onClick={runCommand}>
                  运行命令 /{contribution.command}
                </Button>
              ) : null}
            </div>
          </div>
          <div className="settings-page-sections">
            <section className="settings-section-block">
              <h2 className="settings-section-label">插件面板（声明式）</h2>
              <div className="settings-card">
                <div className="settings-row settings-row-col settings-row-last">
                  <div className="settings-row-copy">
                    <div className="settings-row-title">{contribution.title}</div>
                    <div className="settings-row-desc">
                      {contribution.description || "该插件未提供描述。"}
                    </div>
                    <p className="settings-meta">
                      贡献 id：{contribution.id} · schema v{contribution.version}
                      {contribution.command ? ` · 命令 /${contribution.command}` : ""}
                    </p>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
