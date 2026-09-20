import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { loadTeamMembers } from "./team";

export type NotificationKind = "mention" | "milestone_assigned" | "project_assigned" | "task_assigned" | "activity_invited" | "approval_requested" | "approval_decided" | "activity_updated" | "activity_responded" | "activity_comment" | "project_comment" | "document_comment" | "document_reviewed" | "project_created" | "discovery_digest";
interface NotificationEvent {
  recipientIds: readonly string[];
  actorId: string;
  kind: NotificationKind;
  message: string;
  targetUrl: string;
  projectId?: string | null;
  milestoneId?: string | null;
  commentId?: string | null;
  createdAt: string;
}

/** The caller owns authorization, idempotency and the surrounding business transaction. */
export function insertNotifications(db: DatabaseSync, event: NotificationEvent): void {
  if (!event.targetUrl.startsWith("/") || event.targetUrl.startsWith("//")) throw new Error("通知跳转地址无效。");
  const recipients = [...new Set(event.recipientIds)].filter(id => id && id !== event.actorId);
  const insert = db.prepare("INSERT INTO member_notifications(id,recipient_id,actor_id,kind,project_id,milestone_id,comment_id,message,target_url,read_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,NULL,?)");
  for (const recipientId of recipients) insert.run(randomUUID(), recipientId, event.actorId, event.kind, event.projectId ?? null, event.milestoneId ?? null, event.commentId ?? null, event.message, event.targetUrl, event.createdAt);
}

export function activityNotificationUrl(kind: string, activityId: string): string {
  return `${kind === "approval" ? "/approvals" : "/work"}?activity=${encodeURIComponent(activityId)}`;
}

export function projectResponsibleIds(db: DatabaseSync, projectId: string, members: ReadonlyArray<{ id: string; name: string }> = loadTeamMembers()): string[] {
  const project = db.prepare("SELECT owner,owner_id FROM projects WHERE id=?").get(projectId);
  const rows = db.prepare("SELECT member_id,member_name FROM project_responsibles WHERE project_id=?").all(projectId);
  const references = [...rows.map(row => ({ id: row.member_id, name: row.member_name })), { id: project?.owner_id, name: project?.owner }];
  return [...new Set(references.flatMap(reference => {
    const member = members.find(member => member.id === reference.id) ?? members.find(member => member.name === reference.name);
    return member ? [member.id] : [];
  }))];
}

export function notifyProjectCreated(db: DatabaseSync, project: { id: string; name: string }, actorId: string, createdAt: string, members = loadTeamMembers()): void {
  insertNotifications(db, { recipientIds: members.map(member => member.id), actorId, kind: "project_created", projectId: project.id,
    message: `新项目「${project.name}」已正式入库`, targetUrl: `/projects/${encodeURIComponent(project.id)}`, createdAt });
}
