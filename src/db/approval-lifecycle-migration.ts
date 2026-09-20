import type { DatabaseMigration } from "./migrations";

const attachmentTables = ["workspace_activity_responses", "workspace_activity_documents", "activity_project_documents"];
const unchangedColumns = ["id", "kind", "title", "description", "due_at", "location", "project_id", "created_by", "created_at", "idempotency_key", "input_json", "approval_type", "withdrawn_at", "completed_at", "archive_at"];
const closed = (reference: "OLD" | "NEW") => `EXISTS (SELECT 1 FROM workspace_activity WHERE id=${reference}.activity_id AND kind='approval' AND status<>'active')`;
const message = "该审批已撤回、完成或归档，不能再修改。";
const childTrigger = (table: string, operation: string) => ({
  name: `guard_closed_${table}_${operation.toLowerCase()}`,
  sql: `CREATE TRIGGER guard_closed_${table}_${operation.toLowerCase()} BEFORE ${operation} ON ${table}
    WHEN ${operation === "INSERT" ? closed("NEW") : operation === "DELETE" ? closed("OLD") : `(${closed("OLD")} OR ${closed("NEW")})`}
    BEGIN SELECT RAISE(ABORT,'${message}'); END;`,
});
const childTriggers = attachmentTables.flatMap(table => ["INSERT", "UPDATE", "DELETE"].map(operation => childTrigger(table, operation)));
export const closedActivityResponseUpdateTriggerSql = childTrigger("workspace_activity_responses", "UPDATE").sql;
export const closedWorkspaceActivityUpdateTriggerSql = (extraUnchangedColumns: readonly string[] = []) => `CREATE TRIGGER guard_closed_workspace_activity_update BEFORE UPDATE ON workspace_activity
      WHEN OLD.kind='approval' AND OLD.status<>'active' AND NOT COALESCE((
        OLD.status='completed' AND NEW.status='archived' AND OLD.archive_at IS NOT NULL AND OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL
        AND NEW.archived_at>=OLD.archive_at AND NEW.updated_at IS NEW.archived_at AND NEW.version=OLD.version+1
        AND ${[...unchangedColumns,...extraUnchangedColumns].map(column => `NEW.${column} IS OLD.${column}`).join(" AND ")}
      ),0) BEGIN SELECT RAISE(ABORT,'${message}'); END;`;

export const approvalLifecycleMigration: DatabaseMigration = {
  id: "0036_approval_lifecycle",
  upSql: `
    ALTER TABLE workspace_activity ADD COLUMN approval_type TEXT NOT NULL DEFAULT 'general' CHECK(approval_type IN ('general','reimbursement'));
    ALTER TABLE workspace_activity ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','withdrawn','completed','archived'));
    ALTER TABLE workspace_activity ADD COLUMN completed_at TEXT;
    ALTER TABLE workspace_activity ADD COLUMN withdrawn_at TEXT;
    ALTER TABLE workspace_activity ADD COLUMN archived_at TEXT;
    ALTER TABLE workspace_activity ADD COLUMN archive_at TEXT;
    CREATE INDEX idx_workspace_activity_archive_due ON workspace_activity(archive_at) WHERE kind='approval' AND status='completed';
    ${closedWorkspaceActivityUpdateTriggerSql()}
    CREATE TRIGGER guard_closed_workspace_activity_delete BEFORE DELETE ON workspace_activity
      WHEN OLD.kind='approval' AND OLD.status<>'active' BEGIN SELECT RAISE(ABORT,'${message}'); END;
    ${childTriggers.map(trigger => trigger.sql).join("\n")}
  `,
  downSql: `
    ${childTriggers.map(trigger => `DROP TRIGGER ${trigger.name};`).join("\n")}
    DROP TRIGGER guard_closed_workspace_activity_update;
    DROP TRIGGER guard_closed_workspace_activity_delete;
    DROP INDEX idx_workspace_activity_archive_due;
    ALTER TABLE workspace_activity DROP COLUMN archive_at;
    ALTER TABLE workspace_activity DROP COLUMN archived_at;
    ALTER TABLE workspace_activity DROP COLUMN withdrawn_at;
    ALTER TABLE workspace_activity DROP COLUMN completed_at;
    ALTER TABLE workspace_activity DROP COLUMN status;
    ALTER TABLE workspace_activity DROP COLUMN approval_type;
  `,
};
