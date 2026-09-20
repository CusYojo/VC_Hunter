export const businessOperationDocumentsMigration = {
  id: "0027_business_operation_documents",
  upSql: `CREATE TABLE business_operation_documents (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
    record_id TEXT NOT NULL REFERENCES business_operation_records(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL, document_kind TEXT NOT NULL CHECK(document_kind IN ('pdf','docx','text','markdown')),
    media_type TEXT NOT NULL, byte_length INTEGER NOT NULL CHECK(byte_length>0 AND byte_length<=20971520),
    sha256 TEXT NOT NULL, content BLOB NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE INDEX idx_operation_documents_record ON business_operation_documents(tenant_id,record_id,created_at);
  CREATE TABLE business_operation_update_requests (
    tenant_id TEXT NOT NULL, actor_id TEXT NOT NULL, request_key TEXT NOT NULL,
    payload_json TEXT NOT NULL, record_id TEXT NOT NULL REFERENCES business_operation_records(id),
    result_json TEXT NOT NULL, PRIMARY KEY(tenant_id,actor_id,request_key)
  );`,
  downSql: "DROP TABLE IF EXISTS business_operation_update_requests; DROP TABLE IF EXISTS business_operation_documents;",
};
