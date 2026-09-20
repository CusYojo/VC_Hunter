import type { DatabaseMigration } from "./migrations";
import { closedActivityResponseUpdateTriggerSql } from "./approval-lifecycle-migration";

export const approvalViewStatusMigration: DatabaseMigration = {
  id: "0038_approval_view_status",
  upSql: `
    DROP TRIGGER guard_closed_workspace_activity_responses_update;
    ALTER TABLE workspace_activity_responses ADD COLUMN assigned_at TEXT;
    ALTER TABLE workspace_activity_responses ADD COLUMN viewed_at TEXT;
    UPDATE workspace_activity_responses SET assigned_at=(SELECT created_at FROM workspace_activity WHERE id=activity_id) WHERE assigned_at IS NULL;
    CREATE INDEX idx_workspace_activity_unviewed ON workspace_activity_responses(member_id,viewed_at,assigned_at);
    ${closedActivityResponseUpdateTriggerSql}
  `,
  downSql: `
    DROP TRIGGER guard_closed_workspace_activity_responses_update;
    DROP INDEX idx_workspace_activity_unviewed;
    ALTER TABLE workspace_activity_responses DROP COLUMN viewed_at;
    ALTER TABLE workspace_activity_responses DROP COLUMN assigned_at;
    ${closedActivityResponseUpdateTriggerSql}
  `,
};
