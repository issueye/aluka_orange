/**
 * 插件设置段（settings.section 槽位贡献 → 宿主自动渲染表单）
 *
 * 数据流：uiContributions 中 slot==="settings.section" 的贡献声明 ConfigSchema
 * → 本组件按条目类型渲染（boolean→Switch / select→Select / number→Input / string→Input）
 * → 变更经 patchPluginSetting RPC 写回 ~/.aluka/agent/settings.json pluginSettings。
 */
import { rpc } from "../bridge.ts";
import { Input, Select, Switch } from "../components/index.ts";
import { shellStore, useShell } from "../shell/store.ts";
import type { ConfigSchemaEntry, UiContributionV2 } from "@aluka/shell-contracts";
import type { SettingsView } from "../types.ts";

async function patchPluginSetting(key: string, value: unknown): Promise<void> {
  try {
    const result = await rpc<SettingsView>("patchPluginSetting", { key, value });
    if (result) shellStore.set({ settings: result });
  } catch (err) {
    console.warn("[plugin-settings] patch failed", key, err);
  }
}

function FieldRow(props: {
  keyName: string;
  entry: ConfigSchemaEntry;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { entry, value, onChange } = props;
  return (
    <div className="settings-row" data-testid={`plugin-setting-${props.keyName}`}>
      <div className="settings-row-copy">
        <div className="settings-row-title">{entry.label}</div>
        {entry.description ? (
          <div className="settings-row-desc">{entry.description}</div>
        ) : null}
      </div>
      <div className="settings-row-control">
        {entry.type === "boolean" ? (
          <Switch checked={Boolean(value)} onChange={onChange} />
        ) : entry.type === "select" ? (
          <Select
            className="ui-select--compact"
            placeholder="请选择"
            options={(entry.options ?? []).map((option) => ({ value: option, label: option }))}
            value={String(value ?? "")}
            onChange={onChange}
          />
        ) : (
          <Input
            className="ui-input--compact"
            type={entry.type === "number" ? "number" : "text"}
            value={value === undefined || value === null ? "" : String(value)}
            onChange={(text) => onChange(entry.type === "number" ? Number(text) : text)}
          />
        )}
      </div>
    </div>
  );
}

/** 稳定空对象：选择器不得每次创建新引用（useSyncExternalStore 会无限重渲染） */
const EMPTY_PLUGIN_SETTINGS: Record<string, unknown> = {};

export function PluginSettingsSection() {
  const contributions = useShell((s) => s.uiContributions).filter(
    (c): c is UiContributionV2 =>
      c.version === 2 && c.slot === "settings.section" && Boolean(c.settings),
  );
  const pluginSettings = useShell(
    (s) => s.settings.pluginSettings ?? EMPTY_PLUGIN_SETTINGS,
  );
  if (!contributions.length) {
    return (
      <div className="settings-page-shell">
        <div className="settings-page-title-row">
          <h1 className="settings-page-title">插件设置</h1>
        </div>
        <div className="settings-page-sections">
          <section className="settings-section-block">
            <h2 className="settings-section-label">插件设置</h2>
            <div className="hint">暂无插件设置项</div>
          </section>
        </div>
      </div>
    );
  }
  return (
    <div className="settings-page-shell">
      <div className="settings-page-title-row">
        <h1 className="settings-page-title">插件设置</h1>
      </div>
      <div className="settings-page-sections">
        <section className="settings-section-block">
          <h2 className="settings-section-label">插件设置项</h2>
          <div className="hint">
            由 settings.section 槽位贡献自动渲染；写入 settings.json 后插件经
            <code>pi.getPluginSetting</code> 读取。
          </div>
          <div className="settings-card">
            {contributions.flatMap((contribution) =>
              Object.entries(contribution.settings ?? {}).map(([key, entry]) => (
                <FieldRow
                  key={key}
                  keyName={key}
                  entry={entry}
                  value={(pluginSettings as Record<string, unknown>)[key] ?? entry.default}
                  onChange={(value) => void patchPluginSetting(key, value)}
                />
              )),
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
