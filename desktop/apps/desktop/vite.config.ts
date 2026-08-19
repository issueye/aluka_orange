import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * Vite 构建配置
 * 将 src/ui 下的 React 前端打包到 dist/ui 目录。
 */
export default defineConfig({
  // 入口目录：渲染进程的前端代码
  root: path.resolve(import.meta.dirname, "src/ui"),
  // 使用相对路径，适配 WebView2 加载
  base: "./",
  plugins: [react()],
  build: {
    // 输出到桌面壳的 dist/ui 目录
    outDir: path.resolve(import.meta.dirname, "dist/ui"),
    emptyOutDir: true,
    target: "es2022",
  },
});
