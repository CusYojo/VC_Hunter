import { crc32 } from "node:zlib";
import sharp from "sharp";
import { OfficeError } from "./office-contracts";

export const AVATAR_WIDTH = 32;
export const AVATAR_HEIGHT = 48;
export const AVATAR_MAX_BYTES = 256 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const invalid = (message = "头像 PNG 文件损坏，请重新导出后上传。"): never => { throw new OfficeError(400, "INVALID_AVATAR", message); };

/** Check the entire PNG envelope, including CRCs and animation chunks, before decoding. */
function checkPng(bytes: Buffer): void {
  if (bytes.length > AVATAR_MAX_BYTES) throw new OfficeError(413, "AVATAR_TOO_LARGE", "头像不能超过 256 KB。");
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) invalid("请上传透明背景的静态 PNG 图片。");
  let offset = 8; let dataSeen = false; let endSeen = false;
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) invalid();
    const size = bytes.readUInt32BE(offset);
    if (size > bytes.length - offset - 12) invalid();
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const end = offset + 12 + size;
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) invalid();
    if (["acTL", "fcTL", "fdAT"].includes(type)) invalid("头像须为静态 PNG，不支持动画。");
    if (offset === 8) {
      if (type !== "IHDR" || size !== 13) invalid();
      if (bytes.readUInt32BE(offset + 8) !== AVATAR_WIDTH || bytes.readUInt32BE(offset + 12) !== AVATAR_HEIGHT) invalid("头像尺寸须为 32 × 48 像素。");
    } else if (type === "IHDR") invalid();
    if (type === "IDAT") dataSeen = true;
    if (type === "IEND") {
      if (size !== 0 || end !== bytes.length || !dataSeen) invalid();
      endSeen = true;
    }
    offset = end;
  }
  if (!endSeen) invalid();
}

/** Decode all pixels and create a fresh PNG, retaining neither metadata nor uploaded chunks. */
export async function normalizeAvatarPng(input: Uint8Array): Promise<Buffer> {
  const bytes = Buffer.from(input);
  checkPng(bytes);
  try {
    const { data, info } = await sharp(bytes, { failOn: "warning", limitInputPixels: AVATAR_WIDTH * AVATAR_HEIGHT })
      .toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== AVATAR_WIDTH || info.height !== AVATAR_HEIGHT || info.channels !== 4) invalid();
    if (!data.some((value, index) => index % 4 === 3 && value < 255)) invalid("头像需要透明背景，请保留透明像素。");
    return await sharp(data, { raw: { width: AVATAR_WIDTH, height: AVATAR_HEIGHT, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
  } catch (error) {
    if (error instanceof OfficeError) throw error;
    return invalid();
  }
}

/** A small editable pixel person on a transparent 32 × 48 canvas. */
export async function createAvatarTemplate(): Promise<Buffer> {
  const pixels = Buffer.alloc(AVATAR_WIDTH * AVATAR_HEIGHT * 4);
  const rectangle = (left: number, top: number, width: number, height: number, color: readonly number[]) => {
    for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) pixels.set(color, (y * AVATAR_WIDTH + x) * 4);
  };
  rectangle(10, 4, 12, 12, [231, 187, 143, 255]);
  rectangle(10, 4, 12, 4, [63, 50, 49, 255]);
  rectangle(8, 18, 16, 17, [86, 131, 160, 255]);
  rectangle(8, 35, 6, 10, [55, 67, 84, 255]);
  rectangle(18, 35, 6, 10, [55, 67, 84, 255]);
  return sharp(pixels, { raw: { width: AVATAR_WIDTH, height: AVATAR_HEIGHT, channels: 4 } }).png().toBuffer();
}
