/**
 * 聊天图片附件处理：选择 / 粘贴 / 拖拽得到的图片文件 → 压缩后的待发送附件。
 *
 * - 最长边超过 MAX_EDGE 时用 canvas 等比缩小，控制发给模型的数据量
 * - PNG 截图类小图保持原格式，其余统一重编码为 JPEG（质量 0.88）
 * - 超过单张大小上限或附件数量达到上限时拒绝并给出原因
 */
import type { ImageAttachment } from "../types.ts";

/** 压缩后最长边（px） */
const MAX_EDGE = 2048;
/** 单张原始文件大小上限（MB） */
const MAX_FILE_MB = 20;
/** 待发送附件数量上限 */
export const MAX_ATTACHMENTS = 6;

let seq = 0;

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片解码失败"));
    img.src = src;
  });
}

/** 等比缩放绘制到 canvas；无需缩放且格式保留时返回 null（沿用原 dataUrl） */
async function reencode(file: File, dataUrl: string): Promise<{ dataUrl: string; mimeType: string }> {
  const img = await loadImage(dataUrl);
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  const needScale = longest > MAX_EDGE;
  const keepPng = !needScale && file.type === "image/png";

  if (!needScale && keepPng) {
    return { dataUrl, mimeType: "image/png" };
  }

  const scale = needScale ? MAX_EDGE / longest : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return { dataUrl, mimeType: file.type || "image/jpeg" };
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const out = canvas.toDataURL("image/jpeg", 0.88);
  return { dataUrl: out, mimeType: "image/jpeg" };
}

export type AddImageResult = { added: ImageAttachment[]; skipped: Array<{ name: string; reason: string }> };

/** 把一批图片文件转成附件（超限的在 skipped 里说明原因） */
export async function filesToAttachments(
  files: File[],
  currentCount: number,
): Promise<AddImageResult> {
  const added: ImageAttachment[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];

  for (const file of files) {
    if (currentCount + added.length >= MAX_ATTACHMENTS) {
      skipped.push({ name: file.name || "图片", reason: `最多 ${MAX_ATTACHMENTS} 张图片` });
      continue;
    }
    if (!file.type.startsWith("image/")) {
      skipped.push({ name: file.name || "文件", reason: "不是图片文件" });
      continue;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      skipped.push({ name: file.name || "图片", reason: `超过 ${MAX_FILE_MB}MB` });
      continue;
    }
    try {
      const raw = await readAsDataUrl(file);
      const { dataUrl, mimeType } = await reencode(file, raw);
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      added.push({
        id: `img-${Date.now()}-${seq++}`,
        name: file.name || `图片${mimeType === "image/png" ? ".png" : ".jpg"}`,
        dataUrl,
        base64,
        mimeType,
        size: Math.round((base64.length * 3) / 4),
      });
    } catch (err) {
      skipped.push({ name: file.name || "图片", reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { added, skipped };
}

/** 从粘贴事件里提取图片文件（无图片时返回空数组） */
export function imagesFromPaste(e: React.ClipboardEvent): File[] {
  const items = Array.from(e.clipboardData?.items ?? []);
  return items
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((f): f is File => Boolean(f));
}

/** 从拖拽事件里提取图片文件 */
export function imagesFromDrop(e: React.DragEvent): File[] {
  return Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"));
}

/** 格式化附件大小 */
export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}
