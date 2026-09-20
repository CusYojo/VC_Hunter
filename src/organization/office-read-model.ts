import { meetingLifecycleSql } from "@/workbench/meeting-completion";
import { readOfficeActivity } from "./office-activity-read-model";
import type { DatabaseSync } from "node:sqlite";
import type { PublicDirectory } from "./contracts";
import type { OfficeActor, OfficeDepartment, OfficeGroup, OfficeMember, OfficeProfile, OfficeProject, OfficeSeat, OfficeStyle, OfficeTask, OfficeUpdate, OfficeWorkspace } from "./office-contracts";

type Row = Record<string, unknown>;
export const defaultOfficeStyle = (): OfficeStyle => ({ version: 1, deskColor: "#b98758", deskShape: "classic", avatarUrl: null });
export const defaultOfficeProfile = (): OfficeProfile => ({ version: 1, groupingMode: "department", displayedProjectId: null, description: "", presenceStatus: "office", customStatus: "" });
const str = (value: unknown) => String(value ?? "");
const nullable = (value: unknown) => value == null || value === "" ? null : String(value);
function indexRows(rows: Row[], key: string): Map<string, Row[]> {
  return rows.reduce((index, row) => index.set(str(row[key]), [...(index.get(str(row[key])) ?? []), row]), new Map<string, Row[]>());
}

function projectData(db: DatabaseSync) {
  const milestones = db.prepare("SELECT project_id,owner_id,status,title,updated_at FROM project_milestones").all();
  const updates = db.prepare("SELECT project_id,summary,created_at FROM platform_timeline WHERE project_id IS NOT NULL ORDER BY created_at DESC,id DESC").all();
  const nodesByProject = indexRows(milestones, "project_id"), updatesByProject = indexRows(updates, "project_id");
  const projects = db.prepare("SELECT id,name,status AS stage,latest_event_at FROM projects ORDER BY name,id").all().map((row): OfficeProject => {
    const nodes = nodesByProject.get(str(row.id)) ?? [];
    const latest = updatesByProject.get(str(row.id))?.[0];
    const node = [...nodes].sort((a, b) => str(b.updated_at).localeCompare(str(a.updated_at)))[0];
    const candidates: OfficeUpdate[] = [
      ...(latest ? [{ title: str(latest.summary), at: str(latest.created_at) }] : []),
      ...(node ? [{ title: str(node.title), at: str(node.updated_at) }] : []),
    ];
    return { id: str(row.id), name: str(row.name), stage: str(row.stage), role: "协作", progress: { done: nodes.filter(node => node.status === "done").length, total: nodes.length }, latestUpdate: candidates.sort((a, b) => b.at.localeCompare(a.at))[0] ?? null };
  });
  return { projects, milestones };
}

function taskSummaries(db: DatabaseSync, actor: OfficeActor, members: PublicDirectory["members"]) {
  const activities = db.prepare(`SELECT a.id,a.kind,a.title,a.project_id,a.created_by,a.due_at,a.created_at,a.status,${meetingLifecycleSql} AS lifecycle FROM workspace_activity a WHERE a.deleted_at IS NULL ORDER BY a.created_at DESC,a.id DESC`).all();
  const responses = db.prepare("SELECT activity_id,member_id,action FROM workspace_activity_responses").all();
  const responsesByActivity = indexRows(responses, "activity_id");
  const visible = activities.filter(row => actor.canManage || row.created_by === actor.memberId || responsesByActivity.get(str(row.id))?.some(response => response.member_id === actor.memberId));
  const tasks = new Map<string, OfficeTask[]>();
  const finished = (action: unknown) => ["done", "approved", "declined", "returned"].includes(str(action));
  for (const member of members) {
    const items = visible.flatMap((row): OfficeTask[] => {
      if (row.kind === "meeting" && row.lifecycle === "meeting_completed") return [];
      if (row.kind === "approval" && row.status !== "active") return [];
      const participants = responsesByActivity.get(str(row.id)) ?? [];
      const awaitingCompletion = row.kind === "approval" && participants.length > 0 && participants.every(response => response.action === "approved");
      if (awaitingCompletion) return row.created_by === member.id ? [{ id: str(row.id), title: `审批已通过 · 待申请方完成：${str(row.title)}`, kind: "approval", action: "created", dueAt: nullable(row.due_at), projectId: nullable(row.project_id) }] : [];
      if (participants.length && participants.every(response => finished(response.action))) return [];
      const response = participants.find(item => item.member_id === member.id);
      if (!response && row.created_by !== member.id) return [];
      const action = response ? str(response.action) : "created";
      if (finished(action)) return [];
      return [{ id: str(row.id), title: str(row.title), kind: str(row.kind), action, dueAt: nullable(row.due_at), projectId: nullable(row.project_id) }];
    });
    tasks.set(member.id, items.slice(0, 20));
  }
  return { tasks, activities, responses };
}

function departmentsFor(db: DatabaseSync, tenantId: string, directory: PublicDirectory): OfficeDepartment[] {
  const settings = db.prepare("SELECT department_id,grouping_mode FROM office_department_settings WHERE tenant_id=?").all(tenantId);
  return directory.departments.map(department => {
    const setting = settings.find(row => row.department_id === department.id);
    return { id: department.id, name: department.name, groupingMode: setting?.grouping_mode === "project" ? "project" : "department" };
  });
}

function styleFor(row: Row | undefined): OfficeStyle {
  if (!row) return defaultOfficeStyle();
  return { version: Number(row.version), deskColor: str(row.desk_color), deskShape: row.desk_shape as OfficeStyle["deskShape"], avatarUrl: row.avatar_id ? `/api/v1/organization/office/avatars/${encodeURIComponent(str(row.avatar_id))}` : null };
}

function profileFor(row: Row | undefined): OfficeProfile {
  if (!row) return defaultOfficeProfile();
  return {
    version: Number(row.version), groupingMode: row.grouping_mode === "project" ? "project" : "department",
    displayedProjectId: nullable(row.displayed_project_id), description: str(row.description),
    presenceStatus: ["office", "away", "trip", "custom"].includes(str(row.presence_status)) ? str(row.presence_status) as OfficeProfile["presenceStatus"] : "office",
    customStatus: str(row.custom_status),
  };
}

function groupsFor(members: OfficeMember[], departments: OfficeDepartment[], groupingMode: OfficeProfile["groupingMode"]): OfficeGroup[] {
  const groups = new Map<string, OfficeGroup>();
  for (const member of members) {
    const department = departments.find(item => item.id === member.departmentId);
    const displayed = member.projects.find(project => project.id === member.profile.displayedProjectId) ?? member.projects[0];
    const projectMode = groupingMode === "project";
    const selected: OfficeGroup[] = projectMode && displayed ? [{ id: `project:${displayed.id}`, label: displayed.name, kind: "project", projectId: displayed.id, departmentId: null, stage: displayed.stage, progress: displayed.progress, latestUpdate: displayed.latestUpdate, seats: [] }] : [{ id: `department:${department?.id ?? "unassigned"}`, label: department?.name ?? "未分组", kind: "department", projectId: null, departmentId: department?.id ?? null, stage: null, progress: { done: 0, total: 0 }, latestUpdate: null, seats: [] }];
    for (const selectedGroup of selected) {
      const previous = groups.get(selectedGroup.id) ?? selectedGroup;
      const index = previous.seats.length;
      groups.set(previous.id, { ...previous, seats: [...previous.seats, { memberId: member.id, x: index % 4, y: Math.floor(index / 4) }] });
    }
  }
  return [...groups.values()].map(group => {
    if (group.kind === "project") return group;
    const projects = [...new Map(members.filter(member => group.seats.some(seat => seat.memberId === member.id)).flatMap(member => member.projects).map(project => [project.id, project])).values()];
    return { ...group, progress: { done: projects.reduce((sum, project) => sum + project.progress.done, 0), total: projects.reduce((sum, project) => sum + project.progress.total, 0) }, latestUpdate: projects.flatMap(project => project.latestUpdate ? [project.latestUpdate] : []).sort((a, b) => b.at.localeCompare(a.at))[0] ?? null };
  }).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "department" ? -1 : 1;
    if (a.kind === "department") return departments.findIndex(item => item.id === a.departmentId) - departments.findIndex(item => item.id === b.departmentId);
    return a.label.localeCompare(b.label, "zh-CN");
  });
}

function positionedSeats(group: OfficeGroup, saved: Row[]): OfficeSeat[] {
  const positions = new Map<string, Row>();
  const occupied = new Set<string>();
  for (const seat of group.seats) {
    const candidate = saved.find(row => row.group_id === group.id && row.member_id === seat.memberId);
    if (!candidate || occupied.has(`${candidate.x}:${candidate.y}`)) continue;
    positions.set(seat.memberId, candidate); occupied.add(`${candidate.x}:${candidate.y}`);
  }
  const columns = Math.max(4, Math.ceil(group.seats.length / 128));
  let cursor = 0;
  return group.seats.map(seat => {
    const existing = positions.get(seat.memberId);
    if (existing) return { memberId: seat.memberId, x: Number(existing.x), y: Number(existing.y) };
    while (occupied.has(`${cursor % columns}:${Math.floor(cursor / columns)}`)) cursor += 1;
    const next = { memberId: seat.memberId, x: cursor % columns, y: Math.floor(cursor / columns) };
    occupied.add(`${next.x}:${next.y}`); cursor += 1;
    return next;
  });
}

function projectRoles(active: PublicDirectory["members"], responsibles: Row[], milestones: Row[], activities: Row[], responses: Row[]) {
  const roles = new Map(active.map(member => [member.id, new Map<string, string>()]));
  const uniqueNames = new Map(active.filter(member => active.filter(other => other.name === member.name).length === 1).map(member => [member.name, member.id]));
  const assign = (memberId: string, projectId: string, role: string) => {
    const current = roles.get(memberId);
    if (current && projectId && !current.has(projectId)) current.set(projectId, role);
  };
  for (const row of responsibles) assign(row.member_id == null ? uniqueNames.get(str(row.member_name)) ?? "" : str(row.member_id), str(row.project_id), "负责人");
  for (const row of milestones) assign(str(row.owner_id), str(row.project_id), "节点负责");
  const activityProjects = new Map(activities.map(row => [str(row.id), str(row.project_id)]));
  for (const row of responses) assign(str(row.member_id), activityProjects.get(str(row.activity_id)) ?? "", "协作");
  return roles;
}

export function readOfficeWorkspace(db: DatabaseSync, actor: OfficeActor, directory: PublicDirectory, now = new Date()): OfficeWorkspace {
  const active = directory.members.filter(member => member.active && !member.isPlaceholder);
  const departments = departmentsFor(db, actor.tenantId, directory);
  const { projects, milestones } = projectData(db);
  const responsibles = db.prepare("SELECT project_id,member_id,member_name FROM project_responsibles").all();
  const { tasks, activities, responses } = taskSummaries(db, actor, active);
  const roles = projectRoles(active, responsibles, milestones, activities, responses);
  const styles = db.prepare(`SELECT s.*,a.id AS avatar_id FROM office_member_styles s LEFT JOIN office_avatar_submissions a
    ON a.id=s.approved_avatar_id AND a.tenant_id=s.tenant_id AND a.member_id=s.member_id AND a.status='approved' WHERE s.tenant_id=?`).all(actor.tenantId);
  const profiles = db.prepare("SELECT * FROM office_member_profiles WHERE tenant_id=?").all(actor.tenantId);
  const members: OfficeMember[] = active.map(member => {
    const membership = roles.get(member.id)!;
    return { id: member.id, name: member.name, title: member.title, departmentId: member.departmentId, departmentName: departments.find(item => item.id === member.departmentId)?.name ?? "未分组", groupIds: [], style: styleFor(styles.find(row => row.member_id === member.id)), profile: profileFor(profiles.find(row => row.member_id === member.id)), projects: projects.filter(project => membership.has(project.id)).map(project => ({ ...project, role: membership.get(project.id)! })), tasks: tasks.get(member.id) ?? [] };
  });
  const groupingMode = members.find(member => member.id === actor.memberId)?.profile.groupingMode ?? "department";
  const saved = db.prepare("SELECT group_id,member_id,x,y FROM office_seats WHERE tenant_id=?").all(actor.tenantId);
  const groups = groupsFor(members, departments, groupingMode).map(group => ({ ...group, seats: positionedSeats(group, saved) }));
  const row = db.prepare("SELECT version FROM office_layouts WHERE tenant_id=?").get(actor.tenantId);
  return { selfMemberId: actor.memberId, canManage: actor.canManage, layoutVersion: row ? Number(row.version) : 1, groupingMode, departments, members: members.map(member => ({ ...member, groupIds: groups.filter(group => group.seats.some(seat => seat.memberId === member.id)).map(group => group.id) })), groups, activity: readOfficeActivity(db, actor, active.map(member => member.id), now) };
}
