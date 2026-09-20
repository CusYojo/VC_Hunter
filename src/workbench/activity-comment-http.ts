import { prepareActivityCommentImages, ActivityCommentImageError } from "./activity-comment-images";
import { commentDeletionError } from "./comment-deletion";
import { z } from "zod";
import { dataResponse, errorResponse } from "@/api/envelope";
import { getAppDatabase } from "@/db/app";
import { readAIBody } from "@/ai/workspace-http";
import { ActivityCommentsRepository } from "@/repositories/activity-comments";
import { getCurrentUser, loadTeamMembers } from "./team";
import { readActivityMultipart } from "./activity-create-http";
import { activityDocumentError } from "./activity-document-http";
import { extractActivityDocumentPreview } from "./activity-document-preview";
import type { ActivityFile } from "./activity-attachment-store";
export function activityCommentsRepository() { return new ActivityCommentsRepository(getAppDatabase(), loadTeamMembers().map(member => member.id)); }
function commentError(request: Request, error: unknown) {
  if (error instanceof ActivityCommentImageError) return errorResponse(request, 400, "IMAGE_INVALID", error.message);
  const deletion = commentDeletionError(request, error);
  if (deletion) return deletion;
  const message = error instanceof Error ? error.message : "";
  if (["事项讨论不存在。", "事项讨论附件不存在。"].includes(message)) return errorResponse(request, 404, "NOT_FOUND", "事项讨论或附件不存在。");
  if (["请填写批注或附上文件。", "回复的批注不存在于本事项。", "批注分页参数无效。", "关联资料不存在。"].includes(message)) return errorResponse(request, 400, "COMMENT_INVALID", message);
  return activityDocumentError(request, error, "批注操作失败，请稍后重试。");
}
export async function listActivityComments(request: Request, id: string) {
  try {
    const query = z.object({ after: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional() }).strict().parse(Object.fromEntries(new URL(request.url).searchParams));
    return dataResponse(request, activityCommentsRepository().list(id, getCurrentUser().id, query.after));
  } catch (error) { return commentError(request, error); }
}
export async function createActivityComment(request: Request, id: string) {
  const key = request.headers.get("idempotency-key") ?? "";
  if (!key.trim() || key.length > 200) return errorResponse(request, 400, "IDEMPOTENCY_REQUIRED", "必须提供有效的 Idempotency-Key。");
  try {
    let body: unknown; let files: ActivityFile[] = [];
    if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
      const form = await readActivityMultipart(request);
      if ([...form.keys()].some(name => !["payload", "files"].includes(name)) || form.getAll("payload").length !== 1 || typeof form.get("payload") !== "string") throw new SyntaxError();
      body = JSON.parse(String(form.get("payload")));
      const values = form.getAll("files");
      if (values.length > 10) throw new Error("最多上传 10 个文件。");
      files = await Promise.all(values.map(async file => { if (!(file instanceof File)) throw new SyntaxError(); return { name: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }; }));
    } else body = JSON.parse((await readAIBody(request, 65_536)).toString("utf8"));
    files = await prepareActivityCommentImages(files);
    return dataResponse(request, activityCommentsRepository().create(id, body, getCurrentUser().id, key, files), { status: 201 });
  } catch (error) { return commentError(request, error); }
}
export async function readActivityCommentDocument(request: Request, ids: { id: string; commentId: string; documentId: string }) {
  try {
    const document = activityCommentsRepository().readDocument(ids.id, ids.commentId, ids.documentId, getCurrentUser().id);
    const download = new URL(request.url).searchParams.get("download") === "1";
    if (download || document.kind === "pdf" || document.kind === "image") {
      const name = encodeURIComponent(document.originalName).replace(/['()*]/g, value => `%${value.charCodeAt(0).toString(16).toUpperCase()}`);
      return new Response(new Uint8Array(document.bytes), { headers: {
        "Content-Type": document.mediaType,
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="document.${document.kind === "text" ? "txt" : document.kind === "markdown" ? "md" : document.kind === "image" ? ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[document.mediaType] ?? "png") : document.kind}"; filename*=UTF-8''${name}`,
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'",
      } });
    }
    try { const text = await extractActivityDocumentPreview(document.kind, document.bytes); return dataResponse(request, { text: text.slice(0, 500_000), truncated: text.length > 500_000 }); }
    catch { return errorResponse(request, 422, "PREVIEW_UNAVAILABLE", "文档暂无法预览，请下载原文件查看。"); }
  } catch (error) { return commentError(request, error); }
}

export async function deleteActivityComment(request: Request, id: string, commentId: string) {
  try { return dataResponse(request, activityCommentsRepository().delete(id, commentId, getCurrentUser().id)); }
  catch (error) { return commentError(request, error); }
}
