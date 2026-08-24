/**
 * @aluka/ui 插件基元类型声明（实现见 plugin-ui-kit.mjs，纯 createElement 无 TS）
 * SSR 宿主（plugin-ui-core.tsx）、插件 TSX 均引用此模块。
 */
import type { ReactElement, ReactNode } from "react";

export function Action(props: {
  name: string;
  payload?: unknown;
  className?: string;
  children?: ReactNode;
}): ReactElement;

export function Card(props: {
  className?: string;
  children?: ReactNode;
}): ReactElement;

export function Badge(props: {
  kind?: "success" | "warning" | "error" | "info";
  className?: string;
  children?: ReactNode;
}): ReactElement;

export function Button(props: {
  action?: string;
  payload?: unknown;
  variant?: "primary";
  className?: string;
  children?: ReactNode;
}): ReactElement;