import type { DatabaseMigration } from "./migrations";

export const notificationsMigration: DatabaseMigration = {
  id: "0033_business_notifications",
  upSql: `
    CREATE TABLE member_notifications_expanded (
      id TEXT PRIMARY KEY, recipient_id TEXT NOT NULL, actor_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('mention','milestone_assigned','project_assigned','task_assigned','activity_invited','approval_requested','approval_decided','activity_updated','activity_responded','activity_comment','project_comment','document_comment','document_reviewed','project_created')),
      project_id TEXT REFERENCES projects(id), milestone_id TEXT, comment_id TEXT,
      message TEXT NOT NULL, target_url TEXT NOT NULL DEFAULT '/work', read_at TEXT, created_at TEXT NOT NULL
    );
    INSERT INTO member_notifications_expanded (id,recipient_id,actor_id,kind,project_id,milestone_id,comment_id,message,target_url,read_at,created_at)
      SELECT id,recipient_id,actor_id,kind,project_id,milestone_id,comment_id,message,
        CASE WHEN project_id IS NOT NULL THEN '/projects/' || project_id ELSE '/work' END,read_at,created_at FROM member_notifications;
    DROP TABLE member_notifications;
    ALTER TABLE member_notifications_expanded RENAME TO member_notifications;
    CREATE INDEX idx_member_notifications_inbox ON member_notifications(recipient_id,read_at,created_at);
  `,
  downSql: `
    CREATE TABLE member_notifications_legacy (
      id TEXT PRIMARY KEY, recipient_id TEXT NOT NULL, actor_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('mention','milestone_assigned')),
      project_id TEXT REFERENCES projects(id), milestone_id TEXT, comment_id TEXT,
      message TEXT NOT NULL, read_at TEXT, created_at TEXT NOT NULL
    );
    INSERT INTO member_notifications_legacy SELECT id,recipient_id,actor_id,kind,project_id,milestone_id,comment_id,message,read_at,created_at FROM member_notifications WHERE kind IN ('mention','milestone_assigned');
    DROP TABLE member_notifications;
    ALTER TABLE member_notifications_legacy RENAME TO member_notifications;
    CREATE INDEX idx_member_notifications_inbox ON member_notifications(recipient_id,read_at,created_at);
  `,
};
