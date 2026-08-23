/**
 * 组件档 SSR 服务（Node 子进程运行；aluka 主进程经 HTTP 桥接）
 *
 * 渲染核心在 plugin-ui-core.tsx（本进程经 jiti 加载，react/@aluka/ui 别名解析到宿主实现）；
 * 插件 TSX 经 esbuild 转译 + jiti 解析（import 别名把持 React 单例）。
 *
 * 协议：POST /render { modulePath, contributionId, restored? } → { ok, html?, error? }
 *      POST /action { contributionId, name, payload? }        → { ok, html?, error? }
 *      POST /unload { contributionId }                        → { ok, state? }
 * 就绪信号：stdout 打印 `[ssr] ready <port>`（主进程解析后开始转发）。
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** apps/desktop（react 解析根） */
const appRoot = path.resolve(__dirname, "..");
/** aluka_orange/agent（jiti / esbuild 所在位置） */
const agentRoot = path.resolve(appRoot, "../../../agent");
const requireApp = createRequire(path.join(appRoot, "package.json"));
const requireAgent = createRequire(path.join(agentRoot, "package.json"));
const kitPath = path.resolve(appRoot, "src/main/plugin-ui-kit.mjs");
const corePath = path.resolve(appRoot, "src/main/plugin-ui-core.tsx");

const { createJiti } = await import(
  pathToFileURL(path.join(agentRoot, "node_modules", "jiti", "lib", "jiti.mjs")).href
);
const esbuild = requireAgent("esbuild");
const jiti = createJiti(path.join(appRoot, "package.json"), {
  interopDefault: true,
  tryNative: false,
  fsCache: false,
  alias: {
    react: requireApp.resolve("react"),
    "react/jsx-runtime": requireApp.resolve("react/jsx-runtime"),
    "react-dom": requireApp.resolve("react-dom"),
    "react-dom/server": requireApp.resolve("react-dom/server"),
    "@aluka/ui": kitPath,
  },
});

// —— 渲染核心（渲染/动作/卸载逻辑）+ 组件导入器（esbuild 转 TSX → jiti 解析） ——
const core = await jiti.import(corePath);

/** 编译插件 TSX → 临时 ESM 文件（按源码哈希缓存） */
const builtCache = new Map();
async function importPluginModule(modulePath) {
  const source = fs.readFileSync(modulePath, "utf8");
  const hash = crypto.createHash("sha1").update(source).digest("hex").slice(0, 12);
  const cached = builtCache.get(modulePath);
  if (cached?.hash === hash) return jiti.import(cached.file);
  const { code } = await esbuild.transform(source, {
    loader: "tsx",
    format: "esm",
    jsx: "automatic",
    target: "es2022",
  });
  const file = path.join(
    os.tmpdir(),
    `aluka-ssr-${path.basename(modulePath, ".tsx")}-${hash}.mjs`,
  );
  fs.writeFileSync(file, code, "utf8");
  builtCache.set(modulePath, { hash, file });
  return jiti.import(file);
}

core.initCore(importPluginModule);

const server = http.createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  let params = {};
  try {
    params = body ? JSON.parse(body) : {};
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "invalid json" }));
    return;
  }
  const payload =
    req.url === "/render"
      ? await core.renderContribution(params)
      : req.url === "/action"
        ? await core.runAction(params)
        : req.url === "/unload"
          ? core.unloadComponent(params)
          : { ok: false, error: "not found" };
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  console.log(`[ssr] ready ${typeof address === "object" && address ? address.port : 0}`);
});
