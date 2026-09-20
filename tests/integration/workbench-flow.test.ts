import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { SqliteWorkbenchRepository } from "@/workbench/repository";

describe("investment manager workbench flow", () => {
  let database: DatabaseSync;
  let repository: SqliteWorkbenchRepository;

  beforeEach(() => {
    database = createDatabase(":memory:");
    initializeDatabase(database);
    seedDemoData(database);
    repository = new SqliteWorkbenchRepository(database);
  });

  afterEach(() => database.close());

  it("queues an on-demand discovery job idempotently", () => {
    const input = { query: "国内头部机构 半导体 新投资", tracks: ["半导体"], institutions: ["红杉中国"], since: "2026-08-01", resultLimit: 20 } as const;
    const first = repository.createDiscoveryJob(input, "idem-discovery-1", "user-demo");
    const repeated = repository.createDiscoveryJob(input, "idem-discovery-1", "user-demo");
    expect(repeated.id).toBe(first.id);
    expect(repository.listDiscoveryJobs()[0]).toMatchObject({ status: "queued", workflow: { id: "project-discovery", version: "1.1.0" } });
  });

  it("promotes a candidate transactionally with unknown scores represented as null", () => {
    database.prepare(`INSERT INTO web_search_leads
      (id,url,title,published_at,highlights_json,first_seen_at,last_seen_at,status)
      VALUES ('lead-new','https://example.com/new','新融资',NULL,'[]','2026-09-01','2026-09-01','discovered')`).run();
    database.prepare(`INSERT INTO project_candidates
      (id,lead_id,company_name,track,investor_names_json,signal_type,summary,confidence,status,model,prompt_version,created_at,updated_at,review_version)
      VALUES ('candidate-new','lead-new','星河芯片','半导体','["红杉中国"]','funding','完成新一轮融资',0.88,'pending_review','deepseek','p1','2026-09-01','2026-09-01',1)`).run();

    const result = repository.reviewCandidate("candidate-new", { decision: "promote", expectedVersion: 1 }, "idem-review-1", "user-demo");
    expect(result.status).toBe("promoted");
    expect(result.projectId).toBeTruthy();
    expect(database.prepare("SELECT score_urgency,score_quality,score_evidence FROM projects WHERE id=?").get(result.projectId)).toEqual({
      score_urgency: null, score_quality: null, score_evidence: null,
    });
    expect(database.prepare("SELECT count(*) AS count FROM assertions WHERE project_id=?").get(result.projectId)).toEqual({ count: 0 });
  });

  it("stores immutable judgments and projects them into one ordered timeline", () => {
    const first = repository.addJudgment("project-qiongxin", { expectedVersion: 1, thesis: "技术路线值得继续跟踪", stance: "positive", occurredAt: "2026-07-01T09:00:00.000Z" }, "idem-judgment-1", "user-demo");
    repository.addJudgment("project-qiongxin", { expectedVersion: first.projectVersion, thesis: "客户验证节奏低于预期", stance: "cautious", occurredAt: "2026-08-01T09:00:00.000Z" }, "idem-judgment-2", "user-demo");
    const timeline = repository.getTimeline("project-qiongxin");
    expect(timeline.filter((entry) => entry.kind === "judgment").map((entry) => entry.title)).toEqual([
      "客户验证节奏低于预期", "技术路线值得继续跟踪",
    ]);
  });

  it("only promotes knowledge drafts with a valid source and optimistic version", () => {
    const draft = repository.createKnowledgeDraft({ projectId: "project-qiongxin", track: "半导体", type: "risk", title: "客户验证风险", content: "客户名称与送测结果仍待核验。", sourceType: "evidence", sourceId: "evidence-project-qiongxin" });
    const approved = repository.reviewKnowledge(draft.id, { decision: "approve", expectedVersion: 1 }, "idem-knowledge-1", "user-demo");
    expect(approved).toMatchObject({ status: "approved", version: 2 });
    expect(() => repository.reviewKnowledge(draft.id, { decision: "reject", expectedVersion: 1 }, "idem-knowledge-2", "user-demo")).toThrow("版本冲突");
  });
});
