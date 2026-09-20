import { closedWorkspaceActivityUpdateTriggerSql } from "@/db/approval-lifecycle-migration";

export const activityCalendarMigration = {
  id: "0037_workspace_activity_end_at",
  upSql: `
    DROP TRIGGER guard_closed_workspace_activity_update;
    ALTER TABLE workspace_activity ADD COLUMN end_at TEXT;
    ${closedWorkspaceActivityUpdateTriggerSql(["end_at"])}
  `,
  downSql: `
    DROP TRIGGER guard_closed_workspace_activity_update;
    ALTER TABLE workspace_activity DROP COLUMN end_at;
    ${closedWorkspaceActivityUpdateTriggerSql()}
  `,
};
