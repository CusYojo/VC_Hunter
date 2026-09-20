import { archiveDueApprovals, assertActivityActive, transitionApproval, ApprovalLifecycleError } from "@/workbench/approval-lifecycle";
import { isMeetingCompleted } from "@/workbench/meeting-completion";
import { activityNotificationUrl, insertNotifications } from "@/workbench/notifications";
import { z } from "zod";
import { readProjectDocument } from "@/workbench/project-document-content";
import { activityDocuments, assertAttachmentsMutable, filePayload, insertActivityFile, insertProjectFileReferences, prepareActivityFiles, validateProjectFileReferences, type ActivityFile } from "@/workbench/activity-attachment-store";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { activityEditSchema, activityInputSchema, activityResponseSchema, type WorkspaceActivity } from "@/workbench/activity-contracts";
import { type ProjectDocumentKind } from "@/workbench/document-policy";
import { transitionTask } from "@/workbench/task-lifecycle";

export interface ActivityDocumentUpload {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
  expectedVersion: number;
}

export class WorkspaceActivityRepository {
  constructor(private readonly database: DatabaseSync, private readonly members: readonly string[], private readonly options: { storageRoot?: string } = {}) {}

  list(actorId: string, options: { status?: "all" | "current" | "withdrawn" | "archived"; activityId?: string } = {}): WorkspaceActivity[] {
    archiveDueApprovals(this.database);
    const rows = this.database.prepare(`SELECT DISTINCT a.* FROM workspace_activity a
      LEFT JOIN workspace_activity_responses r ON r.activity_id=a.id
      WHERE a.deleted_at IS NULL AND (a.created_by=? OR r.member_id=?) AND (? IS NULL OR a.id=?)
        AND (?='all' OR (?='current' AND a.status IN ('active','completed')) OR a.status=?)
      ORDER BY CASE a.status WHEN 'active' THEN 0 WHEN 'completed' THEN 1 WHEN 'withdrawn' THEN 2 ELSE 3 END, (a.due_at=''),a.due_at,a.id LIMIT 300`)
      .all(actorId, actorId, options.activityId ?? null, options.activityId ?? null, options.status ?? 'all', options.status ?? 'all', options.status ?? 'all');
    return rows.map((row) => this.map(row));
  }

  create(raw: unknown, actorId: string, key: string, files: readonly ActivityFile[] = []): WorkspaceActivity {
    const input = activityInputSchema.parse(raw);
    if (input.approvalType && input.kind !== "approval") throw new ApprovalLifecycleError(400, "INVALID_OPERATION", "只有审批可以选择报销类型。");
    if (!key.trim() || key.length > 200) throw new Error("幂等键无效。");
    if (!this.members.includes(actorId) || input.participantIds.some((id) => !this.members.includes(id))) throw new Error("成员不存在。");
    const participants = [...new Set(input.participantIds)].sort();
    if (input.kind === "approval" && participants.includes(actorId)) throw new Error("审批人不能包含申请人。");
    if (input.projectId && !this.database.prepare("SELECT 1 FROM projects WHERE id=?").get(input.projectId)) throw new Error("项目不存在。");
    const preparedFiles = prepareActivityFiles(files);
    const { projectDocumentIds: rawIds, approvalType, ...legacyInput } = input;
    const projectDocumentIds = [...new Set(rawIds)].sort();
    const payload = JSON.stringify({ ...legacyInput, ...(approvalType === "reimbursement" ? { approvalType } : {}), participantIds: participants, ...(projectDocumentIds.length ? { projectDocumentIds } : {}), ...(preparedFiles.length ? { files: preparedFiles.map(filePayload) } : {}) });
    return this.transaction(() => {
      const existing = this.database.prepare("SELECT * FROM workspace_activity WHERE created_by=? AND idempotency_key=?").get(actorId, key);
      if (existing) {
        if (existing.input_json !== payload) throw new Error("幂等键已用于其他内容。");
        return this.map(existing);
      }
      validateProjectFileReferences(this.database, projectDocumentIds);
      const id = randomUUID(), now = new Date().toISOString();
      this.database.prepare(`INSERT INTO workspace_activity
        (id,kind,title,description,due_at,end_at,location,project_id,created_by,created_at,idempotency_key,input_json,approval_type)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, input.kind, input.title, input.description, input.dueAt ?? "", input.endAt, input.location, input.projectId, actorId, now, key, payload, approvalType ?? "general");
      for (const member of participants) this.database.prepare("INSERT INTO workspace_activity_responses(activity_id,member_id,assigned_at) VALUES (?,?,?)").run(id, member, now);
      preparedFiles.forEach(file => insertActivityFile(this.database, id, file, actorId, `initial:${randomUUID()}`, now));
      insertProjectFileReferences(this.database, id, projectDocumentIds, actorId, now);
      this.audit(id, actorId, "created", input.description, now);
      insertNotifications(this.database, { recipientIds: participants, actorId, kind: input.kind === "approval" ? "approval_requested" : input.kind === "task" ? "task_assigned" : "activity_invited", projectId: input.projectId, message: input.kind === "approval" ? `你有新的${approvalType === "reimbursement" ? "报销审批" : "审批"}待处理：「${input.title}」` : input.kind === "task" ? `你被分配了新任务：「${input.title}」` : `你有新的${input.kind === "meeting" ? "会议" : "出差"}安排：「${input.title}」`, targetUrl: activityNotificationUrl(input.kind, id), createdAt: now });
      if (preparedFiles.length || projectDocumentIds.length) this.audit(id, actorId, "documents_attached", `上传 ${preparedFiles.length} 份，引用项目资料 ${projectDocumentIds.length} 份`, now);
      return this.map(this.database.prepare("SELECT * FROM workspace_activity WHERE id=?").get(id)!);
    });
  }

  edit(id: string, raw: unknown, actorId: string, key: string): WorkspaceActivity {
    const parsed = activityEditSchema.parse(raw);
    if (parsed.approvalType && parsed.kind !== "approval") throw new ApprovalLifecycleError(400, "INVALID_OPERATION", "只有审批可以选择报销类型。");
    if (!key.trim() || key.length > 200) throw new Error("幂等键无效。");
    return this.transaction(() => {
      const row = this.database.prepare("SELECT * FROM workspace_activity WHERE id=?").get(id);
      if (!row || row.created_by !== actorId || !this.members.includes(actorId)) throw new Error("没有编辑此事项的权限。");
      assertActivityActive(row);
      const { approvalType: requestedType, ...legacyParsed } = parsed;
      const approvalType = parsed.kind === "approval" ? requestedType ?? String(row.approval_type ?? "general") : "general";
      const input = { ...legacyParsed, ...(approvalType === "reimbursement" ? { approvalType } : {}), participantIds: [...new Set(parsed.participantIds)].sort() };
      const payload = JSON.stringify(input);
      const prior = this.database.prepare("SELECT input_json,result_json FROM workspace_activity_edit_requests WHERE activity_id=? AND actor_id=? AND request_key=?").get(id, actorId, key);
      if (prior) {
        if (prior.input_json !== payload) throw new Error("幂等键已用于其他内容。");
        return JSON.parse(String(prior.result_json)) as WorkspaceActivity;
      }
      if (Number(row.version) !== input.expectedVersion) throw new Error("版本冲突：请刷新后重试。");
      if (input.participantIds.some(member => !this.members.includes(member))) throw new Error("成员不存在。");
      if (input.kind === "approval" && input.participantIds.includes(actorId)) throw new Error("审批人不能包含申请人。");
      if (input.projectId && !this.database.prepare("SELECT 1 FROM projects WHERE id=?").get(input.projectId)) throw new Error("项目不存在。");
      const before = this.map(row);
      const fields = { approvalType, kind: input.kind, title: input.title, description: input.description, participantIds: input.participantIds, dueAt: input.dueAt, endAt: input.endAt, location: input.location, projectId: input.projectId };
      const original = { approvalType: before.approvalType ?? "general", kind: before.kind, title: before.title, description: before.description, participantIds: before.responses.map(response => response.memberId).sort(), dueAt: before.dueAt, endAt: before.endAt ?? null, location: before.location, projectId: before.projectId };
      const changed = Object.keys(original).some(field => JSON.stringify(original[field as keyof typeof original]) !== JSON.stringify(fields[field as keyof typeof fields]));
      const now = new Date().toISOString();
      if (changed) {
        const nextParticipants = new Set(input.participantIds);
        const removedParticipants = before.responses.map(response => response.memberId).filter(memberId => !nextParticipants.has(memberId));
        const obsoleteRecipients = before.kind === input.kind ? removedParticipants : before.responses.map(response => response.memberId);
        const closeObsoleteNotification = this.database.prepare("UPDATE member_notifications SET read_at=? WHERE recipient_id=? AND target_url=? AND kind IN ('task_assigned','activity_invited','approval_requested','activity_updated') AND read_at IS NULL");
        for (const memberId of obsoleteRecipients) closeObsoleteNotification.run(now, memberId, activityNotificationUrl(before.kind, id));
        this.database.prepare("UPDATE workspace_activity SET kind=?,title=?,description=?,due_at=?,end_at=?,location=?,project_id=?,approval_type=?,updated_at=?,version=version+1 WHERE id=? AND version=?").run(input.kind,input.title,input.description,input.dueAt ?? "",input.endAt,input.location,input.projectId,approvalType,now,id,input.expectedVersion);
        this.database.prepare("DELETE FROM workspace_activity_responses WHERE activity_id=?").run(id);
        for (const member of input.participantIds) this.database.prepare("INSERT INTO workspace_activity_responses(activity_id,member_id,assigned_at) VALUES (?,?,?)").run(id,member,now);
        this.audit(id,actorId,"edited",JSON.stringify({ before: original, after: fields, previousResponses: before.responses, responseReset: true }),now);
        insertNotifications(this.database, { recipientIds: input.participantIds, actorId, kind: "activity_updated", projectId: input.projectId, message: `${input.kind === "approval" && approvalType === "reimbursement" ? "报销审批" : "事项"}「${input.title}」已更新，请重新${input.kind === "approval" ? "审批" : "确认"}`, targetUrl: activityNotificationUrl(input.kind, id), createdAt: now });
      }
      const result = changed ? this.map(this.database.prepare("SELECT * FROM workspace_activity WHERE id=?").get(id)!) : before;
      this.database.prepare("INSERT INTO workspace_activity_edit_requests(activity_id,actor_id,request_key,input_json,result_json,created_at) VALUES (?,?,?,?,?,?)").run(id,actorId,key,payload,JSON.stringify(result),now);
      return result;
    });
  }

  respond(id: string, raw: unknown, actorId: string): WorkspaceActivity {
    const input = activityResponseSchema.parse(raw);
    return this.transaction(() => {
      const row = this.database.prepare("SELECT * FROM workspace_activity WHERE id=?").get(id);
      const recipient = this.database.prepare("SELECT * FROM workspace_activity_responses WHERE activity_id=? AND member_id=?").get(id, actorId);
      if (!row || !recipient || !this.members.includes(actorId)) throw new Error("没有处理此事项的权限。");
      assertActivityActive(row);
      if (Number(row.version) !== input.expectedVersion) throw new Error("版本冲突：请刷新后重试。");
      const allowed = row.kind === "approval" ? ["approved", "returned"] : row.kind === "task" ? ["accepted", "declined", "change_requested", "done"] : ["accepted", "declined", "change_requested"];
      if (!allowed.includes(input.action)) throw new Error("操作与事项类型不匹配。");
      if (row.kind === "meeting" && isMeetingCompleted(this.database, id)) throw new Error("该事项已经处理。");
      if (["approved", "returned", "done"].includes(String(recipient.action))) throw new Error("该事项已经处理。");
      const now = new Date().toISOString();
      this.database.prepare("UPDATE workspace_activity SET version=version+1 WHERE id=?").run(id);
      this.database.prepare("UPDATE workspace_activity_responses SET action=?,note=?,responded_at=? WHERE activity_id=? AND member_id=?").run(input.action, input.note, now, id, actorId);
      this.audit(id, actorId, input.action, input.note, now);
      const actionLabels = { accepted: "已接受", declined: "已拒绝", change_requested: "请求调整", done: "已完成", approved: "审批通过", returned: "已退回" };
      insertNotifications(this.database, { recipientIds: [String(row.created_by)].filter(id => this.members.includes(id)), actorId, kind: row.kind === "approval" ? "approval_decided" : "activity_responded", projectId: row.project_id ? String(row.project_id) : null, message: `「${String(row.title)}」${actionLabels[input.action]}${input.note ? `：${input.note.slice(0, 120)}` : ""}`, targetUrl: activityNotificationUrl(String(row.kind), id), createdAt: now });
      return this.map({ ...row, version: Number(row.version) + 1 });
    });
  }

  uploadDocument(id: string, input: ActivityDocumentUpload, actorId: string, key: string): WorkspaceActivity {
    if (!key.trim() || key.length > 200) throw new Error("幂等键无效。");
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw new Error("事项版本无效。");
    const validated = prepareActivityFiles([input])[0];
    const payload = JSON.stringify(filePayload(validated));
    return this.transaction(() => {
      const row = this.database.prepare("SELECT * FROM workspace_activity WHERE id=?").get(id);
      if (!row || row.created_by !== actorId || !this.members.includes(actorId)) throw new Error("没有上传此事项资料的权限。");
      assertActivityActive(row);
      const prior = this.database.prepare("SELECT input_json FROM workspace_activity_documents WHERE activity_id=? AND uploaded_by=? AND idempotency_key=?").get(id, actorId, key);
      if (prior) {
        if (prior.input_json !== payload) throw new Error("幂等键已用于其他内容。");
        return this.map(row);
      }
      if (this.database.prepare("SELECT 1 FROM activity_attachment_requests WHERE activity_id=? AND actor_id=? AND request_key=?").get(id, actorId, key)) throw new Error("幂等键已用于其他内容。");
      assertAttachmentsMutable(this.database, row, actorId, this.members, input.expectedVersion);
      const now = new Date().toISOString();
      insertActivityFile(this.database, id, validated, actorId, key, now);
      this.database.prepare("UPDATE workspace_activity SET version=version+1 WHERE id=?").run(id);
      this.audit(id, actorId, "document_uploaded", input.name, now);
      return this.map({ ...row, version: Number(row.version) + 1 });
    });
  }

  referenceDocuments(id: string, raw: unknown, actorId: string, key: string): WorkspaceActivity {
    const input = z.object({ expectedVersion: z.number().int().positive(), projectDocumentIds: z.array(z.string().trim().min(1).max(128)).min(1).max(20) }).strict().parse(raw);
    if (!key.trim() || key.length > 200) throw new Error("幂等键无效。");
    const ids = [...new Set(input.projectDocumentIds)].sort(); const payload = JSON.stringify({ projectDocumentIds: ids });
    return this.transaction(() => {
      const row = this.database.prepare("SELECT * FROM workspace_activity WHERE id=?").get(id);
      if (!row || row.created_by !== actorId || !this.members.includes(actorId)) throw new Error("没有上传此事项资料的权限。");
      assertActivityActive(row);
      const prior = this.database.prepare("SELECT input_json FROM activity_attachment_requests WHERE activity_id=? AND actor_id=? AND request_key=?").get(id, actorId, key);
      if (prior) { if (prior.input_json !== payload) throw new Error("幂等键已用于其他内容。"); return this.map(row); }
      if (this.database.prepare("SELECT 1 FROM workspace_activity_documents WHERE activity_id=? AND uploaded_by=? AND idempotency_key=?").get(id, actorId, key)) throw new Error("幂等键已用于其他内容。");
      assertAttachmentsMutable(this.database, row, actorId, this.members, input.expectedVersion);
      validateProjectFileReferences(this.database, ids);
      const now = new Date().toISOString();
      const count = insertProjectFileReferences(this.database, id, ids, actorId, now);
      this.database.prepare("INSERT INTO activity_attachment_requests(activity_id,actor_id,request_key,input_json) VALUES (?,?,?,?)").run(id, actorId, key, payload);
      if (count) {
        this.database.prepare("UPDATE workspace_activity SET version=version+1 WHERE id=?").run(id);
        this.audit(id, actorId, "project_documents_referenced", `引用项目资料 ${count} 份`, now);
      }
      return this.map({ ...row, version: Number(row.version) + (count ? 1 : 0) });
    });
  }

  lifecycle(id: string, raw: unknown, actorId: string, options: { canAdmin?: boolean } = {}): WorkspaceActivity {
    const action = raw && typeof raw === "object" && "action" in raw ? (raw as { action?: unknown }).action : undefined;
    return this.map(action === "archive" || action === "delete"
      ? transitionTask(this.database, id, raw, actorId, this.members, new Date(), options)
      : transitionApproval(this.database, id, raw, actorId, this.members, new Date(), options));
  }

  view(id: string, actorId: string): WorkspaceActivity {
    return this.transaction(() => {
      const row = this.database.prepare("SELECT * FROM workspace_activity WHERE id=? AND kind='approval'").get(id);
      if (!row || !this.members.includes(actorId)) throw new ApprovalLifecycleError(404, "NOT_FOUND", "审批不存在。");
      const response = this.database.prepare("SELECT viewed_at FROM workspace_activity_responses WHERE activity_id=? AND member_id=?").get(id, actorId);
      if (!response) throw new ApprovalLifecycleError(403, "FORBIDDEN", "只有审批接收人可以标记查看。");
      if (!response.viewed_at && (row.status ?? "active") === "active") this.database.prepare("UPDATE workspace_activity_responses SET viewed_at=? WHERE activity_id=? AND member_id=? AND viewed_at IS NULL").run(new Date().toISOString(), id, actorId);
      return this.map(row);
    });
  }

  readDocument(activityId: string, documentId: string, actorId: string) {
    const allowed = this.database.prepare(`SELECT id FROM workspace_activity a WHERE a.id=? AND a.deleted_at IS NULL AND (a.created_by=? OR EXISTS (
      SELECT 1 FROM workspace_activity_responses r WHERE r.activity_id=a.id AND r.member_id=?))`).get(activityId, actorId, actorId);
    if (!allowed || !this.members.includes(actorId)) throw new Error("事项资料不存在。");
    const row = this.database.prepare("SELECT * FROM workspace_activity_documents WHERE id=? AND activity_id=?").get(documentId, activityId);
    if (row) return { originalName: String(row.original_name), mediaType: String(row.media_type), kind: row.document_kind as ProjectDocumentKind, bytes: row.content as Uint8Array };
    const reference = this.database.prepare(`SELECT d.id,d.project_id FROM activity_project_documents r JOIN project_documents d ON d.id=r.project_document_id WHERE r.id=? AND r.activity_id=?`).get(documentId, activityId);
    if (!reference) throw new Error("事项资料不存在。");
    return readProjectDocument(this.database, String(reference.project_id), String(reference.id), this.options.storageRoot);
  }

  private audit(id: string, actor: string, action: string, note: string, at: string) {
    this.database.prepare("INSERT INTO workspace_activity_audit(id,activity_id,actor_id,action,note,created_at) VALUES (?,?,?,?,?,?)").run(randomUUID(), id, actor, action, note, at);
  }

  private map(row: Record<string, unknown>): WorkspaceActivity {
    return {
      id: String(row.id), kind: row.kind as WorkspaceActivity["kind"],
      ...(row.kind === "approval" ? { approvalType: String(row.approval_type ?? "general") as WorkspaceActivity["approvalType"] } : {}),
      status: String(row.status ?? "active") as WorkspaceActivity["status"],
      completedAt: row.completed_at ? String(row.completed_at) : null, withdrawnAt: row.withdrawn_at ? String(row.withdrawn_at) : null,
      archivedAt: row.archived_at ? String(row.archived_at) : null, archiveAt: row.archive_at ? String(row.archive_at) : null,
      deletedAt: row.deleted_at ? String(row.deleted_at) : null,
      title: String(row.title), description: String(row.description),
      dueAt: row.due_at ? String(row.due_at) : null, endAt: row.end_at ? String(row.end_at) : null, location: String(row.location), projectId: row.project_id ? String(row.project_id) : null,
      createdBy: String(row.created_by), createdAt: String(row.created_at), updatedAt: String(row.updated_at ?? row.created_at), version: Number(row.version),
      documents: activityDocuments(this.database, String(row.id)),
      responses: this.database.prepare("SELECT member_id AS memberId,action,note,responded_at AS respondedAt,assigned_at AS assignedAt,viewed_at AS viewedAt FROM workspace_activity_responses WHERE activity_id=? ORDER BY member_id").all(String(row.id)).map((entry) => ({ ...entry })) as unknown as WorkspaceActivity["responses"],
      audit: this.database.prepare("SELECT actor_id AS actorId,action,note,created_at AS createdAt FROM workspace_activity_audit WHERE activity_id=? ORDER BY created_at,rowid").all(String(row.id)).map((entry) => ({ ...entry })) as unknown as WorkspaceActivity["audit"],
    };
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try { const value = operation(); this.database.exec("COMMIT"); return value; }
    catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
}
