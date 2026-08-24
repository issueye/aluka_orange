/**
 * 对话视图：时间线 + 空态引导 + Composer（工作区选择 / 模型 / 思考深度 / 图片附件 / 发送）。
 *
 * 始终保持挂载（由 App 壳用 CSS 隐藏），以保留滚动位置与输入内容；
 * 模型 / 思考深度切换内部直连 RPC 并回调 setSettings 同步状态。
 * 图片附件支持选择 / 粘贴 / 拖拽，发送时随消息一起传给 Agent。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Check, Copy, Folder, FolderPlus, ImagePlus, X } from "lucide-react";
import { rpc } from "../bridge.ts";
import { Button, ImageViewer, LoadingBlock, Markdown, Select, Textarea } from "../components/index.ts";
import { ContextRing } from "../components/ContextRing.tsx";
import { ToolCard } from "../ToolCard.tsx";
import { SlotOutlet } from "../shell/slots.tsx";
import type { WorkspaceItem } from "../WorkspaceSidebar.tsx";
import type {
  ImageAttachment,
  ModelOption,
  SessionUsageView,
  SettingsView,
  TimelineItem,
  Toast,
} from "../types.ts";
import { filesToAttachments, formatSize, imagesFromPaste, MAX_ATTACHMENTS } from "../lib/images.ts";
import { formatUsage, pathsEqual } from "../lib/utils.ts";

/** 思考深度选项 */
const THINKING_LEVEL_OPTIONS = [
  { value: "off", label: "思考 · 关闭" },
  { value: "minimal", label: "思考 · 极低" },
  { value: "low", label: "思考 · 低" },
  { value: "medium", label: "思考 · 中" },
  { value: "high", label: "思考 · 高" },
  { value: "xhigh", label: "思考 · 极高" },
] as const;

/** 将消息角色转换为中文显示标签 */
function roleLabel(role: TimelineItem["role"], toolName?: string): string {
  if (toolName) return `工具 · ${toolName}`;
  if (role === "user") return "用户";
  if (role === "assistant") return "助手";
  if (role === "tool") return "工具";
  return "系统";
}

function formatBubbleTime(timestamp?: number): string {
  if (!timestamp) return "";
  try {
    return new Date(timestamp).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/** 自定义时间链条目（appendEntry 链路）：数据渲染为文本/JSON 摘要 */
function summarizeCustom(data?: unknown): string {
  if (data === undefined) return "（无数据）";
  if (typeof data === "string") return data;
  if (typeof data === "number" || typeof data === "boolean") return String(data);
  try {
    const text = JSON.stringify(data, null, 2);
    return text.length > 800 ? `${text.slice(0, 800)}…` : text;
  } catch {
    return String(data);
  }
}

export function ChatView(props: {
  hidden: boolean;
  timeline: TimelineItem[];
  streaming: string;
  /** 流式中的思考内容（思考深度开启时显示） */
  thinking: string;
  busy: boolean;
  /** 会话打开中（切换会话时时间线加载占位） */
  sessionLoading: boolean;
  prompt: string;
  setPrompt: (text: string) => void;
  attachments: ImageAttachment[];
  setAttachments: (next: ImageAttachment[] | ((prev: ImageAttachment[]) => ImageAttachment[])) => void;
  onSend: (e?: React.FormEvent) => void;
  settings: SettingsView;
  setSettings: (next: SettingsView | ((prev: SettingsView) => SettingsView)) => void;
  modelOptions: ModelOption[];
  usage: SessionUsageView | undefined;
  workspaces: WorkspaceItem[];
  activeWorkspace: WorkspaceItem | undefined;
  chooseWorkspace: (mode: "latest" | "new") => void;
  createTempWorkspace: () => Promise<void>;
  selectWorkspace: (cwd: string, mode?: "latest" | "new") => Promise<void>;
  /** 打开「输入路径」弹窗（App 壳持有弹窗状态） */
  onOpenPathDialog: (mode: "latest" | "new") => void;
  onToast: (message: string, level?: Toast["level"]) => void;
}) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { settings, setSettings } = props;
  const toast = props.onToast;
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [viewerSrc, setViewerSrc] = useState<string | undefined>();
  const [dragOver, setDragOver] = useState(false);
  const [attBusy, setAttBusy] = useState(false);

  const isEmptyChat = props.timeline.length === 0 && !props.streaming;
  const needsWorkspace = !settings.cwd;
  const canSend = Boolean(props.prompt.trim()) || props.attachments.length > 0;

  /** 自动滚动时间线到底部（新消息出现时） */
  useEffect(() => {
    const el = timelineRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [props.timeline, props.streaming]);

  const copyUserText = useCallback(async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1200);
    } catch {
      toast("复制失败", "error");
    }
  }, [toast]);

  /** 添加图片文件为附件（选择 / 粘贴 / 拖拽共用） */
  const addImageFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setAttBusy(true);
    try {
      const { added, skipped } = await filesToAttachments(files, props.attachments.length);
      if (added.length) props.setAttachments((prev) => [...prev, ...added]);
      for (const item of skipped) toast(`已跳过 ${item.name}：${item.reason}`, "warning");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setAttBusy(false);
    }
  }, [props, toast]);

  /** 选择模型：写回设置并同步 */
  function pickModel(next: string) {
    const [provider, ...rest] = next.split("/");
    const modelId = rest.join("/");
    if (!provider || !modelId) return;
    void (async () => {
      try {
        const view = await rpc<SettingsView>("selectModel", { provider, modelId });
        setSettings(view ?? {});
        toast(`模型 → ${provider}/${modelId}`, "info");
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "error");
      }
    })();
  }

  /** 切换思考深度：patchSettings 即时生效 */
  function pickThinking(next: string) {
    void (async () => {
      try {
        const view = await rpc<SettingsView>("patchSettings", { thinkingLevel: next });
        setSettings(view ?? {});
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "error");
      }
    })();
  }

  return (
    <div className={`chat-pane${props.hidden ? " is-hidden" : ""}${dragOver ? " is-dragover" : ""}`}>
      <div className="timeline" ref={timelineRef}>
        {props.sessionLoading && props.timeline.length === 0 && !props.streaming ? (
          <LoadingBlock text="正在加载会话…" className="timeline-loading" />
        ) : null}
        {isEmptyChat && !props.sessionLoading ? (
          <SlotOutlet
            slot="chat.empty"
            builtin={
              <div className="chat-empty">
            {needsWorkspace ? (
              <>
                <div className="chat-empty-kicker">开始对话</div>
                <h2>选择一个工作区</h2>
                <p>Agent 会在该目录下读写文件、加载技能与扩展。未选择时将使用自动生成的临时目录。</p>
                <div className="chat-empty-current">
                  <Folder size={16} />
                  <div>
                    <div className="chat-empty-name">临时工作区</div>
                    <div className="chat-empty-path">尚未选择，发送消息时会创建临时目录</div>
                  </div>
                </div>
                <div className="chat-empty-actions">
                  <Button onClick={() => props.chooseWorkspace("latest")}>
                    <FolderPlus size={14} /> 打开文件夹
                  </Button>
                  <Button variant="secondary" onClick={() => void props.createTempWorkspace()}>
                    使用临时目录
                  </Button>
                  <Button variant="ghost" onClick={() => props.onOpenPathDialog("latest")}>
                    输入路径
                  </Button>
                </div>
                {props.workspaces.filter((ws) => !ws.temporary).length ? (
                  <div className="chat-empty-recent">
                    <div className="chat-empty-recent-label">最近工作区</div>
                    {props.workspaces.slice(0, 6).map((ws) => (
                      <button
                        key={ws.path}
                        type="button"
                        className={pathsEqual(ws.path, settings.cwd) ? "active" : ""}
                        onClick={() => void props.selectWorkspace(ws.path, "latest")}
                      >
                        <Folder size={14} />
                        <span>{ws.name}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div className="chat-empty-kicker">开始对话</div>
                <h2>工作区已就绪</h2>
                <p>给 Agent 发消息即可。需要换目录时，用侧栏或输入框上的工作区按钮切换。</p>
                <div className="chat-empty-current">
                  <Folder size={16} />
                  <div>
                    <div className="chat-empty-name">
                      {props.activeWorkspace?.name || settings.cwd?.split(/[\\/]/).pop() || "工作区"}
                    </div>
                    <div className="chat-empty-path">{settings.cwd}</div>
                  </div>
                </div>
              </>
            )}
              </div>
            }
          />
        ) : null}
        {props.timeline.map((item) => {
          if (item.role === "custom") {
            return (
              <div key={item.id} className="bubble custom">
                <div className="role">{item.customType || "自定义"}</div>
                <div className="bubble-text">{summarizeCustom(item.customData)}</div>
              </div>
            );
          }
          if (item.role === "tool") {
            return (
              <div key={item.id} className="bubble tool">
                <ToolCard item={item} />
              </div>
            );
          }
          if (item.role === "user") {
            const timeLabel = formatBubbleTime(item.timestamp);
            const isCopied = copiedId === item.id;
            return (
              <div key={item.id} className="bubble-row bubble-row--user">
                <div className="bubble user" tabIndex={0}>
                  <div className="bubble-user-actions" aria-hidden={false}>
                    <button
                      type="button"
                      className={`bubble-copy${isCopied ? " bubble-copy--copied" : ""}`}
                      title={isCopied ? "已复制" : "复制"}
                      aria-label={isCopied ? "已复制" : "复制消息"}
                      onClick={() => void copyUserText(item.id, item.text)}
                    >
                      {isCopied ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                  {item.images?.length ? (
                    <div className="bubble-user-images">
                      {item.images.map((img, i) => (
                        <img
                          key={`${item.id}-img-${i}`}
                          src={`data:${img.mimeType};base64,${img.data}`}
                          alt={item.text || "用户图片"}
                          onClick={() => setViewerSrc(`data:${img.mimeType};base64,${img.data}`)}
                        />
                      ))}
                    </div>
                  ) : null}
                  {item.text ? <div className="bubble-text">{item.text}</div> : null}
                </div>
                {timeLabel ? <div className="bubble-meta">{timeLabel}</div> : null}
              </div>
            );
          }
          return (
            <div key={item.id} className={`bubble ${item.role === "system" ? "error" : item.role}`}>
              <div className="role">{roleLabel(item.role, item.toolName)}</div>
              {item.role === "assistant" ? (
                <>
                  {item.thinking ? (
                    <details className="bubble-thinking" open={false}>
                      <summary>思考过程</summary>
                      <div className="bubble-thinking__body">{item.thinking}</div>
                    </details>
                  ) : null}
                  {item.text ? <Markdown>{item.text}</Markdown> : null}
                </>
              ) : (
                <div className="bubble-text">{item.text}</div>
              )}
            </div>
          );
        })}
        {props.streaming ? (
          <div className="bubble assistant">
            <div className="role">助手</div>
            {props.thinking ? (
              <details className="bubble-thinking" open={false}>
                <summary>思考过程</summary>
                <div className="bubble-thinking__body">{props.thinking}</div>
              </details>
            ) : null}
            <Markdown>{props.streaming}</Markdown>
          </div>
        ) : null}
      </div>
      {/* 输入区上方独立区（composer 卡片外、整宽条带）：插件组件卡挂载点 */}
      <SlotOutlet slot="chat.composer.before" />
      <div className="composer-wrap" data-aluka-drag="no-drag">
        <form
          className="composer"
          onSubmit={(e) => props.onSend(e)}
          onDragOver={(e) => {
            if (e.dataTransfer?.types?.includes("Files")) {
              e.preventDefault();
              setDragOver(true);
            }
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setDragOver(false);
          }}
          onDrop={(e) => {
            const dropped = Array.from(e.dataTransfer?.files ?? []);
            if (!dropped.length) return;
            e.preventDefault();
            setDragOver(false);
            const images = dropped.filter((f) => f.type.startsWith("image/"));
            if (!images.length) {
              toast("仅支持拖入图片文件", "warning");
              return;
            }
            void addImageFiles(images);
          }}
        >
          {props.attachments.length || attBusy ? (
            <div className="ui-attachments">
              {props.attachments.map((att) => (
                <div key={att.id} className="ui-attachment" title={`${att.name} · ${formatSize(att.size)}`}>
                  <img src={att.dataUrl} alt={att.name} onClick={() => setViewerSrc(att.dataUrl)} />
                  <button
                    type="button"
                    className="ui-attachment__remove"
                    title={`移除 ${att.name}`}
                    onClick={() => props.setAttachments((prev) => prev.filter((x) => x.id !== att.id))}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
              {attBusy ? <div className="ui-attachment ui-attachment--busy"><LoadingBlock size={14} text="" /></div> : null}
            </div>
          ) : null}
          <Textarea
            className="ui-textarea--composer"
            rows={3}
            value={props.prompt}
            placeholder={
              dragOver
                ? "松开鼠标添加图片…"
                : `给 Agent 发消息…（Enter 发送，Shift+Enter 换行，可粘贴/拖入图片）`
            }
            onChange={props.setPrompt}
            onPaste={(e) => {
              const files = imagesFromPaste(e);
              if (!files.length) return;
              e.preventDefault();
              void addImageFiles(files);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                props.onSend();
              }
            }}
          />
          <SlotOutlet
            slot="chat.composer.actions"
            builtin={
              <div className="composer-actions">
                <div className="composer-actions-left">
              <button
                type="button"
                className="icon-btn composer-attach-btn"
                title={props.attachments.length >= MAX_ATTACHMENTS
                  ? `已达上限（${MAX_ATTACHMENTS} 张）`
                  : "添加图片（也可直接粘贴 / 拖入）"}
                disabled={props.busy || props.attachments.length >= MAX_ATTACHMENTS}
                onClick={() => fileInputRef.current?.click()}
              >
                <ImagePlus size={15} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  void addImageFiles(files);
                }}
              />
              <button
                type="button"
                className="composer-workspace"
                title={settings.cwd || "临时工作区"}
                onClick={() => props.chooseWorkspace("latest")}
              >
                <Folder size={13} />
                <span>
                  {props.activeWorkspace?.name
                    || (settings.cwd ? settings.cwd.split(/[\\/]/).pop() : "选择工作区")}
                </span>
              </button>
            </div>
            <div className="composer-actions-right">
              <Select
                className="model-picker ui-select--compact"
                value={
                  settings.provider && settings.model
                    ? `${settings.provider}/${settings.model}`
                    : ""
                }
                disabled={props.busy}
                placeholder="暂无模型 — 请到设置中添加"
                options={
                  props.modelOptions.length
                    ? props.modelOptions.map((m) => ({
                      value: `${m.provider}/${m.id}`,
                      label: `${m.provider}/${m.name || m.id}${m.configured ? "" : " · 缺密钥"}`,
                    }))
                    : settings.provider && settings.model
                      ? [{
                        value: `${settings.provider}/${settings.model}`,
                        label: `${settings.provider}/${settings.model}`,
                      }]
                      : []
                }
                onChange={pickModel}
              />
              <Select
                className="thinking-picker ui-select--compact"
                value={settings.thinkingLevel ?? "off"}
                disabled={props.busy}
                options={THINKING_LEVEL_OPTIONS.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
                onChange={pickThinking}
              />
              {props.busy ? (
                <button
                  type="button"
                  className="composer-run-btn"
                  title="停止生成"
                  aria-label="停止生成"
                  onClick={() => void rpc("abortPrompt")}
                >
                  <span className="composer-run-btn__orbit" aria-hidden="true">
                    <span className="composer-run-btn__spark" />
                  </span>
                  <span className="composer-run-btn__stop" />
                </button>
              ) : (
                <Button
                  type="submit"
                  className="composer-send-btn"
                  title="发送（Enter）"
                  aria-label="发送"
                  disabled={!canSend}
                >
                  <ArrowUp size={16} />
                </Button>
              )}
              </div>
              </div>
            }
          />
          <SlotOutlet slot="chat.composer.after" />
        </form>
        <SlotOutlet
          slot="chat.meta"
          builtin={
            <div className="composer-meta">
              <div className="usage-chip">{formatUsage(props.usage)}</div>
              <ContextRing
                used={props.usage?.contextTokens ?? 0}
                window={props.usage?.contextWindow ?? 0}
              />
            </div>
          }
        />
      </div>

      {viewerSrc ? <ImageViewer src={viewerSrc} onClose={() => setViewerSrc(undefined)} /> : null}
    </div>
  );
}
