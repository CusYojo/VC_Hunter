import { closedWorkspaceActivityUpdateTriggerSql } from "@/db/approval-lifecycle-migration";
import type { DatabaseMigration } from "@/db/migrations";

export const taskLifecycleMigration: DatabaseMigration = {
  id: "0042_workspace_task_archive_delete",
  upSql: `
    DROP TRIGGER guard_closed_workspace_activity_update;
    ALTER TABLE workspace_activity ADD COLUMN deleted_at TEXT;
    CREATE INDEX idx_workspace_activity_deleted ON workspace_activity(deleted_at);
    ${closedWorkspaceActivityUpdateTriggerSql(["end_at", "deleted_at"])}
  `,
  downSql: `
    DROP TRIGGER guard_closed_workspace_activity_update;
    DROP INDEX idx_workspace_activity_deleted;
    ALTER TABLE workspace_activity DROP COLUMN deleted_at;
    ${closedWorkspaceActivityUpdateTriggerSql(["end_at"])}
  `,
};
