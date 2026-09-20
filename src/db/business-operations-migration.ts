import type { DatabaseMigration } from "./migrations";
export const businessOperationsMigration: DatabaseMigration = {
  id: "0019_business_operations",
  upSql: `CREATE TABLE business_operation_records (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, kind TEXT NOT NULL,
    name TEXT NOT NULL, status TEXT NOT NULL, data_json TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL, updated_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_business_operation_tenant_kind ON business_operation_records(tenant_id,kind,archived,updated_at);
  CREATE TABLE business_operation_requests (tenant_id TEXT NOT NULL,actor_id TEXT NOT NULL,request_key TEXT NOT NULL,payload_json TEXT NOT NULL,record_id TEXT NOT NULL REFERENCES business_operation_records(id),PRIMARY KEY(tenant_id,actor_id,request_key));
  CREATE TABLE business_operation_audit (id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,record_id TEXT NOT NULL REFERENCES business_operation_records(id),actor_id TEXT NOT NULL,action TEXT NOT NULL,before_json TEXT,after_json TEXT NOT NULL,created_at TEXT NOT NULL);`,
  downSql: "DROP TABLE business_operation_audit; DROP TABLE business_operation_requests; DROP TABLE business_operation_records;",
};
