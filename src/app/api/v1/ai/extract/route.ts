import { withApiAuth } from "@/security/api-auth";
import { identityScope } from "@/security/identity-scope";
import { dataResponse, errorResponse } from "@/api/envelope";
import { aiWorkspaceError, readAIBody } from "@/ai/workspace-http";
import { validateProjectDocument } from "@/workbench/document-policy";
import { extractActivityDocumentPreview } from "@/workbench/activity-document-preview";
import { PdfExtractionError } from "@/workbench/pdf-text";
import { extname } from "node:path";

const DOCUMENT_MIMES: Record<string, string> = {
  ".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain", ".md": "text/markdown", ".markdown": "text/markdown",
};
const VALIDATION_ERRORS = new Set([
  "文件不能为空。", "仅支持 PDF、DOCX、TXT 和 Markdown 文件。", "文件 MIME 类型与扩展名不匹配。",
  "PDF 文件头校验失败。", "DOCX 文件头校验失败。", "文本文件头包含二进制内容。",
]);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = withApiAuth(async (request: Request) => {
  if (!identityScope.getStore()) return errorResponse(request, 401, "AUTH_REQUIRED", "请先登录。");
  try {
    const bytes = await readAIBody(request, 21 * 1024 * 1024);
    const form = await new Response(new Uint8Array(bytes), { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
    const file = form.get("file");
    if (!(file instanceof File)) return errorResponse(request, 400, "FILE_REQUIRED", "请选择一份资料。");
    const buffer = new Uint8Array(await file.arrayBuffer());
    // Some browsers supply no specific MIME type; extension and byte signatures
    // still pass the same document validation before any parser sees the bytes.
    const mimeType = !file.type || file.type === "application/octet-stream"
      ? DOCUMENT_MIMES[extname(file.name).toLowerCase()] ?? file.type : file.type;
    const { kind } = validateProjectDocument({ name: file.name, mimeType, bytes: buffer });
    const text = await extractActivityDocumentPreview(kind, buffer);
    if (!text.trim()) return errorResponse(request, 400, "DOCUMENT_NO_TEXT", "这份资料没有可提取的文字，请检查内容或粘贴正文。");
    return dataResponse(request, { name: file.name, text: text.slice(0, 50000), truncated: text.length > 50000 });
  } catch (error) {
    if (error instanceof RangeError) return aiWorkspaceError(request, error);
    if (error instanceof PdfExtractionError) return errorResponse(request, 400, error.code, error.message);
    if (error instanceof Error && error.message === "单文件不能超过 20 MB。") return errorResponse(request, 413, "FILE_TOO_LARGE", error.message);
    if (error instanceof Error && VALIDATION_ERRORS.has(error.message)) return errorResponse(request, 400, "INVALID_DOCUMENT", error.message);
    return errorResponse(request, 400, "EXTRACTION_FAILED", "无法提取资料，请使用 20 MB 以内的 PDF、DOCX、TXT 或 Markdown，或粘贴正文。");
  }
});
