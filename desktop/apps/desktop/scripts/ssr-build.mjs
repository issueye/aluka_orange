/**
 * 构建组件档嵌入内核（vite/rollup 库模式）
 *
 * react / react-dom/server / plugin-ui-kit 经 rollup-commonjs 转为**原生 ESM named
 * exports**（不用 esbuild 的 __require shim——aluka 加载该 shim 会报
 * `undefined is not a constructor`）。产物 src/main/ssr-embedded.mjs（无外部依赖），
 * 编译版（单文件 exe、无 Node）由 aluka 主进程直接 import。
 *
 * 用法：node scripts/ssr-build.mjs（build:ui / build:gui 前自动执行）
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { build } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const entry = process.env.SSR_BUILD_PROBE
  ? path.resolve(appRoot, "src/main/ssr-probe-entry.tsx")
  : path.resolve(appRoot, "src/main/ssr-embedded-entry.tsx");
const outDir = process.env.SSR_BUILD_PROBE
  ? path.resolve(appRoot, "src/main/ssr-probe")
  : path.resolve(appRoot, "src/main/ssr-out");
const outfile = path.resolve(outDir, "ssr-embedded.mjs");

async function main() {
  console.log("[ssr-build] bundling embedded core (vite lib mode)…");
  await build({
    configFile: false,
    logLevel: "warn",
    build: {
      lib: {
        entry,
        formats: ["es"],
        fileName: () => "ssr-embedded.mjs",
      },
      rollupOptions: {
        output: {
          dir: outDir,
          entryFileNames: "ssr-embedded.mjs",
        },
        external: [],
      },
      commonjsOptions: { transformMixedEsModules: true },
      minify: false,
      sourcemap: false,
    },
    esbuild: {
      jsx: "automatic",
      target: "es2022",
      define:
        process.env.SSR_BUILD_DEV === "1"
          ? { "process.env.NODE_ENV": '"development"' }
          : { "process.env.NODE_ENV": '"production"' },
    },
    resolve: {
      conditions: ["node"],
      // react-dom-server.node 引用裸内置名（crypto/stream/async_hooks），
      // vite 按浏览器外置会生成无前缀 import——aluka 只解析 node: 前缀，这里统一改写。
      alias: {
        // 浏览器变体不引用 stream/crypto/async_hooks——rollup 对 node: 内置的
        // CJS require 包装在 aluka 下不可用（undefined is not a constructor）。
        "react-dom/server": path.resolve(appRoot, "node_modules/react-dom/server.browser.js"),
      },
    },
  });
  const size = fs.statSync(outfile).size;
  console.log(`[ssr-build] wrote ${outfile} (${(size / 1024).toFixed(0)} kB)`);
}

main().catch((error) => {
  console.error("[ssr-build] failed", error);
  process.exit(1);
});
