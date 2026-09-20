import { canDeleteComment, isCommentAdministrator } from "@/workbench/comment-deletion";
import { activityNotificationUrl, insertNotifications } from "@/workbench/notifications";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { activityCommentInputSchema, type ActivityComment, type ActivityCommentPage } from "@/workbench/activity-comment-contracts";
import { filePayload, prepareActivityFiles, validateProjectFileReferences, type ActivityFile } from "@/workbench/activity-attachment-store";
import { readProjectDocument } from "@/workbench/project-document-content";
import type { ActivityDocumentKind } from "@/workbench/activity-contracts";

export class ActivityCommentsRepository {
  constructor(private readonly db: DatabaseSync, private readonly members: readonly string[], private readonly options: { storageRoot?: string } = {}) {}
  private authorize(activityId: string, actor: string) {
    const allowed = isCommentAdministrator(actor) ? this.db.prepare("SELECT id FROM workspace_activity WHERE id=? AND deleted_at IS NULL").get(activityId) : this.members.includes(actor) && this.db.prepare(`SELECT id FROM workspace_activity a WHERE a.id=? AND a.deleted_at IS NULL AND (a.created_by=? OR EXISTS (
      SELECT 1 FROM workspace_activity_responses r WHERE r.activity_id=a.id AND r.member_id=?))`).get(activityId, actor, actor);
    if (!allowed) throw new Error("事项讨论不存在。");
  }
  list(activityId: string, actor: string, after = 0): ActivityCommentPage {
    this.authorize(activityId, actor);
    if (!Number.isSafeInteger(after) || after < 0) throw new Error("批注分页参数无效。");
    const rows = this.db.prepare("SELECT * FROM activity_comments WHERE activity_id=? AND seq>? ORDER BY seq LIMIT 101").all(activityId, after);
    const items = rows.slice(0, 100).map(row => this.map(row, actor));
    return { items, hasMore: rows.length > 100, nextCursor: items.at(-1)?.sequence ?? null };
  }
  create(activityId: string, raw: unknown, actor: string, key: string, files: readonly ActivityFile[] = []): ActivityComment {
    this.authorize(activityId, actor);
    const input = activityCommentInputSchema.parse(raw);
    if (!key.trim() || key.length > 200) throw new Error("幂等键无效。");
    const prepared = prepareActivityFiles(files, { allowImages: true }), ids = [...new Set(input.projectDocumentIds)].sort();
    if (!input.body && !prepared.length && !ids.length) throw new Error("请填写批注或附上文件。");
    const payload = JSON.stringify({ body: input.body, parentId: input.parentId, projectDocumentIds: ids, files: prepared.map(filePayload) });
    this.db.exec("BEGIN IMMEDIATE");
    try {
      // Repeat access checks inside the same transaction as the append.
      this.authorize(activityId, actor);
      const prior = this.db.prepare("SELECT * FROM activity_comments WHERE activity_id=? AND author_id=? AND request_key=?").get(activityId, actor, key);
      if (prior) {
        if (prior.input_json !== payload) throw new Error("幂等键已用于其他内容。");
        const result = this.map(prior, actor); this.db.exec("COMMIT"); return result;
      }
      if (input.parentId && !this.db.prepare("SELECT id FROM activity_comments WHERE id=? AND activity_id=?").get(input.parentId, activityId)) throw new Error("回复的批注不存在于本事项。");
      validateProjectFileReferences(this.db, ids);
      const id = randomUUID(), now = new Date().toISOString();
      this.db.prepare("INSERT INTO activity_comments(id,activity_id,parent_id,author_id,body,created_at,request_key,input_json) VALUES (?,?,?,?,?,?,?,?)").run(id, activityId, input.parentId, actor, input.body, now, key, payload);
      for (const file of prepared) this.db.prepare("INSERT INTO activity_comment_documents(id,comment_id,original_name,media_type,document_kind,byte_length,content) VALUES (?,?,?,?,?,?,?)").run(randomUUID(), id, file.name, file.mimeType, file.kind, file.bytes.byteLength, file.bytes);
      for (const reference of ids) this.db.prepare("INSERT INTO activity_comment_documents(id,comment_id,project_document_id) VALUES (?,?,?)").run(randomUUID(), id, reference);
      const activity = this.db.prepare("SELECT kind,title,project_id,created_by FROM workspace_activity WHERE id=?").get(activityId)!;
      const participants = this.db.prepare("SELECT member_id FROM workspace_activity_responses WHERE activity_id=?").all(activityId).map(row => String(row.member_id));
      insertNotifications(this.db, { recipientIds: [String(activity.created_by), ...participants].filter(id => this.members.includes(id)), actorId: actor, kind: "activity_comment", projectId: activity.project_id ? String(activity.project_id) : null, commentId: id, message: `事项「${String(activity.title)}」有新批注：${input.body.slice(0, 120) || "新增讨论附件"}`, targetUrl: activityNotificationUrl(String(activity.kind), activityId), createdAt: now });
      const result = this.map(this.db.prepare("SELECT * FROM activity_comments WHERE id=?").get(id)!, actor);
      this.db.exec("COMMIT"); return result;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  delete(activityId: string, commentId: string, actor: string): ActivityComment {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.authorize(activityId, actor);
      const row = this.db.prepare("SELECT * FROM activity_comments WHERE id=? AND activity_id=?").get(commentId, activityId);
      if (!row) throw new Error("评论不存在。");
      if (!canDeleteComment(String(row.author_id), actor)) throw new Error("没有删除评论权限。");
      this.db.prepare("UPDATE activity_comments SET deleted_at=?,deleted_by=?,body='' WHERE id=? AND deleted_at IS NULL").run(new Date().toISOString(), actor, commentId);
      // Remove uploads and references so older releases cannot expose them after a rollback.
      this.db.prepare("DELETE FROM activity_comment_documents WHERE comment_id=?").run(commentId);
      this.db.prepare("DELETE FROM member_notifications WHERE comment_id=? AND kind='activity_comment'").run(commentId);
      const result = this.map(this.db.prepare("SELECT * FROM activity_comments WHERE id=?").get(commentId)!, actor);
      this.db.exec("COMMIT"); return result;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  readDocument(activityId: string, commentId: string, documentId: string, actor: string) {
    this.authorize(activityId, actor);
    const row = this.db.prepare(`SELECT d.* FROM activity_comment_documents d JOIN activity_comments c ON c.id=d.comment_id WHERE d.id=? AND c.id=? AND c.activity_id=? AND c.deleted_at IS NULL`).get(documentId, commentId, activityId);
    if (!row) throw new Error("事项讨论附件不存在。");
    if (row.project_document_id) {
      const source = this.db.prepare("SELECT project_id FROM project_documents WHERE id=?").get(String(row.project_document_id));
      if (!source) throw new Error("事项讨论附件不存在。");
      return readProjectDocument(this.db, String(source.project_id), String(row.project_document_id), this.options.storageRoot);
    }
    return { originalName: String(row.original_name), mediaType: String(row.media_type), kind: row.document_kind as ActivityDocumentKind, bytes: row.content as Uint8Array };
  }
  private map(row: Record<string, unknown>, actor: string): ActivityComment {
    const documents = row.deleted_at ? [] : this.db.prepare(`SELECT d.id,COALESCE(p.original_name,d.original_name) AS originalName,COALESCE(p.document_kind,d.document_kind) AS kind,
      COALESCE(p.byte_length,d.byte_length) AS byteLength,CASE WHEN d.project_document_id IS NULL THEN 'upload' ELSE 'project' END AS source,
      d.project_document_id AS projectDocumentId,p.project_id AS projectId,projects.name AS projectName
      FROM activity_comment_documents d LEFT JOIN project_documents p ON p.id=d.project_document_id LEFT JOIN projects ON projects.id=p.project_id
      WHERE d.comment_id=? ORDER BY d.rowid`).all(String(row.id));
    return { id: String(row.id), sequence: Number(row.seq), activityId: String(row.activity_id), parentId: row.parent_id ? String(row.parent_id) : null,
      authorId: String(row.author_id), body: row.deleted_at ? "" : String(row.body), deletedAt: row.deleted_at ? String(row.deleted_at) : null, canDelete: !row.deleted_at && canDeleteComment(String(row.author_id), actor), createdAt: String(row.created_at),
      documents: documents.map(document => ({ ...document, createdAt: String(row.created_at) })) as unknown as ActivityComment["documents"] };
  }
}
