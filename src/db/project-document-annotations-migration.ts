import type { DatabaseMigration } from "./migrations";

export const projectDocumentAnnotationsMigration: DatabaseMigration = {
  id: "0017_project_document_annotations",
  upSql: `
    CREATE TABLE project_document_annotations (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES project_documents(id),
      parent_id TEXT REFERENCES project_document_annotations(id),
      author_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      content TEXT NOT NULL CHECK(length(content) <= 10000),
      action TEXT NOT NULL CHECK(action IN ('comment','approve','request_changes')),
      created_at TEXT NOT NULL,
      CHECK(parent_id IS NULL OR action = 'comment'),
      CHECK(action = 'approve' OR length(trim(content)) > 0)
    );
    CREATE INDEX idx_project_document_annotations ON project_document_annotations(document_id, created_at);
    CREATE TABLE project_document_annotation_requests (
      actor_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      annotation_id TEXT NOT NULL REFERENCES project_document_annotations(id),
      payload_json TEXT NOT NULL,
      PRIMARY KEY(actor_id,idempotency_key)
    );
  `,
  downSql: "DROP TABLE IF EXISTS project_document_annotation_requests; DROP TABLE IF EXISTS project_document_annotations;",
};
