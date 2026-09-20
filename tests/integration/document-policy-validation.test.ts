import { describe, expect, it, vi } from "vitest";
import { MAX_PROJECT_DOCUMENT_BYTES, validateProjectDocument } from "@/workbench/document-policy";
import { createDocumentExternalAnalyzer, extractDocumentEvents, extractDocumentText } from "@/workbench/documents";
import type { ModelGateway } from "@/connectors/model-gateway";

vi.mock("mammoth", () => ({ extractRawText: async () => ({ value: " local docx text " }) }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ GlobalWorkerOptions: {}, getDocument: () => ({ destroy: async () => {}, promise: Promise.resolve({ numPages: 1, getPage: async () => ({ cleanup: () => {}, getTextContent: async () => ({ items: [{ str: "local pdf text" }, {}] }) }) }) }) }));

describe("local document validation", () => {
  it.each([
    ["empty.txt", "text/plain", Buffer.alloc(0), "不能为空"],
    ["large.txt", "text/plain", Buffer.alloc(MAX_PROJECT_DOCUMENT_BYTES + 1), "20 MB"],
    ["app.exe", "application/octet-stream", Buffer.from("x"), "仅支持"],
    ["wrong.txt", "application/pdf", Buffer.from("x"), "MIME"],
    ["wrong.pdf", "application/pdf", Buffer.from("fake"), "PDF 文件头"],
    ["wrong.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", Buffer.from("fake"), "DOCX 文件头"],
    ["binary.txt", "text/plain", Buffer.from([0, 1]), "二进制"],
  ])("rejects invalid upload %s", (name, mimeType, bytes, message) => {
    expect(() => validateProjectDocument({ name, mimeType, bytes })).toThrow(message);
  });
  it.each([
    ["valid.pdf", "application/pdf", Buffer.from("%PDF-1.7"), "pdf"],
    ["valid.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", Buffer.from("PKvalid"), "docx"],
    ["valid.txt", "text/plain", Buffer.from("text"), "text"],
  ])("accepts validated local file %s", (name, mimeType, bytes, kind) => {
    expect(validateProjectDocument({ name, mimeType, bytes }).kind).toBe(kind);
  });
  it("extracts text from supported local parsers", async () => {
    expect(await extractDocumentText("docx", Buffer.from("PK"))).toBe("local docx text");
    expect(await extractDocumentText("pdf", Buffer.from("%PDF-"))).toBe("local pdf text");
    expect(await extractDocumentText("markdown", Buffer.from(" local markdown "))).toBe("local markdown");
    expect(extractDocumentEvents("undated text")).toEqual([]);
  });
  it("retains the separately callable analyzer for future approved integrations", async () => {
    const model = { generateStructured: vi.fn().mockResolvedValue({ data: { summary: "future approved integration", risks: [] } }) } as unknown as ModelGateway;
    const analyze = createDocumentExternalAnalyzer(model);
    expect(await analyze("synthetic public test text", { projectId: "project-1", documentId: "document-1" })).toMatchObject({ summary: "future approved integration" });
  });
});
