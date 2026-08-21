/**
 * 扩展 UI 弹窗：confirm / select / input 三种交互请求的模态呈现。
 * 由 App 壳持有 modal 状态并路由 runtime.event 的 extension_ui 请求，
 * 本组件只负责渲染与应答回调；视觉基座复用通用 Dialog 组件。
 */
import { Button, Dialog, Input } from "./index.ts";
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
    <Dialog
      open
      title={modal.title}
      size="md"
      footer={
        <>
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
        </>
      }
    >
      {modal.kind === "confirm" ? (
        <p className="ui-dialog__message">{modal.message}</p>
      ) : modal.kind === "select" ? (
        <>
          <p className="ui-dialog__message">请选择一项：</p>
          <div className="modal-options">
            {modal.options.map((opt) => (
              <button key={opt} type="button" style={{ outline: props.selectChoice === opt ? "1px solid var(--link)" : undefined }} onClick={() => props.setSelectChoice(opt)}>
                {opt}
              </button>
            ))}
          </div>
        </>
      ) : (
        <Input
          placeholder={modal.placeholder ?? ""}
          value={props.inputDraft}
          onChange={props.setInputDraft}
        />
      )}
    </Dialog>
  );
}
