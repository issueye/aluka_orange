import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * Vite 构建配置
 * 将 src/ui 下的 React 前端打包到 dist/ui 目录。
 *
 * dev（HMR，scripts/dev.mjs）：/rpc 与 /events 代理到主进程 HTTP 服务
 * （ALUKA_HTTP_PORT，默认 4560）。changeOrigin 重写 Host、剥掉 Origin
 * 以通过主进程安全校验；token 由 VITE_ALUKA_TOKEN 注入页面（bridge.ts）。
 */
const hostPort = process.env.ALUKA_HTTP_PORT || "4560";
const proxyTarget = `http://127.0.0.1:${hostPort}`;
const stripOrigin = (proxy: { on: (event: string, handler: (req: { removeHeader: (name: string) => void }) => void) => void }) => {
  proxy.on("proxyReq", (proxyReq) => proxyReq.removeHeader("Origin"));
};

export default defineConfig({
  // 入口目录：渲染进程的前端代码
  root: path.resolve(import.meta.dirname, "src/ui"),
  // 使用相对路径，适配 WebView2 加载
  base: "./",
  plugins: [react()],
  server: {
    port: Number.parseInt(process.env.ALUKA_VITE_PORT ?? "5173", 10) || 5173,
    proxy: {
      "/rpc": { target: proxyTarget, changeOrigin: true, configure: stripOrigin },
      "/events": { target: proxyTarget, changeOrigin: true, configure: stripOrigin },
    },
  },
  build: {
    // 输出到桌面壳的 dist/ui 目录
    outDir: path.resolve(import.meta.dirname, "dist/ui"),
    emptyOutDir: true,
    target: "es2022",
  },
});
