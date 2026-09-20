import { withApiAuth } from "@/security/api-auth";
import { getAppDatabase } from "@/db/app";
import { dataResponse, errorResponse } from "@/api/envelope";
import { getCandidateDocument } from "@/workbench/manual-candidate";
import { extractActivityDocumentPreview } from "@/workbench/activity-document-preview";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withApiAuth(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params; const file = getCandidateDocument(getAppDatabase(),id);
  if (!file) return errorResponse(request,404,"NOT_FOUND","原始资料不存在。");
  const download = new URL(request.url).searchParams.get("download") === "1";
  if (download || file.kind === "pdf") return new Response(new Uint8Array(file.bytes), { headers: { "content-type": file.kind === "pdf" ? "application/pdf" : file.kind === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "text/plain; charset=utf-8", "content-disposition": `${download ? "attachment" : "inline"}; filename="document"; filename*=UTF-8''${encodeURIComponent(file.name)}`, "content-length": String(file.byteLength), "x-content-type-options": "nosniff", "cache-control": "private, no-store", "content-security-policy": "sandbox; default-src 'none'" } });
  try { const text = await extractActivityDocumentPreview(file.kind,file.bytes); return dataResponse(request,{ text: text.slice(0,50000), truncated: text.length>50000 }); }
  catch { return errorResponse(request,422,"PREVIEW_FAILED","资料无法预览，请下载原文件。 "); }
});
