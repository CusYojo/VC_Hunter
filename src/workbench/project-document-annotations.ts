import { canDeleteComment } from "./comment-deletion";
import { insertNotifications, projectResponsibleIds } from "./notifications";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { DocumentAnnotation, DocumentAnnotationsResponse } from "./project-document-contracts";

export interface DocumentActor { id: string; name: string; roles: readonly string[] }
export const documentAnnotationInputSchema = z.object({
  content: z.string().trim().max(10_000),
  parentId: z.string().min(1).max(128).nullable().optional().default(null),
  action: z.enum(["comment", "approve", "request_changes"]).optional().default("comment"),
}).strict().refine((input) => (input.action === "approve" || input.content.length > 0) && (input.action === "comment" || input.parentId === null));

export function documentPermissions(actor: DocumentActor) {
  return {
    canComment: actor.roles.some((role) => ["org_admin", "investment_manager", "researcher", "compliance_reviewer"].includes(role)),
    canReview: actor.roles.some((role) => ["org_admin", "investment_manager", "compliance_reviewer"].includes(role)),
  };
}
function requireDocument(database: DatabaseSync, projectId: string, documentId: string) {
  if (!database.prepare("SELECT id FROM project_documents WHERE project_id=? AND id=?").get(projectId, documentId)) throw new Error("关联资料不存在。");
}
export function listDocumentAnnotations(database: DatabaseSync, projectId: string, documentId: string, actor: DocumentActor): DocumentAnnotationsResponse {
  requireDocument(database, projectId, documentId);
  const items = database.prepare(`SELECT id,document_id AS documentId,parent_id AS parentId,author_id AS authorId,
    author_name AS authorName,CASE WHEN deleted_at IS NULL THEN content ELSE '' END AS content,action,created_at AS createdAt,deleted_at AS deletedAt FROM project_document_annotations
    WHERE document_id=? ORDER BY rowid`).all(documentId) as unknown as DocumentAnnotation[];
  const lastReview = items.findLast((item) => item.action !== "comment");
  return { items: items.map(item => ({ ...item, canDelete: item.action === "comment" && !item.deletedAt && canDeleteComment(item.authorId, actor.id) })), reviewStatus: lastReview?.action === "approve" ? "approved" : lastReview?.action === "request_changes" ? "changes_requested" : "pending", permissions: documentPermissions(actor) };
}
export function addDocumentAnnotation(database: DatabaseSync, projectId: string, documentId: string, input: unknown, actor: DocumentActor, key: string): DocumentAnnotationsResponse {
  if (!key.trim() || key.length > 200) throw new Error("幂等键无效。");
  const parsed = documentAnnotationInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("批注参数无效。");
  const permissions = documentPermissions(actor);
  if (!permissions.canComment) throw new Error("没有批注权限。");
  if (parsed.data.action !== "comment" && !permissions.canReview) throw new Error("没有审核权限。");
  const payload = JSON.stringify({ projectId, documentId, ...parsed.data });
  database.exec("BEGIN IMMEDIATE");
  try {
    requireDocument(database, projectId, documentId);
    const prior = database.prepare("SELECT payload_json FROM project_document_annotation_requests WHERE actor_id=? AND idempotency_key=?").get(actor.id, key) as { payload_json: string } | undefined;
    if (prior && prior.payload_json !== payload) throw new Error("幂等键已用于不同请求。");
    if (!prior) insertAnnotation(database, projectId, documentId, parsed.data, actor, key, payload);
    const result = listDocumentAnnotations(database, projectId, documentId, actor);
    database.exec("COMMIT");
    return result;
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}
function insertAnnotation(database: DatabaseSync, projectId: string, documentId: string, input: z.infer<typeof documentAnnotationInputSchema>, actor: DocumentActor, key: string, payload: string) {
  if (input.parentId && !database.prepare("SELECT id FROM project_document_annotations WHERE id=? AND document_id=? AND parent_id IS NULL").get(input.parentId, documentId)) throw new Error("只能回复当前资料的一级批注。");
  const id = randomUUID();
  const now = new Date().toISOString();
  database.prepare(`INSERT INTO project_document_annotations (id,document_id,parent_id,author_id,author_name,content,action,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, documentId, input.parentId, actor.id, actor.name, input.content, input.action, now);
  database.prepare("INSERT INTO project_document_annotation_requests (actor_id,idempotency_key,annotation_id,payload_json) VALUES (?,?,?,?)").run(actor.id, key, id, payload);
  const document = database.prepare("SELECT uploaded_by,original_name FROM project_documents WHERE id=?").get(documentId)!;
  const participants = database.prepare("SELECT DISTINCT author_id FROM project_document_annotations WHERE document_id=?").all(documentId).map(row => String(row.author_id));
  insertNotifications(database, { recipientIds: [String(document.uploaded_by), ...projectResponsibleIds(database, projectId), ...participants], actorId: actor.id, kind: input.action === "comment" ? "document_comment" : "document_reviewed", projectId, commentId: id, message: input.action === "comment" ? `${actor.name} 批注了资料「${String(document.original_name)}」：${input.content.slice(0, 120)}` : `${actor.name} ${input.action === "approve" ? "审核通过" : "要求修改"}资料「${String(document.original_name)}」`, targetUrl: `/projects/${encodeURIComponent(projectId)}`, createdAt: now });
  database.prepare(`INSERT INTO platform_timeline (id,event_type,subject_type,subject_id,project_id,actor,summary,metadata_json,trace_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(randomUUID(), "document.annotated", "project_document", documentId, projectId, actor.id, input.action === "comment" ? "发表资料批注" : input.action === "approve" ? "资料审核通过" : "资料需要修改", JSON.stringify({ annotationId: id, action: input.action }), key, now);
}

export function deleteDocumentAnnotation(database: DatabaseSync, projectId: string, documentId: string, annotationId: string, actor: DocumentActor): DocumentAnnotationsResponse {
  database.exec("BEGIN IMMEDIATE");
  try {
    requireDocument(database, projectId, documentId);
    const row = database.prepare("SELECT author_id,action FROM project_document_annotations WHERE id=? AND document_id=?").get(annotationId, documentId);
    if (!row) throw new Error("评论不存在。");
    if (row.action !== "comment") throw new Error("正式审核记录不能删除。");
    if (!canDeleteComment(String(row.author_id), actor.id)) throw new Error("没有删除评论权限。");
    database.prepare("UPDATE project_document_annotations SET deleted_at=?,deleted_by=?,content='评论已删除' WHERE id=? AND deleted_at IS NULL").run(new Date().toISOString(), actor.id, annotationId);
    database.prepare("DELETE FROM member_notifications WHERE comment_id=? AND kind='document_comment'").run(annotationId);
    const result = listDocumentAnnotations(database, projectId, documentId, actor);
    database.exec("COMMIT"); return result;
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}
