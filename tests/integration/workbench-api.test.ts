import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { SqliteWorkbenchRepository } from "@/workbench/repository";
import { handleCreateDiscoveryJob, handleGetSession, handleRecordJudgment } from "@/workbench/http";

describe("workbench HTTP contract", () => {
  let database: DatabaseSync;
  let repository: SqliteWorkbenchRepository;
  const actor = { id: "user-demo", name: "演示经理", role: "投资经理", capabilities: ["discover", "review"] };

  beforeEach(() => {
    database = createDatabase(":memory:");
    initializeDatabase(database);
    seedDemoData(database);
    repository = new SqliteWorkbenchRepository(database);
  });
  afterEach(() => database.close());

  it("returns the server-resolved actor", async () => {
    const response = handleGetSession(new Request("http://localhost/api/v1/session"), actor);
    expect((await response.json()).data.user).toEqual(actor);
  });

  it("requires an idempotency key for discovery writes", async () => {
    const request = new Request("http://localhost/api/v1/discovery/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "半导体 新融资" }) });
    const response = await handleCreateDiscoveryJob(request, repository, actor);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("IDEMPOTENCY_REQUIRED");
  });

  it("does not accept a client-reported judgment actor", async () => {
    const request = new Request("http://localhost/api/v1/projects/project-qiongxin/judgments", {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": "judgment-http-1" },
      body: JSON.stringify({ expectedVersion: 1, thesis: "继续观察客户验证", stance: "cautious", occurredAt: "2026-09-01T08:00:00.000Z", actor: "fake-reviewer" }),
    });
    const response = await handleRecordJudgment(request, repository, actor, "project-qiongxin");
    expect(response.status).toBe(400);
    expect(database.prepare("SELECT count(*) AS count FROM project_judgments").get()).toEqual({ count: 0 });
  });
});
