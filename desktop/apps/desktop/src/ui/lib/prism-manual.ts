/**
 * 在 prism 核心模块求值前禁用其自动高亮扫描。
 *
 * prism 核心加载时会读取全局 Prism.manual；本模块必须作为 highlight.ts 的
 * 首个 import（副作用导入顺序即模块求值顺序），早于 "prismjs" 本体执行。
 */
const scope = globalThis as typeof globalThis & { Prism?: { manual?: boolean } };
scope.Prism = { ...scope.Prism, manual: true };
