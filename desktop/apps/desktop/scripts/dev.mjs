/**
 * 一键 HMR 开发流（M3，见 docs/http-and-plugin-roadmap.md）
 *
 * - 后端：aluka run src/main/index.ts
 *   - 默认 ALUKA_HEADLESS=1（无窗口，纯浏览器开发）；ALUKA_WINDOW=1 保留 GUI 窗口
 *   - 固定 ALUKA_HTTP_PORT / ALUKA_HTTP_TOKEN，供 vite 代理与页面共用
 * - 前端：vite dev server（/rpc、/events 代理到后端；VITE_ALUKA_TOKEN 注入 token）
 *
 * 用法：npm run dev → 打开 http://localhost:5173
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAluka } from "../../../scripts/resolve-aluka.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const PORT = process.env.ALUKA_HTTP_PORT || "4560";
const TOKEN = process.env.ALUKA_HTTP_TOKEN || "aluka-dev-token";
const VITE_PORT = process.env.ALUKA_VITE_PORT || "5173";

const aluka = resolveAluka(appRoot);
console.log(`[dev] host: aluka run src/main/index.ts (port ${PORT})`);

const host = spawn(aluka, ["run", "src/main/index.ts"], {
  cwd: appRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    ALUKA_HTTP_PORT: PORT,
    ALUKA_HTTP_TOKEN: TOKEN,
    ALUKA_HEADLESS: process.env.ALUKA_WINDOW === "1" ? "0" : "1",
  },
});

async function waitForHost(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`);
      if (res.status > 0) return true;
    } catch {
      // 未就绪，继续等待
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

function killTree(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  } else {
    child.kill("SIGTERM");
  }
}

if (!(await waitForHost())) {
  console.error(`[dev] 后端 ${PORT} 端口 20s 内未就绪，退出（查看上方 host 日志）`);
  killTree(host);
  process.exit(1);
}

console.log(`[dev] host ready → vite: http://localhost:${VITE_PORT}`);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const vite = spawn(npmCommand, ["run", "vite", "--", "--port", VITE_PORT], {
  cwd: appRoot,
  stdio: "inherit",
  env: { ...process.env, ALUKA_HTTP_PORT: PORT, VITE_ALUKA_TOKEN: TOKEN },
  shell: true,
});

function cleanup() {
  killTree(vite);
  killTree(host);
}
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
