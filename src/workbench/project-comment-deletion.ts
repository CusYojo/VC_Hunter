import type { DatabaseSync } from "node:sqlite";
import { canDeleteComment } from "./comment-deletion";

/** Withdraw all public copies of a project's comment in one transaction. */
export function withdrawProjectComment(database: DatabaseSync, projectId: string, commentId: string, actorId: string): Record<string, string | number | null> {
  database.exec("BEGIN IMMEDIATE");
  try {
    if (!database.prepare("SELECT id FROM projects WHERE id=?").get(projectId)) throw new Error("项目不存在。");
    const row = database.prepare("SELECT * FROM project_comments WHERE id=? AND project_id=?").get(commentId, projectId);
    if (!row) throw new Error("评论不存在。");
    if (!canDeleteComment(String(row.author_id), actorId)) throw new Error("没有删除评论权限。");
    database.prepare("UPDATE project_comments SET deleted_at=?,deleted_by=?,body='',mentions_json='[]' WHERE id=? AND deleted_at IS NULL").run(new Date().toISOString(), actorId, commentId);
    database.prepare("DELETE FROM member_notifications WHERE comment_id=? AND kind IN ('mention','project_comment')").run(commentId);
    database.prepare("UPDATE platform_timeline SET summary='评论已删除',metadata_json='{}' WHERE subject_type='project_comment' AND subject_id=?").run(commentId);
    const result = database.prepare("SELECT * FROM project_comments WHERE id=?").get(commentId)!;
    database.exec("COMMIT"); return result as Record<string, string | number | null>;
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}
