import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { businessOperationDocumentsMigration } from "@/workbench/business-operation-documents-migration";
import { createOperation, updateOperation, listOperations, readOperationDocument } from "@/workbench/business-operations";
import { uploadProjectDocument } from "@/workbench/documents";

let db: DatabaseSync;
let storageRoot: string;
const actor = { tenantId: "org-a", id: "user-a", roles: ["investment_manager"] };
const expense = { name: "真实费用", status: "recorded", data: { amountCny: 100, occurredOn: "2026-09-04" } };
const file = { name: "费用说明.txt", mimeType: "text/plain", bytes: Buffer.from("仅在本机构保存的附件") };
beforeEach(() => {
  db = createDatabase(":memory:"); initializeDatabase(db); seedDemoData(db);
  storageRoot = mkdtempSync(join(tmpdir(), "operation-attachments-"));
  if (!db.prepare("SELECT name FROM sqlite_master WHERE name='business_operation_documents'").get()) db.exec(businessOperationDocumentsMigration.upSql);
});
afterEach(() => { db.close(); rmSync(storageRoot, { recursive: true, force: true }); });

describe("atomic business form attachments", () => {
  it("persists local bytes with the record and replays an identical create without duplicates", () => {
    const result = createOperation(db, actor, "expense", expense, "upload", { files: [file] });
    expect(result.documents).toEqual([expect.objectContaining({ originalName: file.name, source: "upload", kind: "text", byteLength: file.bytes.length })]);
    expect(db.prepare("SELECT content FROM business_operation_documents").get()?.content).toEqual(new Uint8Array(file.bytes));
    expect(listOperations(db, actor, "expense")[0].documents).toEqual(result.documents);
    expect(createOperation(db, actor, "expense", expense, "upload", { files: [file] })).toEqual(result);
    expect(db.prepare("SELECT count(*) n FROM business_operation_documents").get()?.n).toBe(1);
    expect(() => createOperation(db, actor, "expense", expense, "upload", { files: [{ ...file, bytes: Buffer.from("changed") }] })).toThrow(/幂等/);
  });
  it("rolls both the new record and attachment back if audit persistence fails", () => {
    db.exec("CREATE TRIGGER fail_operation_audit BEFORE INSERT ON business_operation_audit BEGIN SELECT RAISE(ABORT,'failure'); END");
    expect(() => createOperation(db, actor, "expense", expense, "rollback", { files: [file] })).toThrow();
    expect(db.prepare("SELECT count(*) n FROM business_operation_records").get()?.n).toBe(0);
    expect(db.prepare("SELECT count(*) n FROM business_operation_documents").get()?.n).toBe(0);
  });
  it("atomically adds attachments on edits and deduplicates retries with the file hash", () => {
    const record = createOperation(db, actor, "expense", expense, "create");
    const patch = { version: 1, name: "费用补充" };
    const options = { files: [file], idempotencyKey: "append" };
    const edited = updateOperation(db, actor, "expense", record.id, patch, options);
    expect(edited).toMatchObject({ version: 2, documents: [expect.objectContaining({ source: "upload" })] });
    expect(updateOperation(db, actor, "expense", record.id, patch, options)).toEqual(edited);
    expect(() => updateOperation(db, actor, "expense", record.id, patch, { ...options, files: [{ ...file, bytes: Buffer.from("different") }] })).toThrow(/幂等/);
    expect(() => updateOperation(db, actor, "expense", record.id, { version: 1 }, { files: [file], idempotencyKey: "stale" })).toThrow(/版本/);
    expect(db.prepare("SELECT count(*) n FROM business_operation_documents").get()?.n).toBe(1);
  });
  it("rejects excessive, unsupported or empty uploads before writing any record", () => {
    for (const files of [[{ ...file, name: "tool.exe" }], [{ ...file, bytes: Buffer.alloc(0) }], Array.from({ length: 11 }, () => file), [{ ...file, bytes: Buffer.alloc(20 * 1024 * 1024 + 1) }]]) {
      expect(() => createOperation(db, actor, "expense", expense, "invalid", { files })).toThrow();
    }
    expect(db.prepare("SELECT count(*) n FROM business_operation_records").get()?.n).toBe(0);
  });
  it("references files from different projects even without an associated project, and removes only references on edit", async () => {
    const projects = db.prepare("SELECT id,version FROM projects ORDER BY id LIMIT 2").all();
    const uploaded = await Promise.all(projects.map((project, index) => uploadProjectDocument(db, {
      projectId: String(project.id), expectedVersion: Number(project.version), name: `项目${index}.txt`, mimeType: "text/plain", bytes: Buffer.from(`项目${index}原文`),
      externalPolicy: "local_only", actorId: actor.id, idempotencyKey: `reference-${index}`, storageRoot,
    })));
    const input = { ...expense, data: { ...expense.data, documentIds: uploaded.map(document => document.id) } };
    const record = createOperation(db, actor, "expense", input, "references", { files: [file] });
    expect(record.documents).toHaveLength(3);
    expect(record.documents?.filter(document => document.source === "project").map(document => document.projectId)).toEqual(projects.map(project => project.id));
    expect(Buffer.from(readOperationDocument(db, actor, "expense", record.id, uploaded[1].id, storageRoot).bytes).toString()).toBe("项目1原文");
    const updated = updateOperation(db, actor, "expense", record.id, { version: 1, data: { ...expense.data, projectId: String(projects[0].id), documentIds: [uploaded[1].id] } });
    expect(updated.documents).toHaveLength(2);
    expect(() => readOperationDocument(db, actor, "expense", record.id, uploaded[0].id, storageRoot)).toThrow(/取消引用/);
    expect(db.prepare("SELECT count(*) n FROM project_documents").get()?.n).toBe(2);
    expect(db.prepare("SELECT count(*) n FROM business_operation_documents").get()?.n).toBe(1);
  });
  it("does not expose another tenant's or another record's attachment", () => {
    const record = createOperation(db, actor, "expense", expense, "local", { files: [file] });
    const documentId = record.documents![0].id;
    const other = createOperation(db, actor, "expense", expense, "other");
    expect(() => readOperationDocument(db, { ...actor, tenantId: "org-b" }, "expense", record.id, documentId)).toThrow(/记录不存在/);
    expect(() => readOperationDocument(db, actor, "expense", other.id, documentId)).toThrow(/附件不存在/);
    expect(() => readOperationDocument(db, { ...actor, roles: [] }, "expense", record.id, documentId)).toThrow(/权限/);
    expect(Buffer.from(readOperationDocument(db, { ...actor, roles: ["viewer"] }, "expense", record.id, documentId).bytes).toString()).toBe(file.bytes.toString());
  });
  it("rolls an edited record and its new files back on audit failure", () => {
    const original = createOperation(db, actor, "expense", expense, "create", { files: [file] });
    db.exec("CREATE TRIGGER fail_operation_edit BEFORE INSERT ON business_operation_audit BEGIN SELECT RAISE(ABORT,'failed'); END");
    expect(() => updateOperation(db, actor, "expense", original.id, { version: 1, name: "未完成变更" }, { files: [file], idempotencyKey: "edit" })).toThrow();
    expect(listOperations(db, actor, "expense")[0]).toEqual(original);
    expect(db.prepare("SELECT count(*) n FROM business_operation_documents").get()?.n).toBe(1);
    expect(db.prepare("SELECT count(*) n FROM business_operation_update_requests").get()?.n).toBe(0);
  });
});
