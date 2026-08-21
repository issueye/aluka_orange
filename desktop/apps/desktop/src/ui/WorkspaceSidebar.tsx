import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Filter, Folder, FolderOpen, FolderPlus, PanelLeftClose, Plus, SquarePen, Trash2 } from "lucide-react";
import { Logo } from "./Logo";

export type WorkspaceSession = {
  id: string;
  title: string;
  mtime: number;
};

export type WorkspaceItem = {
  path: string;
  name: string;
  temporary: boolean;
  sessions: WorkspaceSession[];
};

const COLLAPSED_WS_KEY = "aluka.collapsedWorkspaces";

export function relativeTime(mtime: number): string {
  const diff = Date.now() - mtime;
  const minutes = Math.max(0, Math.round(diff / 60_000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(mtime).toLocaleDateString();
}

function loadCollapsedWorkspaces(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_WS_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    return new Set();
  }
}

type WorkspaceSidebarProps = {
  workspaces: WorkspaceItem[];
  activeCwd?: string;
  activeSessionId?: string;
  /** 正在运行的会话（含后台并行会话），用于显示运行中标记 */
  busySessionIds?: Set<string>;
  onNewChat: () => void;
  /** 在指定工作区新建会话并切换到该会话 */
  onNewChatIn: (cwd: string) => void;
  onOpenSession: (id: string, cwd: string) => void;
  onSelectWorkspace: (cwd: string) => void;
  onAddWorkspace: () => void;
  onCreateTemp: () => void;
  onDeleteSession: (id: string, cwd: string) => void;
  /** 从列表移除工作区（不删除磁盘文件） */
  onRemoveWorkspace: (cwd: string) => void;
  /** 在系统文件管理器中打开工作区所在文件夹 */
  onRevealFolder: (cwd: string) => void;
  onCollapseSidebar: () => void;
};

export function WorkspaceSidebar({
  workspaces,
  activeCwd,
  activeSessionId,
  busySessionIds,
  onNewChat,
  onNewChatIn,
  onOpenSession,
  onSelectWorkspace,
  onAddWorkspace,
  onCreateTemp,
  onDeleteSession,
  onRemoveWorkspace,
  onRevealFolder,
  onCollapseSidebar,
}: WorkspaceSidebarProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsedWorkspaces);

  useEffect(() => {
    localStorage.setItem(COLLAPSED_WS_KEY, JSON.stringify([...collapsed]));
  }, [collapsed]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return workspaces;
    return workspaces
      .map((ws) => {
        const nameHit = ws.name.toLowerCase().includes(q) || ws.path.toLowerCase().includes(q);
        const sessions = ws.sessions.filter((s) => (s.title || s.id).toLowerCase().includes(q));
        if (nameHit) return ws;
        if (!sessions.length) return undefined;
        return { ...ws, sessions };
      })
      .filter((ws): ws is WorkspaceItem => Boolean(ws));
  }, [query, workspaces]);

  function toggleWorkspace(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  const searching = Boolean(query.trim());

  return (
    <>
      <div className="sidebar-brand" data-aluka-drag>
        <Logo size={22} />
        <div className="name">Aluka</div>
        <button
          type="button"
          className="icon-btn"
          data-aluka-drag="no-drag"
          title="新建会话"
          onClick={(e) => {
            e.stopPropagation();
            onNewChat();
          }}
        >
          <SquarePen size={16} />
        </button>
        <button
          type="button"
          className="icon-btn"
          data-aluka-drag="no-drag"
          title="收起侧栏"
          onClick={(e) => {
            e.stopPropagation();
            onCollapseSidebar();
          }}
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      <div className="ws-head" data-aluka-drag="no-drag">
        <div className="ws-title">工作区</div>
        <button
          type="button"
          className={`icon-btn ${filterOpen ? "active" : ""}`}
          title="筛选"
          onClick={() => setFilterOpen((v) => !v)}
        >
          <Filter size={15} />
        </button>
        <button type="button" className="icon-btn" title="添加工作区" onClick={onAddWorkspace}>
          <FolderPlus size={16} />
        </button>
      </div>

      {filterOpen ? (
        <div className="ws-filter" data-aluka-drag="no-drag">
          <input
            value={query}
            placeholder="筛选工作区或会话…"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      ) : null}

      <div className="ws-tree" data-aluka-drag="no-drag">
        {filtered.length ? filtered.map((ws) => {
          const selected = Boolean(activeCwd && pathsEqual(ws.path, activeCwd));
          const folded = !searching && collapsed.has(ws.path);
          return (
            <section key={ws.path} className={`ws-group ${selected ? "selected" : ""} ${folded ? "is-folded" : ""}`}>
              <div className={`ws-folder-row ${selected ? "active" : ""}`}>
                <button
                  type="button"
                  className="ws-fold"
                  title={folded ? "展开工作区" : "收起工作区"}
                  onClick={() => toggleWorkspace(ws.path)}
                >
                  {folded ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                </button>
                <button
                  type="button"
                  className={`ws-folder ${selected ? "active" : ""}`}
                  title={ws.path}
                  onClick={() => {
                    if (folded) toggleWorkspace(ws.path);
                    onSelectWorkspace(ws.path);
                  }}
                >
                  <Folder size={15} />
                  <span className="ws-folder-name">{ws.name}</span>
                </button>
                <button
                  type="button"
                  className="ws-folder-del ws-folder-new"
                  title={`在此工作区新建会话：${ws.path}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onNewChatIn(ws.path);
                  }}
                >
                  <Plus size={14} />
                </button>
                <button
                  type="button"
                  className="ws-folder-del ws-folder-open"
                  title={`打开所在文件夹：${ws.path}`}
                  onClick={(e) => {
                    console.log("reveal folder", ws.path);
                    e.stopPropagation();
                    onRevealFolder(ws.path);
                  }}
                >
                  <FolderOpen size={13} />
                </button>
                <button
                  type="button"
                  className="ws-folder-del"
                  title={`移除工作区（不删除文件）：${ws.path}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveWorkspace(ws.path);
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              {folded ? null : ws.sessions.length ? (
                <ul className="ws-sessions">
                  {ws.sessions.map((s) => (
                    <li key={`${ws.path}:${s.id}`}>
                      <button
                        type="button"
                        className={`ws-session-open ${s.id === activeSessionId && selected ? "active" : ""}`}
                        onClick={() => onOpenSession(s.id, ws.path)}
                      >
                        {busySessionIds?.has(s.id) ? <span className="ws-session-running" title="运行中" /> : null}
                        <span className="ws-session-title">{s.title || s.id}</span>
                        <span className="ws-time">{relativeTime(s.mtime)}</span>
                      </button>
                      <button
                        type="button"
                        className="ws-session-del"
                        title="移除会话"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteSession(s.id, ws.path);
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="ws-empty">暂无会话</div>
              )}
            </section>
          );
        }) : (
          <div className="ws-empty ws-empty-tree">
            {query.trim() ? "无匹配工作区" : "还没有工作区"}
            <button type="button" className="ws-empty-action" onClick={onAddWorkspace}>
              打开文件夹
            </button>
            <button type="button" className="ws-empty-action" onClick={onCreateTemp}>
              使用临时目录
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function pathsEqual(a: string, b: string): boolean {
  return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
}
