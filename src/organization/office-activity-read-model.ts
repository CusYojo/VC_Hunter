import { meetingLifecycleSql } from "@/workbench/meeting-completion";
import type { DatabaseSync } from "node:sqlite";
import { activityNotificationUrl } from "@/workbench/notifications";
import type { OfficeActivity, OfficeActor, OfficeMeeting, OfficeQueue, OfficeTodo } from "./office-contracts";

type Row = Record<string, unknown>;
const str = (value: unknown) => String(value ?? "");
const terminal = (action: unknown) => ["done", "approved", "declined", "returned", "change_requested"].includes(str(action));
const unique = (ids: string[]) => [...new Set(ids)];

function currentActivities(activities: Row[], responses: Row[], actor: OfficeActor, activeIds: Set<string>, now: Date) {
  const responsesByActivity = new Map<string, Row[]>();
  for (const row of responses) responsesByActivity.set(str(row.activity_id), [...(responsesByActivity.get(str(row.activity_id)) ?? []), row]);
  const todos: OfficeTodo[] = [], queues: OfficeQueue[] = [], meetings: OfficeMeeting[] = [];
  for (const row of activities) {
    const id = str(row.id), creatorId = str(row.created_by), kind = str(row.kind);
    if (kind === "meeting" && row.lifecycle === "meeting_completed") continue;
    if (kind === "approval" && row.status !== "active") continue;
    const participants = responsesByActivity.get(id) ?? [];
    if (!actor.canManage && creatorId !== actor.memberId && !participants.some(item => item.member_id === actor.memberId)) continue;
    const pending = participants.filter(item => activeIds.has(str(item.member_id)) && !terminal(item.action));
    const awaitingCompletion = kind === "approval" && participants.length > 0 && participants.every(item => item.action === "approved");
    const needsCreator = activeIds.has(creatorId) && (awaitingCompletion || participants.length === 0 || participants.some(item => item.action === "change_requested"));
    const memberIds = unique([...pending.map(item => str(item.member_id)), ...(needsCreator ? [creatorId] : [])]);
    const targetUrl = activityNotificationUrl(kind, id);
    if (memberIds.length) todos.push({ id, kind, title: awaitingCompletion ? `审批已通过 · 待申请方完成：${str(row.title)}` : str(row.title), memberIds, dueAt: row.due_at ? str(row.due_at) : null, targetUrl });
    if (kind === "approval" && activeIds.has(creatorId)) {
      for (const recipient of pending.filter(item => item.action === "pending" && item.member_id !== creatorId)) {
        const toMemberId = str(recipient.member_id);
        queues.push({ id: `approval:${id}:${toMemberId}`, kind: "approval", title: str(row.title), fromMemberId: creatorId, toMemberId, targetUrl, createdAt: str(row.created_at) });
      }
    }
    const startsAt = Date.parse(str(row.due_at));
    if (kind !== "meeting" || !pending.length || !Number.isFinite(startsAt) || startsAt > now.getTime()) continue;
    const creatorResponse = participants.find(item => item.member_id === creatorId);
    const creatorAttends = activeIds.has(creatorId) && (!creatorResponse || !terminal(creatorResponse.action));
    meetings.push({ id, title: str(row.title), memberIds: unique([...(creatorAttends ? [creatorId] : []), ...pending.map(item => str(item.member_id))]), startsAt: new Date(startsAt).toISOString(), targetUrl, version: Number(row.version), canEnd: creatorId === actor.memberId || actor.canManage });
  }
  return { todos: todos.slice(0, 100), queues, meetings };
}

/** Only metadata from extant entities is projected; notification messages contain private excerpts. */
function commentQueues(db: DatabaseSync, actor: OfficeActor, activeIds: Set<string>): OfficeQueue[] {
  const rows = db.prepare(`
    SELECT n.id AS id,n.kind,n.actor_id,n.recipient_id,n.comment_id,n.created_at AS created_at,c.activity_id AS entity_id,a.kind AS activity_kind
      FROM member_notifications n JOIN activity_comments c ON c.id=n.comment_id AND c.author_id=n.actor_id
      JOIN workspace_activity a ON a.id=c.activity_id
      WHERE n.kind='activity_comment' AND (a.kind!='approval' OR a.status='active') AND c.deleted_at IS NULL AND n.read_at IS NULL AND (? OR n.recipient_id=?)
      AND (a.created_by=n.recipient_id OR EXISTS (SELECT 1 FROM workspace_activity_responses r WHERE r.activity_id=a.id AND r.member_id=n.recipient_id))
      AND (a.created_by=n.actor_id OR EXISTS (SELECT 1 FROM workspace_activity_responses r WHERE r.activity_id=a.id AND r.member_id=n.actor_id))
    UNION ALL
    SELECT n.id AS id,n.kind,n.actor_id,n.recipient_id,n.comment_id,n.created_at AS created_at,c.project_id AS entity_id,NULL AS activity_kind
      FROM member_notifications n JOIN project_comments c ON c.id=n.comment_id AND c.author_id=n.actor_id AND c.project_id=n.project_id
      JOIN projects p ON p.id=c.project_id
      WHERE n.kind IN ('project_comment','mention') AND c.deleted_at IS NULL AND n.read_at IS NULL AND (? OR n.recipient_id=?)
    UNION ALL
    SELECT n.id AS id,n.kind,n.actor_id,n.recipient_id,n.comment_id,n.created_at AS created_at,d.project_id AS entity_id,NULL AS activity_kind
      FROM member_notifications n JOIN project_document_annotations c ON c.id=n.comment_id AND c.author_id=n.actor_id AND c.action='comment'
      JOIN project_documents d ON d.id=c.document_id AND d.project_id=n.project_id JOIN projects p ON p.id=d.project_id
      WHERE n.kind='document_comment' AND c.deleted_at IS NULL AND n.read_at IS NULL AND (? OR n.recipient_id=?)
    ORDER BY created_at,id
  `).all(Number(actor.canManage), actor.memberId, Number(actor.canManage), actor.memberId, Number(actor.canManage), actor.memberId);
  const queues = new Map<string, OfficeQueue>();
  for (const row of rows) {
    const fromMemberId = str(row.actor_id), toMemberId = str(row.recipient_id);
    if (fromMemberId === toMemberId || !activeIds.has(fromMemberId) || !activeIds.has(toMemberId)) continue;
    const kind = row.kind === "mention" ? "project_comment" : row.kind;
    const id = `comment:${kind}:${row.comment_id}:${toMemberId}`;
    if (queues.has(id)) continue;
    const isActivity = row.kind === "activity_comment";
    queues.set(id, { id, kind: "comment", title: isActivity ? "事项批注待查看" : kind === "project_comment" ? "项目批注待查看" : "资料批注待查看", fromMemberId, toMemberId,
      targetUrl: isActivity ? activityNotificationUrl(str(row.activity_kind), str(row.entity_id)) : `/projects/${encodeURIComponent(str(row.entity_id))}`, createdAt: str(row.created_at) });
  }
  return [...queues.values()];
}

export function readOfficeActivity(db: DatabaseSync, actor: OfficeActor, activeMemberIds: readonly string[], now = new Date()): OfficeActivity {
  const activeIds = new Set(activeMemberIds);
  const activities = db.prepare(`SELECT a.id,a.kind,a.title,a.created_by,a.due_at,a.created_at,a.version,a.status,${meetingLifecycleSql} AS lifecycle FROM workspace_activity a WHERE a.deleted_at IS NULL ORDER BY CASE WHEN a.due_at IS NULL OR a.due_at='' THEN 1 ELSE 0 END,a.due_at,a.created_at,a.id`).all();
  const responses = db.prepare("SELECT activity_id,member_id,action FROM workspace_activity_responses ORDER BY activity_id,member_id").all();
  const activity = currentActivities(activities, responses, actor, activeIds, now);
  return { ...activity, queues: [...activity.queues, ...commentQueues(db, actor, activeIds)].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)) };
}
