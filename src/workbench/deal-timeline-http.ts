import { commentDeletionError } from "./comment-deletion";
import { dataResponse, errorResponse } from "@/api/envelope";
import { z } from "zod";
import type { CurrentUser } from "./contracts";
import { milestoneAttachmentInputSchema, milestoneInputSchema, milestoneUpdateSchema, notificationReadSchema, projectCommentInputSchema } from "./contracts";
import type { SqliteDealTimelineRepository } from "./deal-timeline";
import { DEAL_STAGES } from "./deal-stages";
import { mappedError, parseJson, requireIdempotencyHeader } from "./http";
import { MAX_PROJECT_DOCUMENT_BYTES } from "./document-policy";
import { uploadProjectDocument } from "./documents";

/** 项目推进时间表的 HTTP 适配层：里程碑 / 附件 / 批注 / 提醒；只做参数解析与错误映射。 */

export function handleListMilestones(request: Request, repository: SqliteDealTimelineRepository, projectId: string): Response {
  return dataResponse(request, { items: repository.listMilestones(projectId), stages: DEAL_STAGES });
}

export async function handleCreateMilestone(request: Request, repository: SqliteDealTimelineRepository, user: CurrentUser, projectId: string): Promise<Response> {
  const key = requireIdempotencyHeader(request);
  if (!key) return errorResponse(request, 400, "IDEMPOTENCY_REQUIRED", "必须提供 Idempotency-Key。");
  const parsed = await parseJson(request, milestoneInputSchema);
  if (!parsed.ok) return errorResponse(request, 400, "SCHEMA_INVALID", "推进节点参数无效。", parsed.details);
  try {
    const created = repository.createMilestone(projectId, parsed.data, key, user.id);
    return dataResponse(request, created, { status: 201, headers: { location: `/api/v1/projects/${projectId}/milestones/${created.id}` } });
  } catch (error) { return mappedError(request, error, "MILESTONE_REJECTED", "创建推进节点失败。"); }
}

export async function handleUpdateMilestone(request: Request, repository: SqliteDealTimelineRepository, user: CurrentUser, projectId: string, milestoneId: string): Promise<Response> {
  const key = requireIdempotencyHeader(request);
  if (!key) return errorResponse(request, 400, "IDEMPOTENCY_REQUIRED", "必须提供 Idempotency-Key。");
  const parsed = await parseJson(request, milestoneUpdateSchema);
  if (!parsed.ok) return errorResponse(request, 400, "SCHEMA_INVALID", "推进节点参数无效。", parsed.details);
  try { return dataResponse(request, repository.updateMilestone(projectId, milestoneId, parsed.data, key, user.id)); }
  catch (error) { return mappedError(request, error, "MILESTONE_REJECTED", "更新推进节点失败。"); }
}

export async function handleAddAttachment(request: Request, repository: SqliteDealTimelineRepository, user: CurrentUser, projectId: string, milestoneId: string): Promise<Response> {
  const key = requireIdempotencyHeader(request);
  if (!key) return errorResponse(request, 400, "IDEMPOTENCY_REQUIRED", "必须提供 Idempotency-Key。");
  if (request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
    let form: FormData;
    try { form = await request.formData(); }
    catch { return errorResponse(request, 400, "SCHEMA_INVALID", "上传表单无效。"); }
    const file = form.get("file");
    const expectedVersionRaw = form.get("expectedVersion");
    if (!(file instanceof File) || typeof expectedVersionRaw !== "string" || !/^[1-9]\d*$/.test(expectedVersionRaw)) return errorResponse(request, 400, "SCHEMA_INVALID", "请选择文件并刷新项目版本后重试。");
    if (file.size > MAX_PROJECT_DOCUMENT_BYTES) return errorResponse(request, 413, "PAYLOAD_TOO_LARGE", "单文件不能超过 20 MB。");
    const titleValue = form.get("title");
    const title = typeof titleValue === "string" && titleValue.trim() ? titleValue.trim() : file.name;
    if (!repository.findMilestone(projectId, milestoneId)) return errorResponse(request, 404, "NOT_FOUND", "推进节点不存在。");
    try {
      const uploaded = await uploadProjectDocument(repository.database, {
        projectId, expectedVersion: Number(expectedVersionRaw), name: file.name, mimeType: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()), externalPolicy: "local_only", actorId: user.id,
        idempotencyKey: `${key}:document`,
      });
      const created = repository.addAttachment(projectId, milestoneId, { title, uri: null, documentId: uploaded.id, note: "" }, `${key}:attachment`, user.id);
      return dataResponse(request, { ...created, projectVersion: uploaded.projectVersion }, { status: 201 });
    } catch (error) { return mappedError(request, error, "ATTACHMENT_REJECTED", "上传并添加附件失败。"); }
  }
  const parsed = await parseJson(request, milestoneAttachmentInputSchema);
  if (!parsed.ok) return errorResponse(request, 400, "SCHEMA_INVALID", "附件参数无效。", parsed.details);
  try {
    const created = repository.addAttachment(projectId, milestoneId, parsed.data, key, user.id);
    return dataResponse(request, created, { status: 201 });
  } catch (error) { return mappedError(request, error, "ATTACHMENT_REJECTED", "添加附件失败。"); }
}

export function handleListComments(request: Request, repository: SqliteDealTimelineRepository, projectId: string): Response {
  const items = repository.listComments(projectId);
  return dataResponse(request, { items, total: items.length });
}

export async function handleAddComment(request: Request, repository: SqliteDealTimelineRepository, user: CurrentUser, projectId: string): Promise<Response> {
  const key = requireIdempotencyHeader(request);
  if (!key) return errorResponse(request, 400, "IDEMPOTENCY_REQUIRED", "必须提供 Idempotency-Key。");
  const parsed = await parseJson(request, projectCommentInputSchema);
  if (!parsed.ok) return errorResponse(request, 400, "SCHEMA_INVALID", "批注参数无效。", parsed.details);
  try {
    const created = repository.addComment(projectId, parsed.data, key, user.id);
    return dataResponse(request, created, { status: 201 });
  } catch (error) { return mappedError(request, error, "COMMENT_REJECTED", "添加批注失败。"); }
}

export function handleListNotifications(request: Request, repository: SqliteDealTimelineRepository, user: CurrentUser): Response {
  const url = new URL(request.url);
  const unreadOnly = url.searchParams.get("unread") === "1" || url.searchParams.get("unread") === "true";
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw === null ? undefined : Number(limitRaw);
  if (limitRaw !== null && (!/^[1-9]\d*$/.test(limitRaw) || !Number.isInteger(limit) || (limit ?? 0) > 200)) return errorResponse(request, 400, "SCHEMA_INVALID", "limit 参数须为 1 至 200 的整数。");
  const snapshotAt = new Date().toISOString();
  const items = repository.listNotifications(user.id, { unreadOnly, limit });
  return dataResponse(request, { items, total: items.length, unread: repository.countUnread(user.id), recipientId: user.id, snapshotAt });
}

export const notificationsReadAllSchema = z.object({ before: z.iso.datetime().transform(value => new Date(value).toISOString()) }).strict();

export async function handleMarkAllNotificationsRead(request: Request, repository: SqliteDealTimelineRepository, user: CurrentUser): Promise<Response> {
  const parsed = await parseJson(request, notificationsReadAllSchema);
  if (!parsed.ok) return errorResponse(request, 400, "SCHEMA_INVALID", "通知快照时间无效。", parsed.details);
  try { return dataResponse(request, repository.markAllNotificationsRead(user.id, parsed.data.before)); }
  catch (error) { return mappedError(request, error, "NOTIFICATION_REJECTED", "更新提醒失败。"); }
}

export async function handleMarkNotification(request: Request, repository: SqliteDealTimelineRepository, user: CurrentUser, notificationId: string): Promise<Response> {
  const parsed = await parseJson(request, notificationReadSchema);
  if (!parsed.ok) return errorResponse(request, 400, "SCHEMA_INVALID", "提醒状态参数无效。", parsed.details);
  try {
    const notification = repository.markNotification(user.id, notificationId, parsed.data.read);
    return dataResponse(request, { ...notification, unread: repository.countUnread(user.id) });
  }
  catch (error) { return mappedError(request, error, "NOTIFICATION_REJECTED", "更新提醒失败。"); }
}

export function handleDeleteComment(request: Request, repository: SqliteDealTimelineRepository, user: CurrentUser, projectId: string, commentId: string): Response {
  try { return dataResponse(request, repository.deleteComment(projectId, commentId, user.id)); }
  catch (error) { return commentDeletionError(request, error) ?? mappedError(request, error, "COMMENT_REJECTED", "删除评论失败。"); }
}
