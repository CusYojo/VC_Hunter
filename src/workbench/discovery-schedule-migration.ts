export const discoveryScheduleMigration = {
  id: "0029_discovery_schedule",
  upSql: `CREATE TABLE discovery_schedule_settings (
    id TEXT PRIMARY KEY CHECK(id='organization'), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
    version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, updated_by TEXT
  );
  CREATE TABLE discovery_schedule_audit (
    id TEXT PRIMARY KEY, actor_account_id TEXT NOT NULL, previous_enabled INTEGER NOT NULL,
    enabled INTEGER NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL
  );`,
  downSql: "DROP TABLE IF EXISTS discovery_schedule_audit; DROP TABLE IF EXISTS discovery_schedule_settings;",
};
