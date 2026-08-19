/**
 * 解析本机 Aluka 运行时（aluka.exe）。
 *
 * 默认开发机路径：E:\codes\go_projects\aluka_lang\aluka_lang\bin\aluka.exe
 * 也可设环境变量 ALUKA，或把 aluka 放进 PATH。
 */
import fs from "node:fs";
import path from "node:path";

export const ALUKA_LANG_ROOT = "E:\\codes\\go_projects\\aluka_lang\\aluka_lang";

const BIN_NAMES = process.platform === "win32" ? ["aluka.exe", "aluka"] : ["aluka", "aluka.exe"];
const RELATIVE_FROM_CODES = ["go_projects", "aluka_lang", "aluka_lang", "bin"];

export function resolveAluka(fromDir = process.cwd()) {
  const fromEnv = process.env.ALUKA?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return path.resolve(fromEnv);

  const candidates = [];
  for (const name of BIN_NAMES) {
    candidates.push(path.join(ALUKA_LANG_ROOT, "bin", name));
  }

  let dir = path.resolve(fromDir);
  for (let i = 0; i < 12; i++) {
    for (const name of BIN_NAMES) {
      candidates.push(path.join(dir, ...RELATIVE_FROM_CODES, name));
      candidates.push(path.resolve(dir, "..", ...RELATIVE_FROM_CODES, name));
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return path.resolve(candidate);
  }
  return "aluka";
}
