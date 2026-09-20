export const activityCommentsMigration = {
  id: "0031_activity_comments",
  upSql: `CREATE TABLE activity_comments (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    activity_id TEXT NOT NULL REFERENCES workspace_activity(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES activity_comments(id),
    author_id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    request_key TEXT NOT NULL,
    input_json TEXT NOT NULL,
    UNIQUE(activity_id,author_id,request_key),
    UNIQUE(id,activity_id),
    FOREIGN KEY(parent_id,activity_id) REFERENCES activity_comments(id,activity_id)
  );
  CREATE INDEX idx_activity_comments_page ON activity_comments(activity_id,seq);
  CREATE TABLE activity_comment_documents (
    id TEXT PRIMARY KEY,
    comment_id TEXT NOT NULL REFERENCES activity_comments(id) ON DELETE CASCADE,
    project_document_id TEXT REFERENCES project_documents(id),
    original_name TEXT,
    media_type TEXT,
    document_kind TEXT,
    byte_length INTEGER,
    content BLOB,
    CHECK ((project_document_id IS NOT NULL AND content IS NULL) OR
      (project_document_id IS NULL AND content IS NOT NULL AND original_name IS NOT NULL AND media_type IS NOT NULL AND document_kind IS NOT NULL AND byte_length > 0))
  );
  CREATE INDEX idx_activity_comment_documents ON activity_comment_documents(comment_id);`,
  downSql: "DROP TABLE IF EXISTS activity_comment_documents; DROP TABLE IF EXISTS activity_comments;",
};
