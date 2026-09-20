import type { DatabaseMigration } from "./migrations";

export const workspaceActivityDocumentsMigration: DatabaseMigration = {
  id: "0016_workspace_activity_documents",
  upSql: `
    CREATE TABLE workspace_activity_documents (
      id TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL REFERENCES workspace_activity(id),
      original_name TEXT NOT NULL,
      media_type TEXT NOT NULL,
      document_kind TEXT NOT NULL CHECK(document_kind IN ('pdf','docx','text','markdown')),
      byte_length INTEGER NOT NULL CHECK(byte_length > 0 AND byte_length <= 20971520),
      content BLOB NOT NULL,
      uploaded_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      input_json TEXT NOT NULL,
      UNIQUE(activity_id,uploaded_by,idempotency_key)
    );
    CREATE INDEX idx_workspace_activity_documents ON workspace_activity_documents(activity_id,created_at,id);
  `,
  downSql: "DROP TABLE workspace_activity_documents;",
};

export const workspaceActivityMigration: DatabaseMigration = {
  id: "0014_workspace_activity",
  upSql: `
    CREATE TABLE workspace_activity (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('task','meeting','trip','approval')),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      due_at TEXT NOT NULL,
      location TEXT NOT NULL,
      project_id TEXT REFERENCES projects(id),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      idempotency_key TEXT NOT NULL,
      input_json TEXT NOT NULL,
      UNIQUE(created_by, idempotency_key)
    );
    CREATE TABLE workspace_activity_responses (
      activity_id TEXT NOT NULL REFERENCES workspace_activity(id),
      member_id TEXT NOT NULL,
      action TEXT NOT NULL DEFAULT 'pending',
      note TEXT NOT NULL DEFAULT '',
      responded_at TEXT,
      PRIMARY KEY(activity_id, member_id)
    );
    CREATE TABLE workspace_activity_audit (
      id TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL REFERENCES workspace_activity(id),
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_workspace_activity_due ON workspace_activity(due_at, created_by);
    CREATE INDEX idx_workspace_activity_inbox ON workspace_activity_responses(member_id, action);
  `,
  downSql: "DROP TABLE workspace_activity_audit; DROP TABLE workspace_activity_responses; DROP TABLE workspace_activity;",
};
