/**
 * 壳层铬片：Sidebar / Header / Main / Toast / Splash / DialogHost
 *
 * 各组件直接经 shell/session store 选择器取数据（不再经 App props 透传）；
 * 内置区域以 builtin:* 内容注册进 SlotOutlet（header.actions / sidebar.top / sidebar.foot），
 * 插件 v2 贡献由 SlotOutlet 按 when + order 追加渲染。
 */
import { useMemo } from "react";
import { CheckCircle2, Minus, PanelLeft, RefreshCw, Square, X } from "lucide-react";
import { bridge, rpc } from "../bridge.ts";
import { Logo } from "../Logo.tsx";
import { WorkspaceSidebar } from "../WorkspaceSidebar.tsx";
import { ChatView } from "../views/ChatView.tsx";
import { SettingsView } from "../views/SettingsView.tsx";
import { ExtensionsView } from "../views/ExtensionsView.tsx";
import { PluginPanel } from "../views/PluginPanel.tsx";
import { menuViews, viewLabel } from "./registry.ts";
import { Button, ConfirmDialog, Dialog, Input, Spinner } from "../components/index.ts";
import { ExtensionUiModal } from "../components/ExtensionUiModal.tsx";
import { pathsEqual } from "../lib/utils.ts";
import {
  addWorkspaceByPath,
  chooseWorkspace,
  confirmDeleteSession,
  createNewChat,
  createNewChatIn,
  createTempWorkspace,
  loadSettings,
  onSend,
  openPathDialog,
  openSession,
  openView,
  refreshSessions,
  refreshUsage,
  reloadExtensions,
  removeWorkspace,
  requestDeleteSession,
  respondUi,
  revealFolder,
  selectWorkspace,
  setAttachmentsView,
  setPromptView,
  setSettingsView,
  showChat,
  toggleSidebar,
} from "./actions.ts";
import { sessionStore, shellStore, toast, useSession, useShell } from "./store.ts";
import { SlotOutlet } from "./slots.tsx";

export function ShellSidebar() {
  const view = useShell((s) => s.view);
  const status = useShell((s) => s.status);
  const sidebarCollapsed = useShell((s) => s.sidebarCollapsed);
  const settings = useShell((s) => s.settings);
  const workspaces = useSession((s) => s.workspaces);
  const activeId = useSession((s) => s.activeId);
  const busyIds = useSession((s) => s.busyIds);

  return (
    <aside
      className={`sidebar ${sidebarCollapsed ? "is-collapsed" : ""}`}
      data-aluka-drag="no-drag"
      style={{ width: sidebarCollapsed ? "var(--sidebar-collapsed-width)" : "var(--sidebar-width)" }}
    >
      {sidebarCollapsed ? (
        <div className="sidebar-rail" data-aluka-drag>
          <Logo size={22} />
        </div>
      ) : (
        <>
          <SlotOutlet slot="sidebar.top" />
          <WorkspaceSidebar
            workspaces={workspaces}
            activeCwd={settings.cwd}
            activeSessionId={activeId}
            busySessionIds={busyIds}
            onNewChat={() => void createNewChat()}
            onNewChatIn={(cwd) => void createNewChatIn(cwd)}
            onOpenSession={(id, cwd) => void openSession(id, cwd)}
            onSelectWorkspace={(cwd) => void selectWorkspace(cwd, "latest")}
            onAddWorkspace={() => void chooseWorkspace("latest")}
            onCreateTemp={() => void createTempWorkspace()}
            onDeleteSession={(id, cwd) => void requestDeleteSession(id, cwd)}
            onRemoveWorkspace={(cwd) => void removeWorkspace(cwd)}
            onRevealFolder={(cwd) => void revealFolder(cwd)}
            onCollapseSidebar={() => toggleSidebar(true)}
          />
        </>
      )}
      <SlotOutlet
        slot="sidebar.foot"
        builtin={
          <div className="sidebar-foot-inner">
            {menuViews().map((def) => {
              const Icon = def.icon;
              return (
                <button
                  key={def.id}
                  type="button"
                  className={`nav ghost-btn ${view === def.id ? "active" : ""}`}
                  onClick={() => openView(def.id)}
                >
                  <Icon size={16} /> <span>{def.label}</span>
                </button>
              );
            })}
            <SlotOutlet
              slot="statusbar"
              builtin={<div className="status-pill" title={status}>{status}</div>}
            />
          </div>
        }
        className="sidebar-foot"
      />
    </aside>
  );
}

export function ShellHeader() {
  const view = useShell((s) => s.view);
  const sidebarCollapsed = useShell((s) => s.sidebarCollapsed);
  const extReloading = useShell((s) => s.extReloading);
  const settings = useShell((s) => s.settings);
  const workspaces = useSession((s) => s.workspaces);
  const sessions = useSession((s) => s.sessions);
  const activeId = useSession((s) => s.activeId);

  const activeTitle = useMemo(() => {
    for (const ws of workspaces) {
      if (settings.cwd && !pathsEqual(ws.path, settings.cwd)) continue;
      const s = ws.sessions.find((x) => x.id === activeId);
      if (s) return s.title || s.id;
    }
    const s = sessions.find((x) => x.id === activeId);
    return s?.title || s?.id || "新对话";
  }, [workspaces, sessions, activeId, settings.cwd]);

  return (
    <header className="thread-header" data-aluka-drag>
      {sidebarCollapsed && view === "chat" ? (
        <button
          type="button"
          className="icon-btn"
          data-aluka-drag="no-drag"
          title="展开侧栏"
          onClick={() => toggleSidebar(false)}
        >
          <PanelLeft size={16} />
        </button>
      ) : null}
      <div className="title" title={view === "chat" ? activeTitle : undefined}>
        {view === "chat" ? activeTitle : viewLabel(view)}
      </div>
      <SlotOutlet
        slot="header.actions"
        builtin={
          <button
            type="button"
            className="header-action"
            title="重载扩展（添加插件后手动点击生效）"
            disabled={extReloading}
            onClick={() => void reloadExtensions()}
          >
            <RefreshCw size={15} className={extReloading ? "is-spinning" : undefined} />
          </button>
        }
        className="thread-actions"
      />
      <div className="window-controls" data-aluka-drag="no-drag">
        <button type="button" title="最小化" onClick={() => bridge().window.minimize()}>
          <Minus size={14} />
        </button>
        <button type="button" title="最大化" onClick={() => bridge().window.toggleMaximize()}>
          <Square size={11} />
        </button>
        <button
          type="button"
          className="close"
          title="退出"
          onClick={() =>
            void rpc("quitApp").catch(() => {
              try {
                bridge().window.close();
              } catch {
                /* ignore */
              }
            })
          }
        >
          <X size={14} />
        </button>
      </div>
    </header>
  );
}

export function ShellMain() {
  const view = useShell((s) => s.view);
  const sidebarCollapsed = useShell((s) => s.sidebarCollapsed);
  const settings = useShell((s) => s.settings);
  const modelOptions = useShell((s) => s.modelOptions);
  const uiContributions = useShell((s) => s.uiContributions);
  const timeline = useSession((s) => s.timeline);
  const streaming = useSession((s) => s.streaming);
  const busy = useSession((s) => s.busy);
  const sessionLoading = useSession((s) => s.sessionLoading);
  const prompt = useSession((s) => s.prompt);
  const attachments = useSession((s) => s.attachments);
  const workspaces = useSession((s) => s.workspaces);
  const usage = useSession((s) => s.usage);

  const activeWorkspace = useMemo(
    () => workspaces.find((ws) => pathsEqual(ws.path, settings.cwd)),
    [workspaces, settings.cwd],
  );

  const about = useShell((s) => s.about);
  const updateHint = useShell((s) => s.updateHint);
  const activeId = useSession((s) => s.activeId);

  const activePluginContribution = useMemo(() => {
    if (typeof view !== "string" || !view.startsWith("plugin:")) return undefined;
    const id = view.slice("plugin:".length);
    return uiContributions.find((contribution) => contribution.id === id);
  }, [view, uiContributions]);

  return (
    <section
      className="main-col"
      style={{
        // 设置 / 扩展视图隐藏侧栏，占满整行；对话按侧栏状态扣减
        width:
          view !== "chat"
            ? "100%"
            : sidebarCollapsed
              ? "calc(100% - var(--sidebar-collapsed-width))"
              : "calc(100% - var(--sidebar-width))",
      }}
    >
      <ShellHeader />
      <ChatView
        hidden={view !== "chat"}
        timeline={timeline}
        streaming={streaming}
        busy={busy}
        sessionLoading={sessionLoading}
        prompt={prompt}
        setPrompt={setPromptView}
        attachments={attachments}
        setAttachments={setAttachmentsView}
        onSend={onSend}
        settings={settings}
        setSettings={setSettingsView}
        modelOptions={modelOptions}
        usage={usage}
        workspaces={workspaces}
        activeWorkspace={activeWorkspace}
        chooseWorkspace={chooseWorkspace}
        createTempWorkspace={createTempWorkspace}
        selectWorkspace={selectWorkspace}
        onOpenPathDialog={openPathDialog}
        onToast={toast}
      />
      {view === "settings" && (
        <SettingsView
          settings={settings}
          setSettings={setSettingsView}
          theme={settings.theme === "light" ? "light" : "dark"}
          workspaces={workspaces}
          usage={usage}
          about={about}
          updateHint={updateHint}
          onCheckUpdates={() => {
            shellStore.set({ updateHint: "正在检查…" });
            void rpc("checkForUpdates");
          }}
          refreshUsage={refreshUsage}
          activeId={activeId}
          chooseWorkspace={chooseWorkspace}
          createTempWorkspace={createTempWorkspace}
          selectWorkspace={selectWorkspace}
          removeWorkspace={removeWorkspace}
          onBack={() => void showChat()}
          loadSettings={loadSettings}
          refreshSessions={refreshSessions}
          onToast={toast}
        />
      )}
      {view === "extensions" && <ExtensionsView onBack={() => void showChat()} />}
      {activePluginContribution ? <PluginPanel contribution={activePluginContribution} /> : null}
    </section>
  );
}

export function ToastHost() {
  const toasts = useShell((s) => s.toasts);
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.level}`}>
          {t.level === "success" ? <CheckCircle2 size={14} className="toast__icon" /> : null}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

export function SplashHost() {
  const splash = useShell((s) => s.splash);
  const booted = useShell((s) => s.booted);
  const splashStatus = useShell((s) => s.splashStatus);
  if (!splash) return null;
  return (
    <div className={`splash${booted ? " splash--exit" : ""}`} data-aluka-drag>
      <div className="splash-logo"><Logo size={96} /></div>
      <div className="splash-title">Aluka</div>
      <div className="splash-sub">橙光剖面 · 本地编码助手</div>
      <div className="splash-loader"><span /></div>
      <div className="splash-status">
        {booted ? null : <Spinner size={13} label={splashStatus} />}
        <span>{booted ? "即将进入" : splashStatus}</span>
      </div>
    </div>
  );
}

export function DialogHost() {
  const wsPathOpen = useShell((s) => s.wsPathOpen);
  const wsPathDraft = useShell((s) => s.wsPathDraft);
  const wsPickMode = useShell((s) => s.wsPickMode);
  const modal = useShell((s) => s.modal);
  const selectChoice = useShell((s) => s.selectChoice);
  const modalInput = useShell((s) => s.modalInput);
  const deleteConfirm = useShell((s) => s.deleteConfirm);

  return (
    <>
      {wsPathOpen ? (
        <Dialog
          open
          title="打开工作区"
          size="md"
          onClose={() => shellStore.set({ wsPathOpen: false })}
          footer={
            <>
              <Button variant="secondary" onClick={() => shellStore.set({ wsPathOpen: false })}>
                取消
              </Button>
              <Button
                onClick={() => {
                  const dir = wsPathDraft.trim();
                  if (!dir) return;
                  shellStore.set({ wsPathOpen: false });
                  void addWorkspaceByPath(dir, wsPickMode);
                }}
              >
                打开
              </Button>
            </>
          }
        >
          <p className="ui-dialog__message">
            输入文件夹路径。未选择时，新对话会使用自动生成的临时目录。
          </p>
          <Input
            label="文件夹路径"
            placeholder="E:\code\my-project"
            value={wsPathDraft}
            onChange={(text) => shellStore.set({ wsPathDraft: text })}
          />
        </Dialog>
      ) : modal && modal.kind !== "notify" ? (
        <ExtensionUiModal
          request={modal}
          selectChoice={selectChoice}
          setSelectChoice={(value) => shellStore.set({ selectChoice: value })}
          inputDraft={modalInput}
          setInputDraft={(value) => shellStore.set({ modalInput: value })}
          onRespond={(response) => void respondUi(response)}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(deleteConfirm)}
        title="删除会话"
        variant="danger"
        confirmText="删除"
        message={`确定删除会话「${deleteConfirm?.title ?? ""}」？\n会话记录文件将被删除，此操作不可恢复。`}
        onCancel={() => shellStore.set({ deleteConfirm: undefined })}
        onConfirm={() => void confirmDeleteSession()}
      />
    </>
  );
}
