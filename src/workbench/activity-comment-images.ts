import { createHash } from "node:crypto";
import { extname } from "node:path";
import sharp from "sharp";
import type { ActivityFile } from "./activity-attachment-store";
import { MAX_PROJECT_DOCUMENT_BYTES } from "./document-policy";

export const MAX_COMMENT_IMAGE_PIXELS = 16_000_000;
const formats = { ".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".webp": "webp" } as const;
const validated = new WeakMap<Uint8Array, { sha256: string; name: string; mimeType: string }>();
export class ActivityCommentImageError extends Error {}
const invalidImage = () => new ActivityCommentImageError("图片无效，仅支持完整的静态 PNG、JPEG、WebP，且不得超过 1600 万像素。");
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const isActivityCommentImage = (file: ActivityFile) => extname(file.name).toLowerCase() in formats || file.mimeType.startsWith("image/");

/** A synchronous repository accepts only bytes that this process has fully decoded and re-encoded. */
export function validatePreparedCommentImage(file: ActivityFile) {
  const known = validated.get(file.bytes);
  if (!known || known.name !== file.name || known.mimeType !== file.mimeType || known.sha256 !== digest(file.bytes)) throw invalidImage();
  return { kind: "image" as const, extension: extname(file.name).toLowerCase(), sha256: known.sha256 };
}
function matchesSignature(bytes: Buffer, format: string) {
  if (format === "png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (format === "jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}
function rejectAnimation(bytes: Buffer, format: string) {
  if (format === "jpeg") return;
  const png = format === "png";
  let offset = png ? 8 : 12;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw invalidImage();
    const length = png ? bytes.readUInt32BE(offset) : bytes.readUInt32LE(offset + 4);
    const type = bytes.subarray(offset + (png ? 4 : 0), offset + (png ? 8 : 4)).toString("ascii");
    if (["acTL", "fcTL", "fdAT", "ANIM", "ANMF"].includes(type)) throw invalidImage();
    const next = offset + length + (png ? 12 : 8 + length % 2);
    if (next > bytes.length) throw invalidImage();
    offset = next;
  }
}
async function sanitizeImage(file: ActivityFile): Promise<ActivityFile> {
  const format = formats[extname(file.name).toLowerCase() as keyof typeof formats];
  const mimeType = `image/${format}`;
  const bytes = Buffer.from(file.bytes);
  if (!format || !bytes.length || (file.mimeType && file.mimeType !== "application/octet-stream" && file.mimeType !== mimeType) || !matchesSignature(bytes, format)) throw invalidImage();
  rejectAnimation(bytes, format);
  try {
    const decoder = sharp(bytes, { failOn: "warning", limitInputPixels: MAX_COMMENT_IMAGE_PIXELS });
    const metadata = await decoder.metadata();
    if (metadata.format !== format || (metadata.pages ?? 1) !== 1 || !metadata.width || !metadata.height || metadata.width > 8192 || metadata.height > 8192 || metadata.width * metadata.height > MAX_COMMENT_IMAGE_PIXELS) throw invalidImage();
    // toBuffer forces complete pixel decoding; default encoding strips EXIF, ICC and other metadata.
    const cleanBytes = await decoder.rotate().toFormat(format).toBuffer();
    const clean = { name: file.name, mimeType, bytes: cleanBytes };
    validated.set(cleanBytes, { name: clean.name, mimeType, sha256: digest(cleanBytes) });
    return clean;
  } catch { throw invalidImage(); }
}
export async function prepareActivityCommentImages(files: readonly ActivityFile[]): Promise<ActivityFile[]> {
  if (files.length > 10) throw new Error("最多上传 10 个文件。");
  if (files.reduce((sum, file) => sum + file.bytes.byteLength, 0) > MAX_PROJECT_DOCUMENT_BYTES) throw new Error("本次附件总大小不能超过 20 MB。");
  const prepared: ActivityFile[] = [];
  let total = 0;
  // Decode sequentially to keep concurrent multi-photo requests from allocating every raster at once.
  for (const file of files) {
    if (!file.name.trim() || file.name.length > 240 || /[/\\\x00-\x1f\x7f]/.test(file.name)) throw new Error("文件名无效。");
    const clean = isActivityCommentImage(file) ? await sanitizeImage(file) : file;
    total += clean.bytes.byteLength;
    if (total > MAX_PROJECT_DOCUMENT_BYTES) throw new Error("本次附件总大小不能超过 20 MB。");
    prepared.push(clean);
  }
  return prepared;
}
