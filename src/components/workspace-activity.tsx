import { WorkspaceActivityBoard } from "./workspace-activity-board";
import { activityRepository } from "@/workbench/activity-http";
import { getAppRepository } from "@/db/app";
import { getCurrentTenantId, loadTeamMembers } from "@/workbench/team";
import { requirePageUser } from "@/security/page-auth";

export async function WorkspaceActivity({ compact = false, onlyKind, mode = "all" }: { compact?: boolean; onlyKind?: "approval"; mode?: "all" | "tasks" | "calendar" }) {
  const user = await requirePageUser();
  return <WorkspaceActivityBoard initial={activityRepository().list(user.id)} currentUserId={user.id} recentScopeKey={`${getCurrentTenantId()}:${user.id}`} members={loadTeamMembers().map(({ id, name, departmentId, departmentName }) => ({ id, name, departmentId, departmentName }))} projectOptions={getAppRepository().list().map(({ id, name }) => ({ id, name }))} compact={compact} onlyKind={onlyKind} mode={mode} />;
}
