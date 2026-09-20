import { beforeEach, afterEach, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { WorkspaceActivityRepository } from "@/repositories/workspace-activity";
import { ActivityCommentsRepository } from "@/repositories/activity-comments";
import { SqliteDealTimelineRepository } from "@/workbench/deal-timeline";
import { addDocumentAnnotation, deleteDocumentAnnotation, listDocumentAnnotations } from "@/workbench/project-document-annotations";
import { identityScope, type WorkspaceIdentity } from "@/security/identity-scope";
let db: DatabaseSync; let comments: ActivityCommentsRepository; let timeline: SqliteDealTimelineRepository; let activityId: string;
const projectId = "project-qiongxin";
const actor = { id: "alice", name: "Alice", roles: ["researcher"] };
function admin<T>(fn: () => T) { return identityScope.run({ user: { id: "admin", name: "Admin", role: "管理员", capabilities: [] }, roles: ["org_admin"], tenantId: "t", accountId: "a" } satisfies WorkspaceIdentity, fn); }
beforeEach(() => {
  db = createDatabase(":memory:"); initializeDatabase(db); seedDemoData(db);
  comments = new ActivityCommentsRepository(db, ["alice", "bob", "admin"]);
  timeline = new SqliteDealTimelineRepository(db, [{ id: "alice", name: "Alice" }, { id: "bob", name: "Bob" }, { id: "admin", name: "Admin" }].map(member => ({ ...member, role: "研究员", tracks: [], subtracks: [], currentLoad: 0 })));
  activityId = new WorkspaceActivityRepository(db, ["alice", "bob", "admin"]).create({ kind: "task", title: "Test", participantIds: ["bob"], dueAt: "2026-10-01T10:00:00.000Z" }, "alice", "task").id;
});
afterEach(() => db.close());
it("deletes own activity comment, preserves replies, blocks attachments and retracts notifications atomically", () => {
  const root = comments.create(activityId, { body: "secret text" }, "alice", "root", [{ name: "private.txt", mimeType: "text/plain", bytes: Buffer.from("private bytes") }]);
  const reply = comments.create(activityId, { body: "reply", parentId: root.id }, "bob", "reply");
  expect(root.canDelete).toBe(true);
  expect(() => comments.delete(activityId, root.id, "bob")).toThrow("没有删除评论权限。");
  const result = comments.delete(activityId, root.id, "alice");
  expect(result).toMatchObject({ body: "", documents: [], deletedAt: expect.any(String), canDelete: false });
  expect(comments.delete(activityId, root.id, "alice")).toEqual(result);
  expect(comments.list(activityId, "bob").items).toEqual([result, { ...reply, canDelete: true }]);
  expect(() => comments.readDocument(activityId, root.id, root.documents[0].id, "alice")).toThrow("事项讨论附件不存在。");
  expect(comments.create(activityId, { body: "secret text" }, "alice", "root", [{ name: "private.txt", mimeType: "text/plain", bytes: Buffer.from("private bytes") }])).toEqual(result);
  expect(db.prepare("SELECT id FROM member_notifications WHERE comment_id=?").all(root.id)).toEqual([]);
  expect(db.prepare("SELECT id FROM activity_comment_documents WHERE comment_id=?").all(root.id)).toEqual([]);
});
it("only verified administrators can delete another participant's activity comment", () => {
  const item = comments.create(activityId, { body: "text" }, "alice", "root");
  expect(() => comments.delete(activityId, item.id, "admin")).toThrow();
  expect(() => new ActivityCommentsRepository(db, ["bob"]).delete(activityId, item.id, "alice")).toThrow();
  expect(admin(() => comments.delete(activityId, item.id, "admin")).deletedAt).toBeTruthy();
});
it("rolls back comment and attachment deletion if notification withdrawal fails", () => {
  const item = comments.create(activityId, { body: "text" }, "alice", "root", [{ name: "private.txt", mimeType: "text/plain", bytes: Buffer.from("private bytes") }]);
  db.exec("CREATE TRIGGER fail_retract BEFORE DELETE ON member_notifications BEGIN SELECT RAISE(ABORT,'withdraw failed'); END");
  expect(() => comments.delete(activityId, item.id, "alice")).toThrow("withdraw failed");
  expect(comments.list(activityId, "alice").items[0]).toEqual(item);
  expect(Buffer.from(comments.readDocument(activityId, item.id, item.documents[0].id, "alice").bytes).toString()).toBe("private bytes");
});
it("redacts project comments from list, milestones, timeline and idempotent creation", () => {
  const milestone = timeline.createMilestone(projectId, { stage: "screening", title: "Node" }, "node", "alice");
  const item = timeline.addComment(projectId, { body: "secret @Bob", milestoneId: milestone.id }, "root", "alice");
  expect(() => timeline.deleteComment(projectId, item.id, "bob")).toThrow("没有删除评论权限。");
  expect(() => timeline.deleteComment("project-yaoshi", item.id, "alice")).toThrow("评论不存在。");
  const result = timeline.deleteComment(projectId, item.id, "alice");
  expect(result).toMatchObject({ body: "", mentions: [], canDelete: false, deletedAt: expect.any(String) });
  expect(timeline.listMilestones(projectId)[0].comments[0]).toEqual(result);
  expect(timeline.addComment(projectId, { body: "secret @Bob", milestoneId: milestone.id }, "root", "alice")).toEqual(result);
  expect(JSON.stringify(db.prepare("SELECT summary,metadata_json FROM platform_timeline WHERE subject_id=?").all(item.id))).not.toContain("secret");
  expect(db.prepare("SELECT id FROM member_notifications WHERE comment_id=?").all(item.id)).toEqual([]);
  const second = timeline.addComment(projectId, { body: "second" }, "second", "alice");
  expect(admin(() => timeline.deleteComment(projectId, second.id, "admin")).deletedAt).toBeTruthy();
});
it("deletes document discussion while preserving replies and formal review history", () => {
  db.prepare("INSERT INTO project_documents(id,project_id,original_name,storage_key,media_type,document_kind,byte_length,sha256,external_policy,uploaded_by,created_at,updated_at,parse_status,analysis_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run("doc", projectId, "doc.txt", "doc", "text/plain", "text", 1, "hash", "local_only", "alice", new Date().toISOString(), new Date().toISOString(), "queued", "queued");
  const item = addDocumentAnnotation(db, projectId, "doc", { content: "secret" }, actor, "root").items[0];
  addDocumentAnnotation(db, projectId, "doc", { content: "reply", parentId: item.id }, { ...actor, id: "bob" }, "reply");
  const review = addDocumentAnnotation(db, projectId, "doc", { content: "", action: "approve" }, { ...actor, roles: ["investment_manager"] }, "review").items[2];
  expect(() => deleteDocumentAnnotation(db, projectId, "doc", item.id, { ...actor, id: "bob" })).toThrow("没有删除评论权限。");
  expect(() => deleteDocumentAnnotation(db, projectId, "doc", review.id, actor)).toThrow("正式审核记录不能删除。");
  const result = deleteDocumentAnnotation(db, projectId, "doc", item.id, actor);
  expect(result.reviewStatus).toBe("approved");
  expect(result.items[0]).toMatchObject({ content: "", deletedAt: expect.any(String), canDelete: false });
  expect(result.items[1]).toMatchObject({ content: "reply", parentId: item.id });
  expect(deleteDocumentAnnotation(db, projectId, "doc", item.id, actor)).toEqual(result);
  expect(listDocumentAnnotations(db, projectId, "doc", actor)).toEqual(result);
  expect(db.prepare("SELECT id FROM member_notifications WHERE comment_id=?").all(item.id)).toEqual([]);
  expect(admin(() => deleteDocumentAnnotation(db, projectId, "doc", result.items[1].id, { id: "admin", name: "Admin", roles: ["org_admin"] })).items[1].deletedAt).toBeTruthy();
});
it("withdrawal failures preserve project and document comments and missing targets never mutate others", () => {
  const project = timeline.addComment(projectId, { body: "project @Bob" }, "project", "alice");
  db.exec("CREATE TRIGGER fail_retract BEFORE DELETE ON member_notifications BEGIN SELECT RAISE(ABORT,'withdraw failed'); END");
  expect(() => timeline.deleteComment(projectId, project.id, "alice")).toThrow("withdraw failed");
  expect(timeline.listComments(projectId)[0].body).toBe("project @Bob");
  db.exec("DROP TRIGGER fail_retract");
  expect(() => timeline.deleteComment("missing-project", project.id, "alice")).toThrow("项目不存在。");
  expect(() => comments.delete(activityId, "missing-comment", "alice")).toThrow("评论不存在。");
});
it("does not treat caller-supplied document roles as administrator authority", () => {
  db.prepare("INSERT INTO project_documents(id,project_id,original_name,storage_key,media_type,document_kind,byte_length,sha256,external_policy,uploaded_by,created_at,updated_at,parse_status,analysis_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run("doc", projectId, "doc.txt", "doc", "text/plain", "text", 1, "hash", "local_only", "alice", "2026-09-04", "2026-09-04", "queued", "queued");
  const item = addDocumentAnnotation(db, projectId, "doc", { content: "private" }, actor, "comment").items[0];
  expect(() => deleteDocumentAnnotation(db, projectId, "doc", item.id, { id: "admin", name: "Admin", roles: ["org_admin"] })).toThrow("没有删除评论权限。");
  expect(() => deleteDocumentAnnotation(db, projectId, "missing", item.id, actor)).toThrow("关联资料不存在。");
  db.exec("CREATE TRIGGER fail_retract BEFORE DELETE ON member_notifications BEGIN SELECT RAISE(ABORT,'withdraw failed'); END");
  // Add a recipient to exercise rollback even when this document has no other participants.
  db.prepare("INSERT INTO member_notifications(id,recipient_id,actor_id,kind,comment_id,message,target_url,created_at) VALUES (?,?,?,?,?,?,?,?)").run("notify", "bob", "alice", "document_comment", item.id, "private", "/projects/project-qiongxin", "2026-09-04");
  expect(() => deleteDocumentAnnotation(db, projectId, "doc", item.id, actor)).toThrow("withdraw failed");
  expect(listDocumentAnnotations(db, projectId, "doc", actor).items[0]).toMatchObject({ content: "private", deletedAt: null });
});

it("withdraws attachment references without deleting project originals or reply attachments", () => {
  db.prepare("INSERT INTO project_documents(id,project_id,original_name,storage_key,media_type,document_kind,byte_length,sha256,external_policy,uploaded_by,created_at,updated_at,parse_status,analysis_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run("source-doc", projectId, "doc.txt", "source-doc", "text/plain", "text", 1, "hash", "local_only", "alice", "2026-09-04", "2026-09-04", "queued", "queued");
  const sourceBefore = db.prepare("SELECT * FROM project_documents WHERE id='source-doc'").get();
  const item = comments.create(activityId, { body: "reference", projectDocumentIds: ["source-doc"] }, "alice", "reference");
  const reply = comments.create(activityId, { body: "reply", parentId: item.id }, "bob", "reply-file", [{ name: "reply.txt", mimeType: "text/plain", bytes: Buffer.from("reply bytes") }]);
  comments.delete(activityId, item.id, "alice");
  comments.delete(activityId, item.id, "alice");
  // This is the old release's attachment lookup, which does not know deleted_at.
  expect(db.prepare("SELECT d.* FROM activity_comment_documents d JOIN activity_comments c ON c.id=d.comment_id WHERE c.id=?").all(item.id)).toEqual([]);
  expect(db.prepare("SELECT * FROM project_documents WHERE id='source-doc'").get()).toEqual(sourceBefore);
  expect(db.prepare("SELECT parent_id,deleted_at,deleted_by,input_json FROM activity_comments WHERE id=?").get(item.id)).toMatchObject({ deleted_at: expect.any(String), deleted_by: "alice", input_json: expect.stringContaining("source-doc") });
  expect(comments.list(activityId, "bob").items.find(comment => comment.id === reply.id)).toEqual(reply);
  expect(Buffer.from(comments.readDocument(activityId, reply.id, reply.documents[0].id, "alice").bytes).toString()).toBe("reply bytes");
});
