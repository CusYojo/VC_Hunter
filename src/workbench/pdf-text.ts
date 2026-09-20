import { dirname, join, sep } from "node:path";
import { pathToFileURL } from "node:url";

const PDF_ERRORS = {
  PDF_PASSWORD_REQUIRED: "这份 PDF 需要密码，暂时无法提取正文。可直接打开原文件输入密码查看；如需 AI 分析，可上传解锁后的副本。",
  PDF_NO_TEXT: "这份 PDF 没有可提取的文字，可能是扫描件或图片。可以直接打开原文件查看；如需 AI 分析正文，可另行提供文字或 OCR 识别后的版本。",
  PDF_INVALID: "这份 PDF 结构损坏或内容不完整，暂时无法提取正文。可尝试直接打开原文件查看，或重新导出后上传。",
  PDF_TOO_COMPLEX: "这份 PDF 页数或文字量过多，请拆分为较小的文档后上传。",
  PDF_READ_FAILED: "暂时无法提取这份 PDF 的正文。可以直接打开原文件查看；如需 AI 分析，可重新导出后上传或粘贴正文。",
} as const;

export class PdfExtractionError extends Error {
  constructor(public readonly code: keyof typeof PDF_ERRORS) {
    super(PDF_ERRORS[code]);
    this.name = "PdfExtractionError";
  }
}

/** Resolve assets from the installed package, never from a document-supplied URL.
 * pdfjs must stay external to Next's server bundle so its Node runtime stays intact.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  let task: import("pdfjs-dist/types/src/display/api").PDFDocumentLoadingTask | undefined;
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // Webpack rewrites imported createRequire().resolve() to a numeric module
    // ID. Obtain Node's resolver at runtime so this remains a filesystem path.
    const resolvePackage = process.getBuiltinModule("module")
      .createRequire(join(process.cwd(), "package.json")).resolve;
    const root = dirname(resolvePackage("pdfjs-dist/package.json"));
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(join(root, "legacy/build/pdf.worker.mjs")).href;
    task = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      cMapUrl: join(root, "cmaps") + sep,
      cMapPacked: true,
      standardFontDataUrl: join(root, "standard_fonts") + sep,
      wasmUrl: join(root, "wasm") + sep,
      useSystemFonts: true,
      useWorkerFetch: false,
      verbosity: 0,
    });
    const pdf = await task.promise;
    if (pdf.numPages > 1000) throw new PdfExtractionError("PDF_TOO_COMPLEX");
    const pages: string[] = [];
    let length = 0;
    for (let index = 1; index <= pdf.numPages; index += 1) {
      const page = await pdf.getPage(index);
      try {
        const content = await page.getTextContent();
        const text = content.items.map((item) => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("").trim();
        length += text.length;
        if (length > 2_000_000) throw new PdfExtractionError("PDF_TOO_COMPLEX");
        pages.push(text);
      } finally { page.cleanup(); }
    }
    const text = pages.join("\n\n").trim();
    if (!text) throw new PdfExtractionError("PDF_NO_TEXT");
    return text;
  } catch (error) {
    if (error instanceof PdfExtractionError) throw error;
    const name = error instanceof Error ? error.name : "";
    if (name === "PasswordException") throw new PdfExtractionError("PDF_PASSWORD_REQUIRED");
    if (name === "InvalidPDFException") throw new PdfExtractionError("PDF_INVALID");
    throw new PdfExtractionError("PDF_READ_FAILED");
  } finally {
    // In pdfjs 6 the loading task owns destruction, not PDFDocumentProxy.
    await task?.destroy().catch(() => undefined);
  }
}
