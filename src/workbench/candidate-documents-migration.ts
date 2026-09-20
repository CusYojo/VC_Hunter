export const candidateDocumentsMigration = {
  id: "0022_candidate_documents",
  upSql: `CREATE TABLE candidate_documents (
    candidate_id TEXT PRIMARY KEY REFERENCES project_candidates(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL, media_type TEXT NOT NULL, document_kind TEXT NOT NULL,
    byte_length INTEGER NOT NULL CHECK(byte_length>0 AND byte_length<=20971520), bytes BLOB NOT NULL,
    created_by TEXT NOT NULL, created_at TEXT NOT NULL
  );`,
  downSql: "DROP TABLE IF EXISTS candidate_documents;",
};
