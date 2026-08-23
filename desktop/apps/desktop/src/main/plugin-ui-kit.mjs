/**
 * @aluka/ui —— 组件档基元（主进程 SSR 侧实现，Node 子进程经 jiti alias 提供）
 *
 * 纯 createElement 实现（无 JSX/TS 类型）：SSR 服务用 esbuild 转换插件 TSX，
 * 对宿主基元库需要可被 jiti 直接加载的静态 JS——与本目录 plugin-ui-kit 语义一致。
 *
 * 交互铁律：所有点击/提交一律经 <Action> 包装（SSR 输出 data-aluka-action 元素，
 * 渲染层事件委托回传 action → SSR 服务处理器 → 重渲染片段）。
 */
import { createElement as h } from "react";

const CARD_CLASS = "aluka-ui-card";
const BADGE_CLASS = "aluka-ui-badge";
const BUTTON_CLASS = "aluka-ui-button";
const ACTION_CLASS = "aluka-ui-action";

function joinClass(base, extra) {
  return extra ? `${base} ${extra}` : base;
}

export function Action(props) {
  const payload =
    props.payload === undefined
      ? undefined
      : JSON.stringify(props.payload)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
  return h(
    "span",
    {
      className: joinClass(ACTION_CLASS, props.className),
      "data-aluka-action": props.name,
      "data-aluka-payload": payload,
      "data-aluka-label": typeof props.children === "string" ? props.children : undefined,
    },
    props.children,
  );
}

export function Card(props) {
  return h("div", { className: joinClass(CARD_CLASS, props.className) }, props.children);
}

export function Badge(props) {
  const kind =
    props.kind === "success" || props.kind === "warning" || props.kind === "error"
      ? props.kind
      : "info";
  return h(
    "span",
    { className: `${joinClass(BADGE_CLASS, props.className)} is-${kind}` },
    props.children,
  );
}

/** 按钮：带 action 时经 <Action> 包装（可交互）；无 action 为纯样式静态按钮 */
export function Button(props) {
  const className = joinClass(
    `${BUTTON_CLASS}${props.variant === "primary" ? " is-primary" : ""}`,
    props.className,
  );
  if (props.action) {
    return h(
      "span",
      { className: joinClass(ACTION_CLASS, className), "data-aluka-action": props.action, "data-aluka-payload": props.payload === undefined ? undefined : JSON.stringify(props.payload), "data-aluka-label": typeof props.children === "string" ? props.children : undefined },
      props.children,
    );
  }
  return h("span", { className }, props.children);
}
