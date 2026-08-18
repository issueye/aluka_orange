import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const mainEntry = path.join(appRoot, "src", "main", "index.ts");
const uiIndex = path.join(appRoot, "dist", "ui", "index.html");

function resolveAluka() {
  const fromEnv = process.env.ALUKA?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const candidates = [
    // E:\codes\ts_projects\aluka_desktop\apps\desktop → E:\codes\go_projects\...
    path.resolve(appRoot, "../../../../go_projects/aluka_lang/aluka_lang/bin/aluka.exe"),
    path.resolve(appRoot, "../../../../go_projects/aluka_lang/aluka_lang/bin/aluka"),
    "aluka",
  ];
  for (const c of candidates) {
    if (c === "aluka") return c;
    if (fs.existsSync(c)) return c;
  }
  return "aluka";
}

if (!fs.existsSync(uiIndex)) {
  console.error(`UI not built: missing ${uiIndex}\nRun: pnpm build:ui`);
  process.exit(1);
}

const aluka = resolveAluka();
console.log(`[aluka-desktop] using ${aluka}`);
console.log(`[aluka-desktop] cwd ${appRoot}`);
console.log(`[aluka-desktop] entry ${mainEntry}`);

const child = spawn(aluka, ["run", mainEntry], {
  cwd: appRoot,
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
