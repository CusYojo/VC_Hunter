export const activityProjectDocumentsMigration = {
  id: "0026_activity_project_documents",
  upSql: `CREATE TABLE activity_project_documents (
    id TEXT PRIMARY KEY, activity_id TEXT NOT NULL REFERENCES workspace_activity(id) ON DELETE CASCADE,
    project_document_id TEXT NOT NULL REFERENCES project_documents(id),
    added_by TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(activity_id,project_document_id)
  );
  CREATE INDEX idx_activity_project_documents ON activity_project_documents(activity_id,created_at);
  CREATE TABLE activity_attachment_requests (
    activity_id TEXT NOT NULL REFERENCES workspace_activity(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL, request_key TEXT NOT NULL, input_json TEXT NOT NULL,
    PRIMARY KEY(activity_id,actor_id,request_key)
  );`,
  downSql: "DROP TABLE IF EXISTS activity_attachment_requests; DROP TABLE IF EXISTS activity_project_documents;",
};
