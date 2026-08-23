/**
 * 环境变量管理区块（设置页）
 *
 * 持久化到 ~/.aluka/agent/settings.json 的 envVars 段，并注入 agent 进程 process.env。
 * 列表可编辑/删除，新增行添加。
 */
import { useEffect, useState } from "react";
import { rpc } from "../bridge.ts";
import { Button, Input } from "../components/index.ts";

interface EnvRow {
  key: string;
  value: string;
  dirty?: boolean;
  removed?: boolean;
}

export function EnvVarsSection() {
  const [vars, setVars] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<EnvRow[]>([]);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const result = await rpc<Record<string, string>>("listEnvVars");
      setVars(result ?? {});
      setRows(Object.entries(result ?? {}).map(([key, value]) => ({ key, value })));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const updateRow = (index: number, patch: Partial<EnvRow>) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch, dirty: true } : row)));
  };

  const saveRow = async (index: number) => {
    const row = rows[index];
    if (!row || !row.key.trim()) return;
    try {
      const result = await rpc<{ ok: boolean }>("setEnvVar", {
        key: row.key.trim(),
        value: row.value ?? "",
      });
      if (result?.ok) {
        await refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const removeRow = async (index: number) => {
    const row = rows[index];
    if (!row) return;
    try {
      const result = await rpc<{ ok: boolean }>("removeEnvVar", { key: row.key });
      if (result?.ok) await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const addNew = async () => {
    const key = newKey.trim();
    if (!key) return;
    try {
      const result = await rpc<{ ok: boolean }>("setEnvVar", { key, value: newValue });
      if (result?.ok) {
        setNewKey("");
        setNewValue("");
        await refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading) {
    return (
      <div className="settings-page-shell">
        <div className="settings-page-title-row">
          <h1 className="settings-page-title">环境变量</h1>
        </div>
        <div className="settings-page-sections">
          <section className="settings-section-block">
            <h2 className="settings-section-label">环境变量</h2>
            <div className="hint">加载中…</div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page-shell">
      <div className="settings-page-title-row">
        <h1 className="settings-page-title">环境变量</h1>
        <div className="settings-page-title-action">
          <Button variant="secondary" onClick={() => void refresh()}>刷新</Button>
        </div>
      </div>
      <div className="settings-page-sections">
        <section className="settings-section-block">
          <h2 className="settings-section-label">变量列表</h2>
          <div className="hint">
            持久化到 settings.json，注入 Agent 进程。重启后仍生效（含插件/工具/供应商读取）。
          </div>
          <div className="settings-card">
            {rows.length === 0 ? (
              <div className="hint">暂无自定义环境变量</div>
            ) : null}
            {rows.map((row, index) => (
              <div key={row.key} className="settings-row">
                <div className="settings-row-copy">
                  <div className="settings-row-title">{row.key}</div>
                </div>
                <div className="settings-row-control env-row-control">
                  <Input
                    className="ui-input--compact env-value-input"
                    placeholder="值"
                    value={row.value}
                    onChange={(text) => updateRow(index, { value: text })}
                  />
                  {row.dirty ? (
                    <Button
                      variant="secondary"
                      className="env-row-save"
                      onClick={() => void saveRow(index)}
                    >
                      保存
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    className="env-row-delete"
                    onClick={() => void removeRow(index)}
                  >
                    删除
                  </Button>
                </div>
              </div>
            ))}
            <div className="settings-row settings-row-last">
              <div className="settings-row-copy">
                <div className="settings-row-title">新增</div>
              </div>
              <div className="settings-row-control env-row-control">
                <Input
                  className="ui-input--compact env-key-input"
                  placeholder="变量名"
                  value={newKey}
                  onChange={setNewKey}
                />
                <Input
                  className="ui-input--compact env-value-input"
                  placeholder="值"
                  value={newValue}
                  onChange={setNewValue}
                />
                <Button variant="secondary" onClick={() => void addNew()}>
                  添加
                </Button>
              </div>
            </div>
            {error ? <div className="hint env-error">{error}</div> : null}
          </div>
        </section>
      </div>
    </div>
  );
}