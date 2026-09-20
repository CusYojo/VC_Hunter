import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getDocument: vi.fn(), cleanup: vi.fn(), destroy: vi.fn(), getTextContent: vi.fn() }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ GlobalWorkerOptions: {}, getDocument: mocks.getDocument }));
import { extractPdfText } from "@/workbench/pdf-text";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.destroy.mockResolvedValue(undefined);
  mocks.getTextContent.mockResolvedValue({ items: [{ str: "line one", hasEOL: true }, {}, { str: "line two" }] });
  mocks.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 1, getPage: async () => ({ cleanup: mocks.cleanup, getTextContent: mocks.getTextContent }) }), destroy: mocks.destroy });
});

describe("PDF local resource and cleanup limits", () => {
  it("preserves line boundaries and releases page and document memory", async () => {
    expect(await extractPdfText(Buffer.from("synthetic"))).toBe("line one\nline two");
    expect(mocks.cleanup).toHaveBeenCalledOnce();
    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(mocks.getDocument).toHaveBeenCalledWith(expect.objectContaining({ useWorkerFetch: false, cMapPacked: true, cMapUrl: expect.stringContaining("pdfjs-dist/cmaps/") }));
  });
  it("rejects excessive page counts and destroys the document", async () => {
    mocks.getDocument.mockReturnValueOnce({ promise: Promise.resolve({ numPages: 1001 }), destroy: mocks.destroy });
    await expect(extractPdfText(Buffer.from("synthetic"))).rejects.toMatchObject({ code: "PDF_TOO_COMPLEX" });
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
  it("bounds extracted text and releases resources on failure", async () => {
    mocks.getTextContent.mockResolvedValueOnce({ items: [{ str: "x".repeat(2_000_001) }] });
    await expect(extractPdfText(Buffer.from("synthetic"))).rejects.toMatchObject({ code: "PDF_TOO_COMPLEX" });
    expect(mocks.cleanup).toHaveBeenCalledOnce();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
  it("does not leak unexpected parser errors or let cleanup errors replace a result", async () => {
    mocks.getTextContent.mockRejectedValueOnce(new Error("private/path secret"));
    await expect(extractPdfText(Buffer.from("synthetic"))).rejects.toMatchObject({ code: "PDF_READ_FAILED", message: expect.not.stringContaining("private") });
    mocks.destroy.mockRejectedValueOnce(new Error("cleanup failed"));
    expect(await extractPdfText(Buffer.from("synthetic"))).toContain("line one");
  });
});
