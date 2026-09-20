import { withApiAuth } from "@/security/api-auth";
import { dataResponse, errorResponse } from "@/api/envelope";
import { getAppDatabase } from "@/db/app";
import { readOperationDocument } from "@/workbench/business-operations";
import { operationActor, operationError } from "@/workbench/business-operation-http";
import { extractActivityDocumentPreview } from "@/workbench/activity-document-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withApiAuth(async (request: Request, { params }: { params: Promise<{ kind: string; id: string; documentId: string }> }) => {
  try {
    const { kind, id, documentId } = await params;
    const document = readOperationDocument(getAppDatabase(), operationActor(), kind, id, documentId);
    const download = new URL(request.url).searchParams.get("download") === "1";
    if (download || document.kind === "pdf") {
      const name = encodeURIComponent(document.originalName).replace(/['()*]/g, value => `%${value.charCodeAt(0).toString(16).toUpperCase()}`);
      const extension = document.kind === "text" ? "txt" : document.kind === "markdown" ? "md" : document.kind;
      return new Response(new Uint8Array(document.bytes), { headers: {
        "Content-Type": document.mediaType,
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="document.${extension}"; filename*=UTF-8''${name}`,
        "Content-Length": String(document.bytes.byteLength), "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'",
      } });
    }
    try {
      const text = await extractActivityDocumentPreview(document.kind, document.bytes);
      return dataResponse(request, { text: text.slice(0, 500_000), truncated: text.length > 500_000 });
    } catch { return errorResponse(request, 422, "PREVIEW_UNAVAILABLE", "附件暂无法提取正文，请打开或下载原文件查看。"); }
  } catch (error) { return operationError(request, error); }
});
