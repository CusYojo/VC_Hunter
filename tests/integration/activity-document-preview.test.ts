import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { extractActivityDocumentPreview } from "@/workbench/activity-document-preview";

async function docx(text: string, extraEntries: Record<string, string> = {}) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  for (const [name, content] of Object.entries(extraEntries)) zip.file(name, content);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

describe("bounded approval DOCX preview", () => {
  it("extracts text from an actual DOCX ZIP archive", async () => {
    expect(await extractActivityDocumentPreview("docx", await docx("审批资料：正常文本"))).toContain("审批资料：正常文本");
  });
  it("rejects highly compressed XML before unbounded preview extraction", async () => {
    const archive = await docx("x".repeat(8 * 1024 * 1024));
    expect(archive.byteLength).toBeLessThan(100_000);
    await expect(extractActivityDocumentPreview("docx", archive)).rejects.toThrow(/预览解压限制/);
  });
  it("enforces actual inflated size even when the archive lies about its uncompressed size", async () => {
    const archive = await docx("x".repeat(8 * 1024 * 1024));
    for (let offset = 0; offset < archive.length - 46; offset += 1) {
      const signature = archive.readUInt32LE(offset);
      if (signature === 0x04034b50 && archive.subarray(offset + 30, offset + 30 + archive.readUInt16LE(offset + 26)).toString() === "word/document.xml") archive.writeUInt32LE(1, offset + 22);
      if (signature === 0x02014b50 && archive.subarray(offset + 46, offset + 46 + archive.readUInt16LE(offset + 28)).toString() === "word/document.xml") archive.writeUInt32LE(1, offset + 24);
    }
    await expect(extractActivityDocumentPreview("docx", archive)).rejects.toThrow(/预览解压限制/);
  });
  it("bounds the total actual decompressed data across individually permitted entries", async () => {
    const archive = await docx("small", { "a.xml": "a".repeat(6 * 1024 * 1024), "b.xml": "b".repeat(6 * 1024 * 1024), "c.xml": "c".repeat(6 * 1024 * 1024) });
    await expect(extractActivityDocumentPreview("docx", archive)).rejects.toThrow(/预览解压限制/);
  });
});
