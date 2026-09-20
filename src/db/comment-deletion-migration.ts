import type { DatabaseMigration } from "./migrations";

/** Keep reply anchors and audit records while withdrawing public comment content. */
export const commentDeletionMigration: DatabaseMigration = {
  id: "0035_comment_deletion",
  upSql: `
    ALTER TABLE activity_comments ADD COLUMN deleted_at TEXT;
    ALTER TABLE activity_comments ADD COLUMN deleted_by TEXT;
    ALTER TABLE project_comments ADD COLUMN deleted_at TEXT;
    ALTER TABLE project_comments ADD COLUMN deleted_by TEXT;
    ALTER TABLE project_document_annotations ADD COLUMN deleted_at TEXT;
    ALTER TABLE project_document_annotations ADD COLUMN deleted_by TEXT;
  `,
  downSql: `
    ALTER TABLE project_document_annotations DROP COLUMN deleted_by;
    ALTER TABLE project_document_annotations DROP COLUMN deleted_at;
    ALTER TABLE project_comments DROP COLUMN deleted_by;
    ALTER TABLE project_comments DROP COLUMN deleted_at;
    ALTER TABLE activity_comments DROP COLUMN deleted_by;
    ALTER TABLE activity_comments DROP COLUMN deleted_at;
  `,
};
