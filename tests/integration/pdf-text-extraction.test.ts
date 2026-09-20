import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { extractDocumentText } from "@/workbench/documents";

const fixture = (name: string) => readFile(new URL(`../fixtures/pdf/${name}`, import.meta.url));

describe("local PDF reading", () => {
  it("reads Chinese CID fonts and every page using local CMap assets", async () => {
    const text = await extractDocumentText("pdf", await fixture("chinese-multipage.pdf"));
    expect(text).toContain("工程样机验证完成");
    expect(text).toContain("下一步可靠性测试");
  });
  it("explains that image-only documents need OCR instead of succeeding with an empty attachment", async () => {
    await expect(extractDocumentText("pdf", await fixture("image-only.pdf"))).rejects.toMatchObject({ code: "PDF_NO_TEXT", message: expect.stringContaining("OCR") });
  });
  it("gives an actionable password-protection message without exposing parser internals", async () => {
    await expect(extractDocumentText("pdf", await fixture("password-protected.pdf"))).rejects.toMatchObject({ code: "PDF_PASSWORD_REQUIRED", message: expect.stringContaining("密码") });
  });
  it("identifies invalid PDF structure with a safe error", async () => {
    await expect(extractDocumentText("pdf", Buffer.from("%PDF-1.7\nprivate invalid text"))).rejects.toMatchObject({ code: "PDF_INVALID", message: expect.not.stringContaining("private") });
  });
});
