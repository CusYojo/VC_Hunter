import { expect, it } from "vitest";
import sharp from "sharp";
import { prepareActivityCommentImages } from "@/workbench/activity-comment-images";
import { prepareActivityFiles } from "@/workbench/activity-attachment-store";
import { validateProjectDocument } from "@/workbench/document-policy";
const image = (format: "png" | "jpeg" | "webp" = "png") => sharp({ create: { width: 24, height: 16, channels: 3, background: "#276899" } }).toFormat(format).withMetadata({ exif: { IFD0: { Artist: "private photographer" } } }).toBuffer();

it.each(["png", "jpeg", "webp"] as const)("decodes and sanitizes real %s comment photos without opening project uploads", async (format) => {
  const file = { name: `photo.${format}`, mimeType: `image/${format}`, bytes: await image(format) };
  const [safe] = await prepareActivityCommentImages([file]);
  const metadata = await sharp(safe.bytes).metadata();
  expect(metadata).toMatchObject({ format, width: 24, height: 16 });
  expect(metadata.exif).toBeUndefined(); expect(metadata.icc).toBeUndefined();
  expect(prepareActivityFiles([safe], { allowImages: true })[0]).toMatchObject({ kind: "image", mimeType: `image/${format}` });
  expect(() => prepareActivityFiles([safe])).toThrow(/仅支持/);
  expect(() => validateProjectDocument(safe)).toThrow(/仅支持/);
});
it("requires complete decoding even when callers invoke the synchronous repository preparation directly", async () => {
  const file = { name: "photo.png", mimeType: "image/png", bytes: await image() };
  expect(() => prepareActivityFiles([file], { allowImages: true })).toThrow(/图片/);
  const [safe] = await prepareActivityCommentImages([file]);
  safe.bytes[10] ^= 1;
  expect(() => prepareActivityFiles([safe], { allowImages: true })).toThrow(/图片/);
});
it("rejects SVG, mismatched content, truncated PNG and excessive decoded dimensions", async () => {
  const valid = await image();
  for (const file of [
    { name: "bad.svg", mimeType: "image/svg+xml", bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') },
    { name: "forged.png", mimeType: "image/png", bytes: Buffer.from("<svg>fake</svg>") },
    { name: "mismatch.jpg", mimeType: "image/jpeg", bytes: valid },
    { name: "mime.png", mimeType: "image/webp", bytes: valid },
    { name: "short.png", mimeType: "image/png", bytes: valid.subarray(0, 35) },
    { name: "oversize.png", mimeType: "image/png", bytes: await sharp({ create: { width: 5000, height: 4000, channels: 3, background: "white" } }).png().toBuffer() },
  ]) await expect(prepareActivityCommentImages([file])).rejects.toThrow();
});
it("preserves ordinary documents and enforces byte, filename and file-count boundaries", async () => {
  const text = { name: "notes.txt", mimeType: "text/plain", bytes: Buffer.from("notes") };
  expect(await prepareActivityCommentImages([text])).toEqual([text]);
  expect(prepareActivityFiles(await prepareActivityCommentImages([text]), { allowImages: true })[0].kind).toBe("text");
  await expect(prepareActivityCommentImages(Array.from({ length: 11 }, () => text))).rejects.toThrow(/10/);
  await expect(prepareActivityCommentImages([{ ...text, bytes: new Uint8Array(20 * 1024 * 1024 + 1) }])).rejects.toThrow(/20 MB/);
  await expect(prepareActivityCommentImages([{ name: "../photo.png", mimeType: "image/png", bytes: await image() }])).rejects.toThrow(/文件名/);
  const [safe] = await prepareActivityCommentImages([{ name: "photo.PNG", mimeType: "application/octet-stream", bytes: await image() }]);
  expect(safe.mimeType).toBe("image/png");
});

it("rejects animation control chunks rather than silently taking the first frame", async () => {
  const png = await image();
  const control = Buffer.alloc(20); control.writeUInt32BE(8); control.write("acTL", 4); control.writeUInt32BE(2, 8);
  const animated = Buffer.concat([png.subarray(0, 33), control, png.subarray(33)]);
  await expect(prepareActivityCommentImages([{ name: "animated.png", mimeType: "image/png", bytes: animated }])).rejects.toThrow(/静态/);
});
