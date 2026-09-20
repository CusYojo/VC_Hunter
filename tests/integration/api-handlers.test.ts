import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { SqliteProjectRepository } from "@/repositories/projects";
import { handleGetProjects, handleReviewProject } from "@/api/project-handlers";

describe("project API handlers", () => {
  let database: DatabaseSync;
  let repository: SqliteProjectRepository;

  beforeEach(() => {
    database = createDatabase(":memory:");
    initializeDatabase(database);
    seedDemoData(database);
    repository = new SqliteProjectRepository(database);
  });

  afterEach(() => database.close());

  it("returns a versioned envelope and applies project filters", async () => {
    const request = new Request("http://localhost/api/v1/projects?track=半导体&status=new", {
      headers: { "x-request-id": "request-list-1" },
    });
    const response = await handleGetProjects(request, repository);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.items).toHaveLength(1);
    expect(payload.data.items[0].track).toBe("半导体");
    expect(payload.meta).toMatchObject({ requestId: "request-list-1", version: "v1" });
    expect(payload.meta.traceId).toBeTruthy();
  });

  it("validates review writes and returns a stable error code", async () => {
    const request = new Request("http://localhost/api/v1/projects/project-qiongxin/review", {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-request-id": "request-invalid-review" },
      body: JSON.stringify({ expectedVersion: 1, status: "unsupported", reviewer: "demo", note: "invalid" }),
    });
    const response = await handleReviewProject(request, repository, "project-qiongxin");
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("SCHEMA_INVALID");
  });

  it("accepts an exact manual workflow stage through the reviewed endpoint", async () => {
    const request = new Request("http://localhost/api/v1/projects/project-qiongxin/review", {
      method: "PATCH",
      headers: { "content-type": "application/json", "idempotency-key": "request-manual-stage" },
      body: JSON.stringify({ expectedVersion: 1, status: "ic", dealStage: "pre_ic", note: "手动调整到内决会。" }),
    });
    const response = await handleReviewProject(request, repository, "project-qiongxin");
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ status: "ic", dealStage: "pre_ic", dealStageLabel: "内决会", version: 2 });
  });

  it("rejects a project status that contradicts the selected workflow stage", async () => {
    const request = new Request("http://localhost/api/v1/projects/project-qiongxin/review", {
      method: "PATCH",
      headers: { "content-type": "application/json", "idempotency-key": "request-contradictory-stage" },
      body: JSON.stringify({ expectedVersion: 1, status: "new", dealStage: "post", note: "手动调整到投后。" }),
    });
    const response = await handleReviewProject(request, repository, "project-qiongxin");
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatchObject({ code: "SCHEMA_INVALID", message: "人工复核参数无效。" });
  });

  it("does not expose unexpected repository error details", async () => {
    const request = new Request("http://localhost/api/v1/projects/project-qiongxin/review", {
      method: "PATCH",
      headers: { "content-type": "application/json", "idempotency-key": "request-hidden-error" },
      body: JSON.stringify({ expectedVersion: 1, status: "dd", dealStage: "dd", note: "手动调整到尽调。" }),
    });
    const broken = { updateReview: () => { throw new Error("SQLITE_CONSTRAINT secret_internal_table"); } } as unknown as SqliteProjectRepository;
    const response = await handleReviewProject(request, broken, "project-qiongxin");
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.error.message).toBe("人工复核失败，请检查参数后重试。");
    expect(JSON.stringify(payload)).not.toContain("secret_internal_table");
  });
});
