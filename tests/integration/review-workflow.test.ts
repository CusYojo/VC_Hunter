import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { SqliteProjectRepository } from "@/repositories/projects";
import { reviewProject } from "@/services/project-review";
import { assignProject } from "@/services/project-assignment";
import { requestEvidence } from "@/services/evidence-request";
import { SqliteDealTimelineRepository } from "@/workbench/deal-timeline";

describe("project review workflow", () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = createDatabase(":memory:");
    initializeDatabase(database);
    seedDemoData(database);
  });

  afterEach(() => database.close());

  it("updates status and writes an append-only audit event", () => {
    const repository = new SqliteProjectRepository(database);
    const result = reviewProject(repository, {
      projectId: "project-qiongxin",
      expectedVersion: 1,
      status: "researching",
      reviewer: "demo-investment-manager",
      note: "技术节点证据充分，进入主动研究。",
      requestId: "request-review-1",
    });

    expect(result.status).toBe("researching");
    expect(result.version).toBe(2);
    expect(repository.listAuditEvents("project-qiongxin")).toHaveLength(1);
  });

  it("persists and audits an exact manual deal stage", () => {
    const repository = new SqliteProjectRepository(database);
    const result = reviewProject(repository, {
      projectId: "project-qiongxin",
      expectedVersion: 1,
      status: "ic",
      dealStage: "pre_ic",
      reviewer: "demo-investment-manager",
      note: "手动调整到内决会。",
      requestId: "request-manual-stage-1",
    });

    expect(result).toEqual({ status: "ic", dealStage: "pre_ic", dealStageLabel: "内决会", version: 2 });
    expect(database.prepare("SELECT status,deal_stage,technology_stage,version FROM projects WHERE id='project-qiongxin'").get()).toEqual({ status: "ic", deal_stage: "pre_ic", technology_stage: "customer_qualification", version: 2 });
    const audit = repository.listAuditEvents("project-qiongxin")[0];
    expect(audit).toMatchObject({ action: "project.reviewed", before: { status: "new", dealStage: "contact", version: 1 }, after: { status: "ic", dealStage: "pre_ic", dealStageLabel: "内决会", version: 2 } });
    expect(database.prepare("SELECT event_type,summary FROM platform_timeline WHERE project_id=? ORDER BY created_at DESC,id DESC LIMIT 1").get("project-qiongxin")).toMatchObject({ event_type: "project.stage_manually_selected", summary: "项目阶段已手动调整为 内决会" });
  });

  it("rejects an idempotency key reused for another project or stage", () => {
    const repository = new SqliteProjectRepository(database);
    const projectIds = repository.list().map((project) => project.id);
    const otherProjectId = projectIds.find((id) => id !== "project-qiongxin")!;
    reviewProject(repository, {
      projectId: "project-qiongxin", expectedVersion: 1, status: "dd", dealStage: "dd",
      reviewer: "user-demo", note: "手动调整到尽调。", requestId: "manual-reused-key",
    });

    expect(() => reviewProject(repository, {
      projectId: otherProjectId, expectedVersion: 1, status: "dd", dealStage: "dd",
      reviewer: "user-demo", note: "手动调整到尽调。", requestId: "manual-reused-key",
    })).toThrow(/幂等键/);
    expect(() => reviewProject(repository, {
      projectId: "project-qiongxin", expectedVersion: 1, status: "ic", dealStage: "ic",
      reviewer: "user-demo", note: "手动调整到投决会。", requestId: "manual-reused-key",
    })).toThrow(/幂等键/);
    expect(() => reviewProject(repository, {
      projectId: "project-qiongxin", expectedVersion: 1, status: "dd",
      reviewer: "user-demo", note: "手动调整到尽调。", requestId: "manual-reused-key",
    })).toThrow(/幂等键/);
    expect(repository.findById(otherProjectId)?.version).toBe(1);
  });

  it("allows a second manual choice to move backward, then only auto-advances for a later-stage node", () => {
    const repository = new SqliteProjectRepository(database);
    const timeline = new SqliteDealTimelineRepository(database, [
      { id: "user-demo", name: "示例经理", role: "投资经理", tracks: ["半导体"], subtracks: [], currentLoad: 0 },
    ]);
    const first = reviewProject(repository, { projectId: "project-qiongxin", expectedVersion: 1, status: "ic", dealStage: "ic", reviewer: "user-demo", note: "手动选择投决会。", requestId: "manual-ic" });
    const second = reviewProject(repository, { projectId: "project-qiongxin", expectedVersion: first.version, status: "contacting", dealStage: "contact", reviewer: "user-demo", note: "重新调整回接触阶段。", requestId: "manual-contact" });

    timeline.createMilestone("project-qiongxin", { stage: "contact", title: "补录首次沟通" }, "node-contact-after-manual", "user-demo");
    expect(database.prepare("SELECT status,deal_stage,technology_stage FROM projects WHERE id='project-qiongxin'").get()).toEqual({ status: "contacting", deal_stage: "contact", technology_stage: "customer_qualification" });
    timeline.createMilestone("project-qiongxin", { stage: "dd", title: "启动技术尽调" }, "node-dd-after-manual", "user-demo");
    expect(database.prepare("SELECT status,deal_stage,technology_stage,version FROM projects WHERE id='project-qiongxin'").get()).toEqual({ status: "dd", deal_stage: "dd", technology_stage: "customer_qualification", version: second.version + 1 });
  });

  it("rolls a manual stage write back when audit storage fails", () => {
    const repository = new SqliteProjectRepository(database);
    const before = repository.findById("project-qiongxin");
    database.exec("CREATE TRIGGER fail_manual_stage_audit BEFORE INSERT ON audit_log WHEN NEW.action='project.reviewed' BEGIN SELECT RAISE(ABORT,'audit failed'); END");

    expect(() => reviewProject(repository, { projectId: "project-qiongxin", expectedVersion: 1, status: "dd", dealStage: "dd", reviewer: "user-demo", note: "手动调整到尽调。", requestId: "manual-failure" })).toThrow("audit failed");
    expect(repository.findById("project-qiongxin")).toEqual(before);
  });

  it("rejects stale reviews to prevent lost updates", () => {
    const repository = new SqliteProjectRepository(database);
    reviewProject(repository, {
      projectId: "project-qiongxin",
      expectedVersion: 1,
      status: "researching",
      reviewer: "manager-a",
      note: "first review",
      requestId: "request-review-2",
    });

    expect(() =>
      reviewProject(repository, {
        projectId: "project-qiongxin",
        expectedVersion: 1,
        status: "pass",
        reviewer: "manager-b",
        note: "stale review",
        requestId: "request-review-3",
      }),
    ).toThrow(/version conflict/i);
  });

  it("requires a substantive reason before passing a project", () => {
    const repository = new SqliteProjectRepository(database);
    expect(() => reviewProject(repository, { projectId: "project-qiongxin", expectedVersion: 1, status: "pass", reviewer: "manager-a", note: "太早", requestId: "request-pass" })).toThrow(/clear reason/i);
  });

  it("assigns a project with optimistic locking and an audit event", () => {
    const repository = new SqliteProjectRepository(database);
    const result = assignProject(repository, {
      projectId: "project-qiongxin",
      expectedVersion: 1,
      assignee: "示例经理",
      reviewer: "示例经理",
      requestId: "request-assignment-1",
    });

    expect(result).toEqual({ owner: "示例经理", owners: ["示例经理"], version: 2 });
    expect(repository.findById("project-qiongxin")?.owner).toBe("示例经理");
    expect(repository.listAuditEvents("project-qiongxin")[0].action).toBe("project.assigned");
  });

  it("persists an evidence request as a distinct audited review action", () => {
    const repository = new SqliteProjectRepository(database);
    const result = requestEvidence(repository, {
      projectId: "project-qiongxin",
      expectedVersion: 1,
      reviewer: "演示复核员",
      note: "保留冲突并请求独立来源补证。",
      requestId: "request-evidence-1",
    });

    expect(result).toEqual({ status: "requested", version: 2 });
    expect(repository.hasEvidenceRequest("project-qiongxin")).toBe(true);
    expect(repository.listAuditEvents("project-qiongxin")[0].action).toBe("project.evidence_requested");
  });
});
