import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/security/api-auth", () => ({ withApiAuth: (handler: unknown) => handler }));
vi.mock("@/security/identity-scope", () => ({ identityScope: { getStore: () => ({ tenantId: "test", accountId: "test" }) } }));
import { POST } from "@/app/api/v1/ai/extract/route";

async function extract(name: string, bytes: Uint8Array, type = "application/pdf") {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], name, { type }));
  return POST(new Request("http://localhost/api/v1/ai/extract", { method: "POST", body: form }));
}

describe("AI attachment PDF responses", () => {
  it("returns Chinese PDF text for browsers sending a generic MIME type", async () => {
    const bytes = await readFile(new URL("../fixtures/pdf/chinese-multipage.pdf", import.meta.url));
    for (const mime of ["application/pdf", "application/octet-stream", ""]) {
      const response = await extract("项目.pdf", bytes, mime);
      expect(response.status).toBe(200);
      expect((await response.json()).data).toMatchObject({ text: expect.stringContaining("工程样机验证完成"), truncated: false });
    }
  });
  it("returns a specific safe error for scanned and password-protected PDFs", async () => {
    for (const [name, code] of [["image-only.pdf", "PDF_NO_TEXT"], ["password-protected.pdf", "PDF_PASSWORD_REQUIRED"]]) {
      const response = await extract(name, await readFile(new URL(`../fixtures/pdf/${name}`, import.meta.url)));
      expect(response.status).toBe(400);
      const result = await response.json(); expect(result.error.code).toBe(code);
      expect(JSON.stringify(result)).not.toContain("node_modules");
    }
  });
  it("does not treat empty text as a successful attachment", async () => {
    const response = await extract("empty.txt", Buffer.from("   "), "text/plain");
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("DOCUMENT_NO_TEXT");
  });
  it("explains the size limit separately from PDF parsing failures", async () => {
    const response = await extract("large.pdf", Buffer.alloc(20 * 1024 * 1024 + 1));
    expect(response.status).toBe(413);
    expect((await response.json()).error.message).toContain("20 MB");
  });
});
