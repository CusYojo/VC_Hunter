import type { DatabaseMigration } from "./migrations";

export const aiWorkspaceMigration: DatabaseMigration = {
  id: "0020_ai_workspace",
  upSql: `CREATE TABLE personal_ai_runs (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT NOT NULL,
    request_key TEXT NOT NULL, payload_hash TEXT NOT NULL, prompt TEXT NOT NULL,
    context TEXT NOT NULL, skill TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed')),
    output TEXT NOT NULL DEFAULT '', error TEXT, usage_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(tenant_id,account_id,request_key)
  );
  CREATE INDEX personal_ai_runs_owner ON personal_ai_runs(tenant_id,account_id,created_at);
  CREATE UNIQUE INDEX personal_ai_runs_one_running ON personal_ai_runs(tenant_id,account_id) WHERE status='running';
  CREATE TABLE personal_ai_templates (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT NOT NULL,
    name TEXT NOT NULL, instructions TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );`,
  downSql: "DROP TABLE IF EXISTS personal_ai_templates; DROP TABLE IF EXISTS personal_ai_runs;",
};
