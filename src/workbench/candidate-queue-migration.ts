export const candidateQueueMigration = {
  id: "0028_candidate_queue",
  upSql: `ALTER TABLE project_candidates ADD COLUMN archived_at TEXT;
  ALTER TABLE project_candidates ADD COLUMN archive_reason TEXT;
  ALTER TABLE project_candidates ADD COLUMN queue_rank INTEGER NOT NULL DEFAULT 1000000;
  CREATE INDEX idx_candidate_queue_archive ON project_candidates(status,archived_at,created_at);
  CREATE TABLE candidate_queue_order_requests (
    tenant_id TEXT NOT NULL, account_id TEXT NOT NULL, request_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(tenant_id,account_id,request_key)
  );`,
  downSql: `DROP TABLE IF EXISTS candidate_queue_order_requests;
  DROP INDEX IF EXISTS idx_candidate_queue_archive;
  ALTER TABLE project_candidates DROP COLUMN queue_rank;
  ALTER TABLE project_candidates DROP COLUMN archive_reason;
  ALTER TABLE project_candidates DROP COLUMN archived_at;`,
};
