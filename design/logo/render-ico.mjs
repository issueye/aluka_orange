/**
 * 将方案 C 的 SVG 渲染为 16–256px PNG 并组装 Windows ICO（PNG 条目）。
 * 用法：node render-ico.mjs <input.svg> <output.ico>
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const [, , svgPath, icoPath] = process.argv;
if (!svgPath || !icoPath) {
  console.error("usage: node render-ico.mjs <input.svg> <output.ico>");
  process.exit(1);
}

const svg = fs.readFileSync(svgPath, "utf8");
// 去掉根 svg 的固有宽高，由容器 HTML 精确控制渲染尺寸
const scalable = svg.replace(/width="\d+"\s+height="\d+"/, "");

const sizes = [16, 24, 32, 48, 64, 128, 256];

const browser = await chromium.launch();
const page = await browser.newPage();
const pngs = [];
for (const s of sizes) {
  await page.setViewportSize({ width: s, height: s });
  await page.setContent(
    `<!doctype html><style>*{margin:0;padding:0}html,body{width:${s}px;height:${s}px;overflow:hidden}svg{display:block;width:${s}px;height:${s}px}</style>${scalable}`,
  );
  await page.waitForTimeout(60); // 等一帧，确保渐变绘制完成
  pngs.push(await page.screenshot({ type: "png" }));
}
await browser.close();

// ── ICO 容器：ICONDIR + ICONDIRENTRY×N + PNG 数据 ──
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(sizes.length, 4);

let offset = 6 + 16 * sizes.length;
const entries = [];
pngs.forEach((buf, i) => {
  const s = sizes[i];
  const e = Buffer.alloc(16);
  e.writeUInt8(s >= 256 ? 0 : s, 0); // 宽（0 = 256）
  e.writeUInt8(s >= 256 ? 0 : s, 1); // 高
  e.writeUInt8(0, 2); // 调色板
  e.writeUInt8(0, 3); // 保留
  e.writeUInt16LE(1, 4); // planes
  e.writeUInt16LE(32, 6); // bpp
  e.writeUInt32LE(buf.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += buf.length;
  entries.push(e);
});

fs.mkdirSync(path.dirname(icoPath), { recursive: true });
fs.writeFileSync(icoPath, Buffer.concat([header, ...entries, ...pngs]));
const outDir = path.join(path.dirname(icoPath), "ico-png");
fs.mkdirSync(outDir, { recursive: true });
pngs.forEach((buf, i) => fs.writeFileSync(path.join(outDir, `icon-${sizes[i]}.png`), buf));
console.log(`wrote ${icoPath} (${sizes.length} icons: ${sizes.join(", ")})`);
