/**
 * 贡献点管理面板（扩展页 → UI 贡献）
 *
 * 展示全部 UI 贡献（v1/v2）：id / title / slot / version / when 求值结果；
 * 开关 = 用户级禁用（localStorage，SlotOutlet 与侧栏菜单同步过滤）。
 * 来源：pi.contributes / aluka-ui.json（manifest 轨）。
 */
import { Switch } from "../components/index.ts";
import { toggleContribution } from "../shell/actions.ts";
import { evalWhen } from "../shell/context-keys.ts";
import { useShell } from "../shell/store.ts";
import type { UiContributionV2 } from "@aluka/shell-contracts";

function SlotLabel(contribution: UiContributionV2): string {
  return contribution.slot ?? "view.registry";
}

export function ExtensionContributionsPanel() {
  const contributions = useShell((s) => s.uiContributions);
  const disabled = useShell((s) => s.disabledContributions);
  if (!contributions.length) return null;
  return (
    <section className="settings-section-block">
      <h2 className="settings-section-label">UI 贡献点（槽位注册）</h2>
      <div className="settings-card">
        {contributions.map((contribution) => {
          const id = contribution.id;
          const v2 = contribution.version === 2 ? (contribution as UiContributionV2) : undefined;
          const whenResult = v2 ? evalWhen(v2.when) : true;
          const isDisabled = disabled.includes(id);
          return (
            <div key={id} className="settings-row" data-testid={`contribution-${id}`}>
              <div className="settings-row-copy">
                <div className="settings-row-title">
                  {contribution.title}
                  <span className="settings-meta"> · {id}</span>
                </div>
                <div className="settings-row-desc">
                  slot：{v2 ? SlotLabel(v2) : "view.registry"} · schema v{contribution.version}
                  {v2?.when ? ` · when「${v2.when}」=${whenResult ? "满足" : "不满足"}` : ""}
                  {v2?.uiModule ? " · 组件档" : ""}
                </div>
              </div>
              <div className="settings-row-control">
                <Switch checked={!isDisabled} onChange={() => toggleContribution(id)} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
