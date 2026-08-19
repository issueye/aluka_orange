/**
 * 扩展 UI 弹窗：confirm / select / input 三种交互请求的模态呈现。
 * 由 App 壳持有 modal 状态并路由 runtime.event 的 extension_ui 请求，
 * 本组件只负责渲染与应答回调。
 */
import { Button, Input } from "./index.ts";
import type { ExtensionUiRequest } from "../types.ts";

/** 需要模态呈现的请求（notify 走 Toast，不进弹窗） */
export type ModalRequest = Extract<ExtensionUiRequest, { kind: "confirm" | "select" | "input" }>;

export type ExtensionUiResponse =
  | { id: string; kind: "confirm"; value: boolean }
  | { id: string; kind: "select"; value?: string }
  | { id: string; kind: "input"; value?: string };

export function ExtensionUiModal(props: {
  request: ModalRequest;
  selectChoice: string | undefined;
  setSelectChoice: (value: string) => void;
  inputDraft: string;
  setInputDraft: (value: string) => void;
  onRespond: (response: ExtensionUiResponse) => void;
}) {
  const { request: modal } = props;
  return (
    <div className="modal-card">
      <h3>{modal.title}</h3>
      <p className="modal-body">{modal.kind === "confirm" ? modal.message : modal.kind === "select" ? "请选择一项：" : ""}</p>
      {modal.kind === "select" ? (
        <div className="modal-options">
          {modal.options.map((opt) => (
            <button key={opt} type="button" style={{ outline: props.selectChoice === opt ? "1px solid var(--link)" : undefined }} onClick={() => props.setSelectChoice(opt)}>
              {opt}
            </button>
          ))}
        </div>
      ) : null}
      {modal.kind === "input" ? (
        <Input
          className="modal-input"
          placeholder={modal.placeholder ?? ""}
          value={props.inputDraft}
          onChange={props.setInputDraft}
        />
      ) : null}
      <div className="modal-actions">
        <Button variant="secondary" onClick={() => {
          if (modal.kind === "confirm") props.onRespond({ id: modal.id, kind: "confirm", value: false });
          if (modal.kind === "select") props.onRespond({ id: modal.id, kind: "select", value: undefined });
          if (modal.kind === "input") props.onRespond({ id: modal.id, kind: "input", value: undefined });
        }}>取消</Button>
        <Button onClick={() => {
          if (modal.kind === "confirm") props.onRespond({ id: modal.id, kind: "confirm", value: true });
          if (modal.kind === "select") props.onRespond({ id: modal.id, kind: "select", value: props.selectChoice });
          if (modal.kind === "input") props.onRespond({ id: modal.id, kind: "input", value: props.inputDraft });
        }}>确定</Button>
      </div>
    </div>
  );
}
