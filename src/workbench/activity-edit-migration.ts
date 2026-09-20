export const activityEditMigration = {
  id: "0032_activity_edit",
  upSql: `ALTER TABLE workspace_activity ADD COLUMN updated_at TEXT;
  CREATE TABLE workspace_activity_edit_requests (
    activity_id TEXT NOT NULL REFERENCES workspace_activity(id),
    actor_id TEXT NOT NULL, request_key TEXT NOT NULL, input_json TEXT NOT NULL,
    result_json TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(activity_id,actor_id,request_key)
  );`,
  downSql: `DROP TABLE workspace_activity_edit_requests;
  ALTER TABLE workspace_activity DROP COLUMN updated_at;`,
};
