/**
 * 源信息模块
 *
 * 用于标识某个工具、命令或内容的来源，
 * 方便在扩展系统中区分内容是内置的、来自扩展、还是内联生成的。
 */

/**
 * 来源信息接口
 * - path: 来源文件路径
 * - kind: 来源类型
 *   - "builtin": 内置功能
 *   - "extension": 来自扩展
 *   - "inline": 内联/动态生成
 *   - "settings": 来自配置文件
 */
export interface SourceInfo {
  path: string;
  kind: "builtin" | "extension" | "inline" | "settings";
  name?: string;
}

/**
 * 创建合成的来源信息对象
 * 用于在没有真实来源文件时构造占位的 SourceInfo
 */
export function createSyntheticSourceInfo(path: string, kind: SourceInfo["kind"] = "inline"): SourceInfo {
  return { path, kind, name: path };
}
