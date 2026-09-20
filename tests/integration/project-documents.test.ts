import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { analyzeNextDocument, listProjectDocuments, uploadProjectDocument } from "@/workbench/documents";

describe("project documents", () => {
  let database: DatabaseSync;
  let storageRoot: string;
  beforeEach(() => {
    database = createDatabase(":memory:");
    initializeDatabase(database);
    seedDemoData(database);
    storageRoot = mkdtempSync(join(tmpdir(), "vc-hunter-docs-"));
  });
  afterEach(() => { database.close(); rmSync(storageRoot, { recursive: true, force: true }); });

  it("stores a document outside public, deduplicates it, and queues analysis", async () => {
    const bytes = Buffer.from("# 项目更新\n2026-08-20 完成客户送测，量产仍待验证。", "utf8");
    const first = await uploadProjectDocument(database, { projectId: "project-qiongxin", expectedVersion: 1, name: "update.md", mimeType: "text/markdown", bytes, externalPolicy: "local_only", actorId: "user-demo", idempotencyKey: "upload-1", storageRoot });
    const repeated = await uploadProjectDocument(database, { projectId: "project-qiongxin", expectedVersion: first.projectVersion, name: "update.md", mimeType: "text/markdown", bytes, externalPolicy: "local_only", actorId: "user-demo", idempotencyKey: "upload-2", storageRoot });
    const sameRequest = await uploadProjectDocument(database, { projectId: "project-qiongxin", expectedVersion: 1, name: "update.md", mimeType: "text/markdown", bytes, externalPolicy: "local_only", actorId: "user-demo", idempotencyKey: "upload-1", storageRoot });
    expect(repeated.id).toBe(first.id);
    expect(sameRequest.id).toBe(first.id);
    expect(readFileSync(join(storageRoot, first.storageKey))).toEqual(bytes);
    expect(database.prepare("SELECT count(*) AS count FROM document_analysis_jobs").get()).toEqual({ count: 1 });
  });

  it("extracts local text and creates only draft knowledge", async () => {
    const uploaded = await uploadProjectDocument(database, { projectId: "project-qiongxin", expectedVersion: 1, name: "update.txt", mimeType: "text/plain", bytes: Buffer.from("2026-08-20 完成客户送测。风险：量产良率仍待验证。"), externalPolicy: "local_only", actorId: "user-demo", idempotencyKey: "upload-3", storageRoot });
    const externalAnalyze = async () => { throw new Error("local-only content must not leave the host"); };
    const result = await analyzeNextDocument(database, { workerId: "worker-1", now: "2026-09-01T09:00:00.000Z", storageRoot, externalAnalyze });
    expect(result).toMatchObject({ ran: true, documentId: uploaded.id });
    expect(database.prepare("SELECT parse_status,analysis_status FROM project_documents WHERE id=?").get(uploaded.id)).toEqual({ parse_status: "succeeded", analysis_status: "succeeded" });
    expect(database.prepare("SELECT status,source_type,source_id FROM knowledge_entries WHERE source_id=?").get(uploaded.id)).toEqual({ status: "draft", source_type: "document", source_id: uploaded.id });
    expect(database.prepare("SELECT occurred_at,title FROM document_extracted_events WHERE document_id=?").get(uploaded.id)).toEqual({ occurred_at: "2026-08-20T00:00:00.000Z", title: "资料事件" });
  });

  it("rejects external permission on new uploads", async () => {
    await expect(uploadProjectDocument(database, { projectId: "project-qiongxin", expectedVersion: 1, name: "private.txt", mimeType: "text/plain", bytes: Buffer.from("private deal terms"), externalPolicy: "external_allowed", actorId: "user-demo", idempotencyKey: "external-1", storageRoot })).rejects.toThrow("资料外发暂未开放，仅支持本地分析。");
    expect(database.prepare("SELECT count(*) AS count FROM project_documents").get()).toEqual({ count: 0 });
  });

  it("never calls external analysis for historical externally allowed jobs", async () => {
    const uploaded = await uploadProjectDocument(database, { projectId: "project-qiongxin", expectedVersion: 1, name: "private.txt", mimeType: "text/plain", bytes: Buffer.from("风险：私有交易条款尚未确认。"), externalPolicy: "local_only", actorId: "user-demo", idempotencyKey: "legacy-1", storageRoot });
    database.prepare("UPDATE project_documents SET external_policy='external_allowed' WHERE id=?").run(uploaded.id);
    const externalAnalyze = vi.fn().mockResolvedValue({ summary: "remote response must not be used" });
    await expect(analyzeNextDocument(database, { workerId: "worker-1", storageRoot, externalAnalyze })).resolves.toMatchObject({ ran: true, documentId: uploaded.id });
    expect(externalAnalyze).not.toHaveBeenCalled();
    expect(listProjectDocuments(database, "project-qiongxin")[0].externalPolicy).toBe("local_only");
    const knowledge = database.prepare("SELECT content FROM knowledge_entries WHERE source_id=?").get(uploaded.id) as { content: string };
    expect(knowledge.content).toContain("私有交易条款");
    expect(knowledge.content).not.toContain("remote response");
    const event = database.prepare("SELECT metadata_json FROM platform_timeline WHERE event_type='document.analyzed' AND subject_id=?").get(uploaded.id) as { metadata_json: string };
    expect(JSON.parse(event.metadata_json).externalPolicy).toBe("local_only");
  });
});
