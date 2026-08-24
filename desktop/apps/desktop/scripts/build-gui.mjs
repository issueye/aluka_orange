/**
 * 打包单文件 GUI：`aluka build --compile --gui --web-dir dist/ui`
 *
 * 用法（在 apps/desktop 或仓库根经 npm run build:gui）：
 *   node scripts/build-gui.mjs
 *
 * 环境变量：
 *   ALUKA  — aluka 可执行文件路径
 *   OUT    — 产物路径（默认仓库根 dist/AlukaDesktop.exe）
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAluka } from "../../../scripts/resolve-aluka.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const uiIndex = path.join(appRoot, "dist", "ui", "index.html");
const entry = path.join(appRoot, "src", "main", "index.ts");
const icon = path.join(appRoot, "assets", "icon.ico");
const defaultOut = path.resolve(appRoot, "../../../dist/AlukaDesktop.exe");
const outfile = process.env.OUT?.trim() || defaultOut;

if (!fs.existsSync(uiIndex)) {
  console.error(`[build-gui] UI missing: ${uiIndex}\nRun: npm run build:ui`);
  process.exit(1);
}
if (!fs.existsSync(entry)) {
  console.error(`[build-gui] entry missing: ${entry}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(outfile), { recursive: true });

const aluka = resolveAluka(appRoot);
const args = [
  "build",
  "--compile",
  "--gui",
  "--web-dir",
  path.join(appRoot, "dist", "ui"),
  "--outfile",
  outfile,
  entry,
];
if (fs.existsSync(icon)) {
  args.splice(args.length - 1, 0, "--icon", icon);
}

console.log(`[build-gui] ${aluka} ${args.join(" ")}`);
const result = spawnSync(aluka, args, {
  cwd: appRoot,
  stdio: "inherit",
  env: { ...process.env, ALUKA_DESKTOP_PACKAGED: "1" },
  shell: process.platform === "win32",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
console.log(`[build-gui] wrote ${outfile}`);
const desktopCopy = path.resolve(appRoot, "../../dist/AlukaDesktop.exe");
if (path.normalize(desktopCopy) !== path.normalize(outfile)) {
  fs.mkdirSync(path.dirname(desktopCopy), { recursive: true });
  fs.copyFileSync(outfile, desktopCopy);
  console.log(`[build-gui] copied ${desktopCopy}`);
}
