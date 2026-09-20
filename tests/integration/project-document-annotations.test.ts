import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { listProjectDocuments, uploadProjectDocument } from "@/workbench/documents";
import { addDocumentAnnotation, listDocumentAnnotations } from "@/workbench/project-document-annotations";
import { readProjectDocument } from "@/workbench/project-document-content";

const projectId = "project-qiongxin";
const manager = { id: "alice", name: "王经理", roles: ["investment_manager"] };
const researcher = { id: "bob", name: "研究员", roles: ["researcher"] };
let database: DatabaseSync;
let storageRoot: string;
let documentId: string;
let storageKey: string;
function add(content: string, key: string, extras = {}, actor = manager) {
  return addDocumentAnnotation(database, projectId, documentId, { content, ...extras }, actor, key);
}
beforeEach(async () => {
  database = createDatabase(":memory:"); initializeDatabase(database); seedDemoData(database);
  storageRoot = mkdtempSync(join(tmpdir(), "vc-document-review-"));
  const uploaded = await uploadProjectDocument(database, { projectId, expectedVersion: 1, name: "资料.txt", mimeType: "text/plain", bytes: Buffer.from("待确认资料"), externalPolicy: "local_only", actorId: "alice", idempotencyKey: "upload", storageRoot });
  documentId = uploaded.id; storageKey = uploaded.storageKey;
});
afterEach(() => { database.close(); rmSync(storageRoot, { recursive: true, force: true }); });

describe("document discussion and review", () => {
  it("persists named comments, replies, independent review status and idempotent retry", () => {
    expect(listDocumentAnnotations(database, projectId, documentId, manager)).toMatchObject({ items: [], reviewStatus: "pending", permissions: { canComment: true, canReview: true } });
    const projectBefore = database.prepare("SELECT * FROM projects WHERE id=?").get(projectId);
    const first = add("核实财务数据", "first");
    const parentId = first.items[0].id;
    const reply = add("已核实", "reply", { parentId }, researcher);
    expect(reply.items[1]).toMatchObject({ parentId, authorId: "bob", authorName: "研究员", action: "comment" });
    expect(add("已核实", "reply", { parentId }, researcher).items).toHaveLength(2);
    expect(add("", "approve", { action: "approve" }).reviewStatus).toBe("approved");
    expect(listProjectDocuments(database, projectId)[0]).toMatchObject({ reviewStatus: "approved" });
    expect(listProjectDocuments(database, projectId)[0]).not.toHaveProperty("storageKey");
    expect(add("请补充附件", "changes", { action: "request_changes" }).reviewStatus).toBe("changes_requested");
    expect(add("收到", "later").reviewStatus).toBe("changes_requested");
    expect(database.prepare("SELECT * FROM projects WHERE id=?").get(projectId)).toEqual(projectBefore);
  });
  it("rejects viewers, unauthorized reviewers and invalid reply relationships", () => {
    expect(() => add("x", "viewer", {}, { ...researcher, roles: ["viewer"] })).toThrow("没有批注权限");
    expect(() => add("", "review", { action: "approve" }, researcher)).toThrow("没有审核权限");
    const rootId = add("根", "root").items[0].id;
    const replyId = add("回复", "reply", { parentId: rootId }).items[1].id;
    expect(() => add("第三层", "nested", { parentId: replyId })).toThrow("只能回复当前资料的一级批注");
    expect(() => add("未知", "unknown", { parentId: "missing" })).toThrow("只能回复当前资料的一级批注");
    expect(() => add("通过", "approve-reply", { parentId: rootId, action: "approve" })).toThrow("批注参数无效");
    expect(() => add(" ", "blank")).toThrow("批注参数无效");
    expect(() => add("", "changes-blank", { action: "request_changes" })).toThrow("批注参数无效");
    expect(() => add("x".repeat(10001), "long")).toThrow("批注参数无效");
    expect(() => add("x", "")).toThrow("幂等键无效");
    expect(listDocumentAnnotations(database, projectId, documentId, { ...researcher, roles: ["viewer"] }).permissions).toEqual({ canComment: false, canReview: false });
    expect(add("合规建议", "compliance", {}, { ...researcher, roles: ["compliance_reviewer"] }).items).toHaveLength(3);
  });
  it("binds reads and replies to their document and rejects reused keys with different content", async () => {
    const first = add("原批注", "once");
    expect(() => add("不同", "once")).toThrow("幂等键已用于不同请求");
    expect(() => listDocumentAnnotations(database, "project-yaoshi", documentId, manager)).toThrow("关联资料不存在");
    const other = await uploadProjectDocument(database, { projectId, expectedVersion: 2, name: "other.txt", mimeType: "text/plain", bytes: Buffer.from("other"), externalPolicy: "local_only", actorId: "alice", idempotencyKey: "other", storageRoot });
    expect(() => addDocumentAnnotation(database, projectId, other.id, { content: "跨资料", parentId: first.items[0].id }, manager, "cross")).toThrow("只能回复当前资料的一级批注");
  });
  it("rolls back comment and idempotency when its audit insertion fails", () => {
    database.exec("CREATE TRIGGER fail_document_audit BEFORE INSERT ON platform_timeline BEGIN SELECT RAISE(ABORT, 'audit failed'); END;");
    expect(() => add("rollback", "retry")).toThrow("audit failed");
    expect(listDocumentAnnotations(database, projectId, documentId, manager).items).toHaveLength(0);
    database.exec("DROP TRIGGER fail_document_audit");
    expect(add("rollback", "retry").items).toHaveLength(1);
  });
});

describe("safe project document reads", () => {
  it("reads original bytes and hides internal storage paths", () => {
    const result = readProjectDocument(database, projectId, documentId, storageRoot);
    expect(result.bytes.toString()).toBe("待确认资料");
    expect(result).not.toHaveProperty("storageKey");
    expect(() => readProjectDocument(database, "project-yaoshi", documentId, storageRoot)).toThrow("关联资料不存在");
  });
  it("rejects path traversal, file symlinks and root symlinks", () => {
    database.prepare("UPDATE project_documents SET storage_key='../secret' WHERE id=?").run(documentId);
    expect(() => readProjectDocument(database, projectId, documentId, storageRoot)).toThrow("资料文件不可用");
    database.prepare("UPDATE project_documents SET storage_key=? WHERE id=?").run(storageKey, documentId);
    unlinkSync(join(storageRoot, storageKey)); writeFileSync(join(storageRoot, "secret.txt"), "secret");
    symlinkSync(join(storageRoot, "secret.txt"), join(storageRoot, storageKey));
    expect(() => readProjectDocument(database, projectId, documentId, storageRoot)).toThrow("资料文件不可用");
    symlinkSync(storageRoot, join(storageRoot, "root-link"));
    expect(() => readProjectDocument(database, projectId, documentId, join(storageRoot, "root-link"))).toThrow("资料文件不可用");
  });
  it("rejects oversized and missing files", () => {
    writeFileSync(join(storageRoot, storageKey), Buffer.alloc(20 * 1024 * 1024 + 1));
    expect(() => readProjectDocument(database, projectId, documentId, storageRoot)).toThrow("单文件不能超过 20 MB");
    unlinkSync(join(storageRoot, storageKey));
    expect(() => readProjectDocument(database, projectId, documentId, storageRoot)).toThrow("资料文件不可用");
  });
});
