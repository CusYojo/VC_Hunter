import { crc32 } from "node:zlib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createAvatarTemplate, normalizeAvatarPng } from "@/organization/office-avatar";

async function fixture(width = 32, height = 48, alpha = 0) {
  return sharp({ create: { width, height, channels: 4, background: { r: 80, g: 120, b: 190, alpha } } }).png().toBuffer();
}
function chunk(type: string, bytes: Buffer) {
  const content = Buffer.concat([Buffer.from(type), bytes]);
  const size = Buffer.alloc(4); size.writeUInt32BE(bytes.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(content));
  return Buffer.concat([size, content, crc]);
}
function beforeData(png: Buffer, extra: Buffer) { return Buffer.concat([png.subarray(0, 33), extra, png.subarray(33)]); }

describe("office avatar PNG validation", () => {
  it("provides a real transparent 32 by 48 PNG template", async () => {
    const png = await createAvatarTemplate();
    const metadata = await sharp(png).metadata();
    expect(metadata).toMatchObject({ format: "png", width: 32, height: 48, hasAlpha: true });
    await expect(normalizeAvatarPng(png)).resolves.toBeInstanceOf(Buffer);
  });
  it("decodes and re-encodes pixels without retaining submitted metadata", async () => {
    const png = beforeData(await fixture(), chunk("tEXt", Buffer.from("Comment\0private submitter metadata")));
    const normalized = await normalizeAvatarPng(png);
    expect(normalized.includes(Buffer.from("private submitter metadata"))).toBe(false);
    expect(await sharp(normalized).metadata()).toMatchObject({ width: 32, height: 48, hasAlpha: true });
  });
  it.each([[31, 48], [32, 49], [1024, 1024]])("rejects invalid dimensions %s by %s", async (width, height) => {
    await expect(normalizeAvatarPng(await fixture(width, height))).rejects.toThrow(/32.*48/);
  });
  it("rejects opaque images rather than accepting an unused alpha channel", async () => {
    await expect(normalizeAvatarPng(await fixture(32, 48, 1))).rejects.toThrow(/透明/);
  });
  it("rejects animation even when the first PNG frame has valid dimensions", async () => {
    const control = Buffer.alloc(8); control.writeUInt32BE(2, 0);
    await expect(normalizeAvatarPng(beforeData(await fixture(), chunk("acTL", control)))).rejects.toThrow(/静态/);
  });
  it("rejects bad signatures, oversized payloads and incomplete/trailing PNG data", async () => {
    const png = await fixture();
    for (const input of [Buffer.from("not a png"), Buffer.alloc(256 * 1024 + 1), png.subarray(0, png.length - 1), Buffer.concat([png, Buffer.from("trailing")])]) {
      await expect(normalizeAvatarPng(input)).rejects.toThrow();
    }
  });
  it("rejects CRC corruption and corrupt image streams with valid chunk checksums", async () => {
    const png = await fixture();
    const corrupted = Buffer.from(png); corrupted[20] ^= 1;
    await expect(normalizeAvatarPng(corrupted)).rejects.toThrow();
    const chunks: Buffer[] = [png.subarray(0, 8)];
    for (let offset = 8; offset < png.length;) {
      const size = png.readUInt32BE(offset); const kind = png.toString("ascii", offset + 4, offset + 8);
      chunks.push(kind === "IDAT" ? chunk("IDAT", Buffer.from("invalid compressed image stream")) : png.subarray(offset, offset + 12 + size));
      offset += 12 + size;
    }
    await expect(normalizeAvatarPng(Buffer.concat(chunks))).rejects.toThrow();
  });
});
