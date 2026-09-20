import { withdrawProjectComment } from "./project-comment-deletion";
import { canDeleteComment } from "./comment-deletion";
import { identityScope } from "@/security/identity-scope";
import { insertNotifications, projectResponsibleIds, type NotificationKind } from "./notifications";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { MilestoneAttachmentInput, MilestoneInput, MilestoneStatus, MilestoneUpdateInput, ProjectCommentInput, TeamMember } from "./contracts";
import { milestoneAttachmentInputSchema, milestoneInputSchema, milestoneUpdateSchema, projectCommentInputSchema } from "./contracts";
import { autoAdvanceDealStage, projectStatusForDealStage, stageLabel } from "./deal-stages";

/**
 * 项目推进时间表：阶段 → 里程碑（小节点）→ 结论 / 文件 / 批注。
 *
 * 批注中的 `@成员名` 会解析为团队成员并生成提醒；里程碑指派负责人也会生成提醒。
 * 所有写操作都记入 `platform_timeline`，保证项目统一时间线可回溯。
 */

type Row = Record<string, string | number | null>;

export interface MilestoneAttachmentView { id: string; milestoneId: string; title: string; uri: string | null; documentId: string | null; note: string; createdBy: string; createdAt: string }
export interface ProjectCommentView { deletedAt?: string | null; canDelete?: boolean; id: string; projectId: string; milestoneId: string | null; authorId: string; authorName: string; body: string; mentions: Array<{ id: string; name: string }>; createdAt: string }
export interface MilestoneView {
  id: string; projectId: string; stage: string; stageLabel: string; title: string; kind: string; status: MilestoneStatus;
  plannedAt: string | null; occurredAt: string | null; ownerId: string | null; ownerName: string | null; conclusion: string;
  sortOrder: number; version: number; createdBy: string; createdAt: string; updatedAt: string;
  attachments: MilestoneAttachmentView[]; comments: ProjectCommentView[];
  projectProgress?: ProjectProgressSnapshot;
}
export interface NotificationView { id: string; recipientId: string; actorId: string; actorName: string; kind: NotificationKind; targetUrl: string; projectId: string | null; projectName: string | null; milestoneId: string | null; commentId: string | null; message: string; readAt: string | null; createdAt: string }

interface ProjectProgressSnapshot { status: string; dealStage: string; dealStageLabel: string; version: number }

const MENTION_PREFIX = "@";

export class SqliteDealTimelineRepository {
  constructor(readonly database: DatabaseSync, private readonly members: readonly TeamMember[]) {}

  listMilestones(projectId: string): MilestoneView[] {
    const rows = this.database.prepare("SELECT * FROM project_milestones WHERE project_id=? ORDER BY sort_order ASC, COALESCE(planned_at, occurred_at, created_at) ASC, created_at ASC").all(projectId) as unknown as Row[];
    const attachments = this.attachmentsFor(projectId);
    const comments = this.listComments(projectId);
    return rows.map((row) => this.mapMilestone(row, attachments.filter((item) => item.milestoneId === row.id), comments.filter((item) => item.milestoneId === row.id)));
  }

  findMilestone(projectId: string, milestoneId: string): MilestoneView | undefined {
    const row = this.database.prepare("SELECT * FROM project_milestones WHERE id=? AND project_id=?").get(milestoneId, projectId) as unknown as Row | undefined;
    if (!row) return undefined;
    return this.mapMilestone(row, this.attachmentsFor(projectId).filter((item) => item.milestoneId === milestoneId), this.listComments(projectId).filter((item) => item.milestoneId === milestoneId));
  }

  createMilestone(projectId: string, rawInput: MilestoneInput, idempotencyKey: string, actorId: string): MilestoneView {
    requireIdempotencyKey(idempotencyKey);
    const input = milestoneInputSchema.parse(rawInput);
    this.assertProject(projectId);
    const prior = this.priorResult(actorId, idempotencyKey);
    if (prior) return { ...this.findMilestone(projectId, prior)!, projectProgress: this.readProjectProgress(projectId) };
    if (input.ownerId) this.assertMember(input.ownerId);
    const now = new Date().toISOString();
    const id = randomUUID();
    const nextOrder = Number((this.database.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM project_milestones WHERE project_id=? AND stage=?").get(projectId, input.stage) as { next: number }).next);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`INSERT INTO project_milestones
        (id,project_id,stage,title,kind,status,planned_at,occurred_at,owner_id,conclusion,sort_order,version,created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`).run(id, projectId, input.stage, input.title, input.kind, input.status, input.plannedAt, input.occurredAt, input.ownerId, input.conclusion, nextOrder, actorId, now, now);
      this.recordIdempotency(actorId, idempotencyKey, "milestone.create", id, input, now);
      const projectProgress = this.syncProjectProgress(projectId, { stage: input.stage, status: input.status }, now);
      this.insertTimeline("milestone.created", "project_milestone", id, projectId, actorId, `新增推进节点：${stageLabel(input.stage)} · ${input.title}`, { stage: input.stage, status: input.status, projectProgress }, idempotencyKey, now);
      if (input.ownerId && input.ownerId !== actorId) this.insertNotification(input.ownerId, actorId, "milestone_assigned", projectId, id, null, `${this.memberName(actorId)} 将节点「${input.title}」指派给你`, now);
      this.database.exec("COMMIT");
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
    return { ...this.findMilestone(projectId, id)!, projectProgress: this.readProjectProgress(projectId) };
  }

  updateMilestone(projectId: string, milestoneId: string, rawInput: MilestoneUpdateInput, idempotencyKey: string, actorId: string): MilestoneView {
    requireIdempotencyKey(idempotencyKey);
    const input = milestoneUpdateSchema.parse(rawInput);
    const current = this.findMilestone(projectId, milestoneId);
    if (!current) throw new Error("推进节点不存在。");
    const prior = this.priorResult(actorId, idempotencyKey);
    if (prior) return { ...this.findMilestone(projectId, prior)!, projectProgress: this.readProjectProgress(projectId) };
    if (current.version !== input.expectedVersion) throw new Error("版本冲突：节点已发生变化。");
    if (input.ownerId) this.assertMember(input.ownerId);
    const now = new Date().toISOString();
    const next = {
      stage: input.stage ?? current.stage, title: input.title ?? current.title, kind: input.kind ?? current.kind, status: input.status ?? current.status,
      plannedAt: input.plannedAt === undefined ? current.plannedAt : input.plannedAt, occurredAt: input.occurredAt === undefined ? current.occurredAt : input.occurredAt,
      ownerId: input.ownerId === undefined ? current.ownerId : input.ownerId, conclusion: input.conclusion ?? current.conclusion, sortOrder: input.sortOrder ?? current.sortOrder,
    };
    if (next.status === "done" && !next.occurredAt) next.occurredAt = now.slice(0, 10);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = this.database.prepare(`UPDATE project_milestones SET stage=?,title=?,kind=?,status=?,planned_at=?,occurred_at=?,owner_id=?,conclusion=?,sort_order=?,version=version+1,updated_at=?
        WHERE id=? AND project_id=? AND version=?`).run(next.stage, next.title, next.kind, next.status, next.plannedAt, next.occurredAt, next.ownerId, next.conclusion, next.sortOrder, now, milestoneId, projectId, input.expectedVersion);
      if (Number(result.changes) !== 1) throw new Error("版本冲突：节点已发生变化。");
      this.recordIdempotency(actorId, idempotencyKey, "milestone.update", milestoneId, input, now);
      const changed = summarizeChange(current, next);
      const projectProgress = this.syncProjectProgress(projectId, { stage: next.stage, status: next.status }, now);
      this.insertTimeline("milestone.updated", "project_milestone", milestoneId, projectId, actorId, `更新推进节点：${next.title}${changed ? `（${changed}）` : ""}`, { stage: next.stage, status: next.status, projectProgress }, idempotencyKey, now);
      if (next.ownerId && next.ownerId !== current.ownerId && next.ownerId !== actorId) this.insertNotification(next.ownerId, actorId, "milestone_assigned", projectId, milestoneId, null, `${this.memberName(actorId)} 将节点「${next.title}」指派给你`, now);
      this.database.exec("COMMIT");
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
    return { ...this.findMilestone(projectId, milestoneId)!, projectProgress: this.readProjectProgress(projectId) };
  }

  addAttachment(projectId: string, milestoneId: string, rawInput: MilestoneAttachmentInput, idempotencyKey: string, actorId: string): MilestoneAttachmentView {
    requireIdempotencyKey(idempotencyKey);
    const input = milestoneAttachmentInputSchema.parse(rawInput);
    if (!this.findMilestone(projectId, milestoneId)) throw new Error("推进节点不存在。");
    if (!input.uri && !input.documentId) throw new Error("附件必须提供链接或已上传资料 id。");
    if (input.documentId && !this.database.prepare("SELECT 1 FROM project_documents WHERE id=? AND project_id=?").get(input.documentId, projectId)) throw new Error("关联资料不存在。");
    const prior = this.priorResult(actorId, idempotencyKey);
    if (prior) return this.attachmentsFor(projectId).find((item) => item.id === prior)!;
    const now = new Date().toISOString();
    const id = randomUUID();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("INSERT INTO project_milestone_attachments (id,milestone_id,project_id,title,uri,document_id,note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(id, milestoneId, projectId, input.title, input.uri, input.documentId, input.note, actorId, now);
      this.recordIdempotency(actorId, idempotencyKey, "milestone.attachment", id, input, now);
      this.insertTimeline("milestone.attachment_added", "project_milestone_attachment", id, projectId, actorId, `节点附件：${input.title}`, { milestoneId }, idempotencyKey, now);
      this.database.exec("COMMIT");
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
    return this.attachmentsFor(projectId).find((item) => item.id === id)!;
  }

  listComments(projectId: string): ProjectCommentView[] {
    const rows = this.database.prepare("SELECT * FROM project_comments WHERE project_id=? ORDER BY created_at ASC, id ASC").all(projectId) as unknown as Row[];
    return rows.map((row) => this.mapComment(row));
  }

  addComment(projectId: string, rawInput: ProjectCommentInput, idempotencyKey: string, actorId: string): ProjectCommentView {
    requireIdempotencyKey(idempotencyKey);
    const input = projectCommentInputSchema.parse(rawInput);
    this.assertProject(projectId);
    if (input.milestoneId && !this.findMilestone(projectId, input.milestoneId)) throw new Error("推进节点不存在。");
    const duplicate = this.database.prepare("SELECT * FROM project_comments WHERE author_id=? AND idempotency_key=?").get(actorId, idempotencyKey) as unknown as Row | undefined;
    if (duplicate) return this.mapComment(duplicate, actorId);
    const mentions = this.parseMentions(input.body);
    const now = new Date().toISOString();
    const id = randomUUID();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("INSERT INTO project_comments (id,project_id,milestone_id,author_id,body,mentions_json,idempotency_key,created_at) VALUES (?,?,?,?,?,?,?,?)").run(id, projectId, input.milestoneId, actorId, input.body, JSON.stringify(mentions.map((member) => member.id)), idempotencyKey, now);
      const excerpt = input.body.length > 60 ? `${input.body.slice(0, 60)}…` : input.body;
      for (const member of mentions) {
        if (member.id === actorId) continue;
        this.insertNotification(member.id, actorId, "mention", projectId, input.milestoneId, id, `${this.memberName(actorId)} 在批注中提到你：${excerpt}`, now);
      }
      const participants = this.database.prepare("SELECT DISTINCT author_id FROM project_comments WHERE project_id=?").all(projectId).map(row => String(row.author_id));
      const milestoneOwner = input.milestoneId ? this.findMilestone(projectId, input.milestoneId)?.ownerId : null;
      const notified = new Set(mentions.map(member => member.id));
      insertNotifications(this.database, { recipientIds: [...projectResponsibleIds(this.database, projectId, this.members), ...participants, ...(milestoneOwner ? [milestoneOwner] : [])].filter(id => !notified.has(id) && this.members.some(member => member.id === id)), actorId, kind: "project_comment", projectId, milestoneId: input.milestoneId, commentId: id, message: `${this.memberName(actorId)} 发表了项目批注：${excerpt}`, targetUrl: `/projects/${encodeURIComponent(projectId)}`, createdAt: now });
      this.insertTimeline("comment.added", "project_comment", id, projectId, actorId, `批注：${excerpt}`, { milestoneId: input.milestoneId, mentions: mentions.map((member) => member.id) }, idempotencyKey, now);
      this.database.exec("COMMIT");
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
    return this.mapComment(this.database.prepare("SELECT * FROM project_comments WHERE id=?").get(id) as unknown as Row, actorId);
  }

  deleteComment(projectId: string, commentId: string, actorId: string): ProjectCommentView {
    return this.mapComment(withdrawProjectComment(this.database, projectId, commentId, actorId), actorId);
  }

  listNotifications(recipientId: string, options: { unreadOnly?: boolean; limit?: number } = {}): NotificationView[] {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const rows = this.database.prepare(`SELECT n.*, p.name AS project_name FROM member_notifications n LEFT JOIN projects p ON p.id = n.project_id
      WHERE n.recipient_id=? ${options.unreadOnly ? "AND n.read_at IS NULL" : ""} ORDER BY n.created_at DESC, n.id DESC LIMIT ?`).all(recipientId, limit) as unknown as Row[];
    return rows.map((row) => this.mapNotification(row));
  }

  private mapNotification(row: Row): NotificationView {
    return {
      id: String(row.id), recipientId: String(row.recipient_id), actorId: String(row.actor_id), actorName: this.memberName(String(row.actor_id)),
      kind: String(row.kind) as NotificationView["kind"], projectId: row.project_id ? String(row.project_id) : null, projectName: row.project_name ? String(row.project_name) : null,
      milestoneId: row.milestone_id ? String(row.milestone_id) : null, commentId: row.comment_id ? String(row.comment_id) : null,
      targetUrl: String(row.target_url), message: String(row.message), readAt: row.read_at ? String(row.read_at) : null, createdAt: String(row.created_at),
    };
  }

  countUnread(recipientId: string): number {
    return Number((this.database.prepare("SELECT count(*) AS count FROM member_notifications WHERE recipient_id=? AND read_at IS NULL").get(recipientId) as { count: number }).count);
  }

  markNotification(recipientId: string, notificationId: string, read: boolean): NotificationView {
    const result = this.database.prepare("UPDATE member_notifications SET read_at=? WHERE id=? AND recipient_id=?").run(read ? new Date().toISOString() : null, notificationId, recipientId);
    if (Number(result.changes) !== 1) throw new Error("提醒不存在。");
    const row = this.database.prepare(`SELECT n.*, p.name AS project_name FROM member_notifications n LEFT JOIN projects p ON p.id = n.project_id WHERE n.id=? AND n.recipient_id=?`).get(notificationId, recipientId) as unknown as Row;
    return this.mapNotification(row);
  }

  markAllNotificationsRead(recipientId: string, before: string): { updated: number } {
    const timestamp = new Date(before);
    if (!Number.isFinite(timestamp.getTime())) throw new Error("通知截止时间无效。");
    const result = this.database.prepare("UPDATE member_notifications SET read_at=? WHERE recipient_id=? AND read_at IS NULL AND created_at<=?")
      .run(new Date().toISOString(), recipientId, timestamp.toISOString());
    return { updated: Number(result.changes) };
  }

  /** 识别 `@成员名`；成员名可能包含在更长的字符串里，因此按名称长度倒序匹配避免前缀误伤。 */
  parseMentions(body: string): Array<{ id: string; name: string }> {
    const candidates = [...this.members].sort((left, right) => right.name.length - left.name.length);
    const found: Array<{ id: string; name: string }> = [];
    for (const member of candidates) {
      if (body.includes(`${MENTION_PREFIX}${member.name}`) && !found.some((item) => item.id === member.id)) found.push({ id: member.id, name: member.name });
    }
    return found;
  }

  private mapMilestone(row: Row, attachments: MilestoneAttachmentView[], comments: ProjectCommentView[]): MilestoneView {
    const ownerId = row.owner_id ? String(row.owner_id) : null;
    return {
      id: String(row.id), projectId: String(row.project_id), stage: String(row.stage), stageLabel: stageLabel(String(row.stage)), title: String(row.title), kind: String(row.kind),
      status: String(row.status) as MilestoneStatus, plannedAt: row.planned_at ? String(row.planned_at) : null, occurredAt: row.occurred_at ? String(row.occurred_at) : null,
      ownerId, ownerName: ownerId ? this.memberName(ownerId) : null, conclusion: String(row.conclusion ?? ""), sortOrder: Number(row.sort_order), version: Number(row.version),
      createdBy: String(row.created_by), createdAt: String(row.created_at), updatedAt: String(row.updated_at), attachments, comments,
    };
  }

  private mapComment(row: Row, actorId = identityScope.getStore()?.user.id): ProjectCommentView {
    const mentionIds = row.deleted_at ? [] : JSON.parse(String(row.mentions_json ?? "[]")) as string[];
    return {
      id: String(row.id), projectId: String(row.project_id), milestoneId: row.milestone_id ? String(row.milestone_id) : null, authorId: String(row.author_id), authorName: this.memberName(String(row.author_id)),
      body: row.deleted_at ? "" : String(row.body), deletedAt: row.deleted_at ? String(row.deleted_at) : null, canDelete: !row.deleted_at && canDeleteComment(String(row.author_id), actorId), mentions: mentionIds.map((id) => ({ id, name: this.memberName(id) })), createdAt: String(row.created_at),
    };
  }

  private attachmentsFor(projectId: string): MilestoneAttachmentView[] {
    const rows = this.database.prepare("SELECT * FROM project_milestone_attachments WHERE project_id=? ORDER BY created_at ASC").all(projectId) as unknown as Row[];
    return rows.map((row) => ({ id: String(row.id), milestoneId: String(row.milestone_id), title: String(row.title), uri: row.uri ? String(row.uri) : null, documentId: row.document_id ? String(row.document_id) : null, note: String(row.note ?? ""), createdBy: String(row.created_by), createdAt: String(row.created_at) }));
  }

  private memberName(id: string): string { return this.members.find((member) => member.id === id)?.name ?? id; }
  private assertMember(id: string): void { if (!this.members.some((member) => member.id === id)) throw new Error("负责人不是团队成员。"); }
  private assertProject(projectId: string): void { if (!this.database.prepare("SELECT 1 FROM projects WHERE id=?").get(projectId)) throw new Error("项目不存在。"); }
  private priorResult(actorId: string, key: string): string | undefined {
    const row = this.database.prepare("SELECT resource_id FROM workbench_idempotency WHERE actor_id=? AND idempotency_key=?").get(actorId, key) as { resource_id: string } | undefined;
    return row?.resource_id;
  }
  private recordIdempotency(actorId: string, key: string, action: string, resourceId: string, payload: unknown, now: string): void {
    this.database.prepare("INSERT INTO workbench_idempotency (actor_id,idempotency_key,action,resource_id,payload_json,created_at) VALUES (?,?,?,?,?,?)").run(actorId, key, action, resourceId, JSON.stringify(payload), now);
  }
  private syncProjectProgress(projectId: string, milestone: { stage: string; status: string }, now: string): { before: ProjectProgressSnapshot; after: ProjectProgressSnapshot } {
    const row = this.database.prepare("SELECT status,deal_stage,version FROM projects WHERE id=?").get(projectId) as { status: string; deal_stage: string; version: number } | undefined;
    if (!row) throw new Error("项目不存在。");
    const before = { status: row.status, dealStage: row.deal_stage, dealStageLabel: stageLabel(row.deal_stage), version: Number(row.version) };
    if (row.status === "pass" || milestone.status === "cancelled") return { before, after: before };
    const stage = autoAdvanceDealStage(row.deal_stage, milestone.stage);
    const advanced = stage !== row.deal_stage;
    if (!advanced) return { before, after: before };
    const after = {
      status: projectStatusForDealStage(stage, row.status),
      dealStage: stage,
      dealStageLabel: stageLabel(stage),
      version: before.version + 1,
    };
    const result = this.database.prepare("UPDATE projects SET status=?,deal_stage=?,version=version+1,latest_event_at=? WHERE id=? AND version=?")
      .run(after.status, after.dealStage, now, projectId, before.version);
    if (Number(result.changes) !== 1) throw new Error("版本冲突：项目已发生变化。");
    return { before, after };
  }
  private readProjectProgress(projectId: string): ProjectProgressSnapshot {
    const row = this.database.prepare("SELECT status,deal_stage,version FROM projects WHERE id=?").get(projectId) as { status: string; deal_stage: string; version: number } | undefined;
    if (!row) throw new Error("项目不存在。");
    return { status: row.status, dealStage: row.deal_stage, dealStageLabel: stageLabel(row.deal_stage), version: Number(row.version) };
  }
  private insertTimeline(eventType: string, subjectType: string, subjectId: string, projectId: string, actor: string, summary: string, metadata: unknown, traceId: string, now: string): void {
    this.database.prepare("INSERT INTO platform_timeline (id,event_type,subject_type,subject_id,project_id,actor,summary,metadata_json,trace_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(randomUUID(), eventType, subjectType, subjectId, projectId, actor, summary, JSON.stringify(metadata), traceId, now);
  }
  private insertNotification(recipientId: string, actorId: string, kind: NotificationView["kind"], projectId: string, milestoneId: string | null, commentId: string | null, message: string, now: string): void {
    insertNotifications(this.database, { recipientIds: [recipientId], actorId, kind, projectId, milestoneId, commentId, message, targetUrl: `/projects/${encodeURIComponent(projectId)}`, createdAt: now });
  }
}

function summarizeChange(before: MilestoneView, after: { status: MilestoneStatus; ownerId: string | null; conclusion: string; occurredAt: string | null }): string {
  const parts: string[] = [];
  if (before.status !== after.status) parts.push(`状态 ${before.status} → ${after.status}`);
  if (before.ownerId !== after.ownerId) parts.push("负责人变更");
  if (before.conclusion !== after.conclusion) parts.push("结论更新");
  if (before.occurredAt !== after.occurredAt) parts.push("实际时间更新");
  return parts.join("，");
}

function requireIdempotencyKey(key: string): void { if (!key.trim()) throw new Error("写操作必须提供 Idempotency-Key。"); }
