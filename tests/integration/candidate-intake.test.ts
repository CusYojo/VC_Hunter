import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { SqliteWorkbenchRepository } from "@/workbench/repository";
import { handleReviewCandidate } from "@/workbench/http";

vi.mock("@/workbench/team", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/workbench/team")>(),
  loadTeamMembers: () => [
    { id: "user-demo", name: "示例经理", role: "投资经理", tracks: ["半导体"], subtracks: [], currentLoad: 0 },
    { id: "user-other", name: "林川", role: "投资经理", tracks: ["AI"], subtracks: [], currentLoad: 0 },
  ],
}));

describe("candidate intake with ownership", () => {
  let database: DatabaseSync;
  let repository: SqliteWorkbenchRepository;
  const user = { id: "user-demo", name: "示例经理", role: "投资经理", capabilities: ["review", "assign"] };
  const promote = { decision: "promote", expectedVersion: 1, assignee: "林川" } as const;

  beforeEach(() => {
    database = createDatabase(":memory:");
    initializeDatabase(database);
    repository = new SqliteWorkbenchRepository(database);
    database.prepare(`INSERT INTO web_search_leads
      (id,url,title,published_at,highlights_json,first_seen_at,last_seen_at,status)
      VALUES ('intake-lead','https://example.com/intake','融资线索',NULL,'[]','2026-09-01','2026-09-01','discovered')`).run();
    database.prepare(`INSERT INTO project_candidates
      (id,lead_id,company_name,track,investor_names_json,signal_type,summary,confidence,status,model,prompt_version,created_at,updated_at,review_version)
      VALUES ('intake-candidate','intake-lead','星河芯片','半导体','[]','funding','完成融资',0.88,'pending_review','test','p1','2026-09-01','2026-09-01',1)`).run();
  });

  afterEach(() => database.close());

  async function review(body: object, key = "intake-review") {
    return handleReviewCandidate(new Request("http://localhost/api/v1/candidates/intake-candidate/review", {
      method: "PATCH", headers: { "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(body),
    }), repository, user, "intake-candidate");
  }

  it.each(["林川", "示例经理"])("promotes and assigns to %s in one request, retaining the discovery record", async (assignee) => {
    const response = await review({ ...promote, assignee });
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(database.prepare("SELECT owner FROM projects WHERE id=?").get(data.projectId)).toEqual({ owner: assignee });
    expect(new SqliteWorkbenchRepository(database).listCandidates()).toEqual([
      expect.objectContaining({ id: "intake-candidate", status: "promoted", projectId: data.projectId, version: 2 }),
    ]);
    expect(repository.getTimeline(data.projectId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "project.assigned", actor: user.id, metadata: { previousOwner: null, owner: assignee } }),
    ]));
  });

  it("rejects an unknown team member before creating a project", async () => {
    const response = await review({ ...promote, assignee: "不存在的成员" });
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe("负责人不是团队成员。");
    expect(repository.findCandidate("intake-candidate")).toMatchObject({ status: "pending_review", version: 1, projectId: null });
    expect(database.prepare("SELECT count(*) AS count FROM projects").get()).toEqual({ count: 0 });
  });

  it("rolls back promotion if ownership audit persistence fails", async () => {
    database.exec(`CREATE TRIGGER fail_assignment_audit BEFORE INSERT ON platform_timeline
      WHEN NEW.event_type='project.assigned' BEGIN SELECT RAISE(ABORT, 'assignment storage failed'); END`);
    const response = await review(promote);
    expect(response.status).toBe(500);
    expect(repository.findCandidate("intake-candidate")).toMatchObject({ status: "pending_review", version: 1, projectId: null });
    expect(database.prepare("SELECT count(*) AS count FROM projects").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT count(*) AS count FROM companies").get()).toEqual({ count: 0 });
  });

  it("retries idempotently and prevents another promotion", async () => {
    const first = await review(promote);
    expect(first.status).toBe(200);
    const repeated = await review(promote);
    expect(await repeated.json()).toMatchObject({ data: (await first.json()).data });
    const duplicate = await review({ ...promote, expectedVersion: 2 }, "different-review");
    expect(duplicate.status).toBe(400);
    expect(database.prepare("SELECT count(*) AS count FROM projects").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT count(*) AS count FROM platform_timeline WHERE event_type='project.assigned'").get()).toEqual({ count: 1 });
  });

  it("keeps legacy promotion without an assignee compatible", async () => {
    const response = await review({ decision: "promote", expectedVersion: 1 });
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(database.prepare("SELECT owner FROM projects WHERE id=?").get(data.projectId)).toEqual({ owner: null });
  });

  it("dismisses a candidate without assigning or creating a project", async () => {
    const response = await review({ decision: "reject", expectedVersion: 1 });
    expect(response.status).toBe(200);
    expect(repository.listCandidates()[0]).toMatchObject({ status: "dismissed", projectId: null });
    expect(database.prepare("SELECT count(*) AS count FROM projects").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT count(*) AS count FROM platform_timeline WHERE event_type='project.assigned'").get()).toEqual({ count: 0 });
  });

  it("promotes multiple selected people atomically and keeps owner compatible", async () => {
    const response = await review({ decision: "promote", expectedVersion: 1, assignees: ["林川", "示例经理", "林川"] });
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(database.prepare("SELECT owner FROM projects WHERE id=?").get(data.projectId)?.owner).toBe("林川");
    expect(database.prepare("SELECT member_name FROM project_responsibles WHERE project_id=? ORDER BY position").all(data.projectId)).toEqual([{ member_name: "林川" }, { member_name: "示例经理" }]);
    expect(repository.listCandidates()[0]).toMatchObject({ status: "promoted", projectId: data.projectId });
  });
});
