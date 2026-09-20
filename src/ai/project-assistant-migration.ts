export const projectAssistantMigration = {
  id: "0023_project_assistant",
  upSql: `CREATE TABLE project_assistant_runs (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id), request_key TEXT NOT NULL, payload_hash TEXT NOT NULL,
    prompt TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed')),
    output TEXT NOT NULL DEFAULT '', error TEXT, provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
    sources_json TEXT NOT NULL DEFAULT '[]', warnings_json TEXT NOT NULL DEFAULT '[]', usage_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(tenant_id,account_id,project_id,request_key)
  );
  CREATE UNIQUE INDEX idx_project_assistant_active_account ON project_assistant_runs(tenant_id,account_id) WHERE status='running';
  CREATE INDEX idx_project_assistant_history ON project_assistant_runs(tenant_id,account_id,project_id,created_at DESC);`,
  downSql: "DROP TABLE IF EXISTS project_assistant_runs;",
};
