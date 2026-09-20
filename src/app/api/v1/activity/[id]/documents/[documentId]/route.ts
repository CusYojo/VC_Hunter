import { withApiAuth } from "@/security/api-auth";
import { dataResponse, errorResponse } from "@/api/envelope";
import { activityRepository } from "@/workbench/activity-http";
import { activityDocumentError } from "@/workbench/activity-document-http";
import { extractActivityDocumentPreview } from "@/workbench/activity-document-preview";
import { getCurrentUser } from "@/workbench/team";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withApiAuth(async (request: Request, { params }: { params: Promise<{ id: string; documentId: string }> }) => {
  try {
    const { id, documentId } = await params;
    const document = activityRepository().readDocument(id, documentId, getCurrentUser().id);
    const download = new URL(request.url).searchParams.get("download") === "1";
    if (download || document.kind === "pdf") {
      const name = encodeURIComponent(document.originalName).replace(/['()*]/g, (value) => `%${value.charCodeAt(0).toString(16).toUpperCase()}`);
      return new Response(new Uint8Array(document.bytes), { headers: {
        "Content-Type": document.mediaType,
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="document.${document.kind === "text" ? "txt" : document.kind === "markdown" ? "md" : document.kind}"; filename*=UTF-8''${name}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
      } });
    }
    try {
      const text = await extractActivityDocumentPreview(document.kind, document.bytes);
      return dataResponse(request, { text: text.slice(0, 500_000), truncated: text.length > 500_000 });
    } catch { return errorResponse(request, 422, "PREVIEW_UNAVAILABLE", "文档暂无法预览，请下载原文件查看。"); }
  } catch (error) { return activityDocumentError(request, error, "读取资料失败，请稍后重试。"); }
});
