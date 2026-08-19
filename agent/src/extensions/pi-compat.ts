/**
 * pi-coding-agent 兼容入口（jiti alias / Aluka 虚拟模块）。
 *
 * getAgentDir 对齐真实 pi（~/.pi/agent），且本文件不回指 aluka_pi 的 index，
 * 避免加载插件时形成循环依赖。
 */

import os from "node:os";
import path from "node:path";

export const VERSION = "0.1.0";
export const CONFIG_DIR_NAME = ".aluka";
export const PI_CONFIG_DIR_NAME = ".pi";

export function getHomeDir(): string {
  return process.env.ALUKA_HOME ?? process.env.PI_HOME ?? os.homedir();
}

/** 对齐真实 pi：扩展眼里的 agent 目录是 ~/.pi/agent */
export function getPiAgentDir(): string {
  return path.join(getHomeDir(), ".pi", "agent");
}

export const getAgentDir = getPiAgentDir;

export { CustomEditor } from "../custom-editor.ts";
