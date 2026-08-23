/**
 * 组件档嵌入内核入口（esbuild 打包为 ESM 单文件，编入 exe）
 *
 * - 导出渲染核心（renderContribution / runAction / unloadComponent / initCore）
 * - 导出宿主实现侧（reactEnvironment / uiKit），供 aluka 虚拟模块注册：
 *   插件组件 import "react" / "@aluka/ui" 时解析到同一实例（Redux 单例语义）。
 */
export * from "./plugin-ui-core.tsx";
export { Action, Badge, Button, Card } from "./plugin-ui-kit.mjs";
import * as React from "react";
import { renderToString } from "react-dom/server";
export { React as reactEnvironment, renderToString };
