import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
import { SqliteInvestorDirectoryRepository } from "@/repositories/investor-directory";
import { buildFundingDashboard } from "@/repositories/funding-dashboard";
import { SqliteDealTimelineRepository } from "@/workbench/deal-timeline";
import type { TeamMember } from "@/workbench/contracts";

const TEAM: TeamMember[] = [
  { id: "user-demo", name: "示例经理", role: "投资经理", tracks: ["半导体"], subtracks: [], currentLoad: 0 },
  { id: "user-linchuan", name: "林川", role: "分析师", tracks: ["AI"], subtracks: [], currentLoad: 0 },
];

describe("investor directory repository", () => {
  let database: DatabaseSync;
  let repository: SqliteInvestorDirectoryRepository;

  beforeEach(() => {
    database = createDatabase(":memory:");
    initializeDatabase(database);
    seedDemoData(database);
    repository = new SqliteInvestorDirectoryRepository(database);
  });

  afterEach(() => database.close());

  it("creates an investor and returns it in a paginated list", () => {
    const created = repository.create(
      { name: "测试硬科技基金", institutionType: "financial_vc", focusTracks: ["半导体"], priority: 1, status: "verified" },
      "user-demo",
    );
    expect(created.id).toBeTruthy();
    expect(created.version).toBe(1);

    const page = repository.list({ query: "测试硬科技", perPage: 10, page: 1 });
    expect(page.total).toBeGreaterThanOrEqual(1);
    expect(page.items.some((item) => item.name === "测试硬科技基金")).toBe(true);
    expect(page.perPage).toBe(10);
  });

  it("upsertMany merges by name without overwriting maintained fields", () => {
    repository.create(
      { name: "合并基金", institutionType: "financial_vc", focusTracks: ["AI"], notes: "人工维护的备注" },
      "user-demo",
    );
    const result = repository.upsertMany(
      [
        { name: "合并基金", institutionType: "financial_vc", focusTracks: ["AI"], notes: "" },
        { name: "新增基金", institutionType: "cvc", focusTracks: ["商业航天"] },
      ],
      "user-demo",
    );
    expect(result.inserted).toBe(1);
    expect(result.updated + result.skipped).toBe(1);

    const merged = repository.findByName("合并基金");
    expect(merged?.notes).toBe("人工维护的备注");
  });

  it("keeps undisclosed fund size as null rather than zero", () => {
    const created = repository.create(
      { name: "留空基金", institutionType: "other", focusTracks: [] },
      "user-demo",
    );
    expect(created.fundSize).toBeNull();
  });

  it("preserves status and priority during a partial update", () => {
    const created = repository.create(
      { name: "部分更新基金", institutionType: "cvc", focusTracks: ["AI"], status: "active", priority: 1 },
      "user-demo",
    );

    const updated = repository.update(created.id, { notes: "仅更新备注" }, created.version, "user-demo");

    expect(updated.status).toBe("active");
    expect(updated.priority).toBe(1);
    expect(updated.notes).toBe("仅更新备注");
  });

  it("rejects duplicate names, missing records, and stale updates", () => {
    const first = repository.create(
      { name: "冲突基金甲", institutionType: "financial_vc", focusTracks: ["AI"] },
      "user-demo",
    );
    repository.create(
      { name: "冲突基金乙", institutionType: "cvc", focusTracks: ["半导体"] },
      "user-demo",
    );

    expect(() => repository.create(
      { name: first.name, institutionType: "financial_vc", focusTracks: [] },
      "user-demo",
    )).toThrow("机构名称已存在");
    expect(() => repository.update("missing", { notes: "不存在" }, 1, "user-demo")).toThrow("机构不存在");
    expect(() => repository.update(first.id, { notes: "过期写入" }, first.version + 1, "user-demo")).toThrow("版本冲突");
    expect(() => repository.update(first.id, { name: "冲突基金乙" }, first.version, "user-demo")).toThrow("机构名称已存在");
  });

  it("filters by directory fields and clamps pagination", () => {
    const target = repository.create(
      {
        name: "筛选目标基金",
        englishName: "Filter Target Capital",
        aliases: ["目标资本"],
        institutionType: "cvc",
        headquarters: "杭州",
        focusTracks: ["商业航天"],
        status: "active",
        priority: 1,
      },
      "user-demo",
    );

    const filtered = repository.list({
      query: "目标资本",
      status: "active",
      institutionType: "cvc",
      track: "商业航天",
      priority: 1,
      page: 0,
      perPage: 1_000,
    });
    expect(filtered.items.map((item) => item.id)).toEqual([target.id]);
    expect(filtered.page).toBe(1);
    expect(filtered.perPage).toBe(500);
    expect(repository.list({ status: "paused" }).items.some((item) => item.id === target.id)).toBe(false);
    expect(repository.list({ institutionType: "pe" }).items.some((item) => item.id === target.id)).toBe(false);
    expect(repository.list({ track: "AI" }).items.some((item) => item.id === target.id)).toBe(false);
    expect(repository.list({ priority: 3 }).items.some((item) => item.id === target.id)).toBe(false);
  });
});

describe("funding dashboard aggregation", () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = createDatabase(":memory:");
    initializeDatabase(database);
    seedDemoData(database);
  });

  afterEach(() => database.close());

  it("returns totals and window over investment events", () => {
    const view = buildFundingDashboard(database, { windowDays: 365 });
    expect(view.windowDays).toBe(365);
    expect(view.totals.events).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(view.byTrack)).toBe(true);
    expect(Array.isArray(view.latestEvents)).toBe(true);
    // 未披露金额单独计数，不并入已披露总额
    expect(view.totals.disclosedCny).toBeGreaterThanOrEqual(0);
    expect(view.totals.undisclosed).toBeGreaterThanOrEqual(0);
  });

  it("clamps an out-of-range window into the allowed bounds", () => {
    const view = buildFundingDashboard(database, { windowDays: 5 });
    expect(view.windowDays).toBe(7);
  });
});

describe("deal timeline repository", () => {
  let database: DatabaseSync;
  let repository: SqliteDealTimelineRepository;
  const projectId = "project-qiongxin";

  beforeEach(() => {
    database = createDatabase(":memory:");
    initializeDatabase(database);
    seedDemoData(database);
    repository = new SqliteDealTimelineRepository(database, TEAM);
  });

  afterEach(() => database.close());

  it("creates a milestone and lists it under its stage", () => {
    const milestone = repository.createMilestone(
      projectId,
      { stage: "contact", title: "首次沟通", status: "done" },
      "idem-milestone-1",
      "user-demo",
    );
    expect(milestone.stage).toBe("contact");
    expect(milestone.stageLabel).toBe("接触");

    const all = repository.listMilestones(projectId);
    expect(all.some((item) => item.id === milestone.id)).toBe(true);
  });

  it("syncs project progress to the furthest active milestone stage without changing owners", () => {
    database.prepare(`INSERT INTO project_responsibles(project_id,member_name,member_id,position,assigned_at)
      VALUES (?, '示例经理', 'user-demo', 0, '2026-09-01T00:00:00.000Z'),
             (?, '林川', 'user-linchuan', 1, '2026-09-01T00:00:00.000Z')`).run(projectId, projectId);

    repository.createMilestone(projectId, { stage: "dd", title: "技术尽调", status: "in_progress" }, "idem-progress-dd", "user-demo");
    repository.createMilestone(projectId, { stage: "contact", title: "补签 NDA", status: "planned" }, "idem-progress-contact", "user-demo");

    expect(database.prepare("SELECT status,deal_stage,technology_stage,version FROM projects WHERE id=?").get(projectId)).toEqual({ status: "dd", deal_stage: "dd", technology_stage: "customer_qualification", version: 2 });
    expect(database.prepare("SELECT member_name,member_id,position FROM project_responsibles WHERE project_id=? ORDER BY position").all(projectId)).toEqual([
      { member_name: "示例经理", member_id: "user-demo", position: 0 },
      { member_name: "林川", member_id: "user-linchuan", position: 1 },
    ]);
  });

  it("moves progress forward and does not automatically regress when later nodes are cancelled or moved back", () => {
    const dd = repository.createMilestone(projectId, { stage: "dd", title: "业务尽调", status: "done" }, "idem-progress-dd-done", "user-demo");
    const ic = repository.createMilestone(projectId, { stage: "ic", title: "投决会", status: "in_progress" }, "idem-progress-ic", "user-demo");

    expect(database.prepare("SELECT status,deal_stage,technology_stage,version FROM projects WHERE id=?").get(projectId)).toEqual({ status: "ic", deal_stage: "ic", technology_stage: "customer_qualification", version: 3 });
    repository.updateMilestone(projectId, ic.id, { expectedVersion: ic.version, status: "cancelled" }, "idem-progress-cancel", "user-demo");
    expect(database.prepare("SELECT status,deal_stage,technology_stage,version FROM projects WHERE id=?").get(projectId)).toEqual({ status: "ic", deal_stage: "ic", technology_stage: "customer_qualification", version: 3 });

    const moved = repository.updateMilestone(projectId, dd.id, { expectedVersion: dd.version, stage: "pre_ic" }, "idem-progress-move", "user-demo");
    expect(moved.stage).toBe("pre_ic");
    expect(database.prepare("SELECT status,deal_stage,technology_stage,version FROM projects WHERE id=?").get(projectId)).toEqual({ status: "ic", deal_stage: "ic", technology_stage: "customer_qualification", version: 3 });
  });

  it("records derived project progress in the milestone audit and does not advance twice on replay", () => {
    const first = repository.createMilestone(projectId, { stage: "initiation", title: "立项会" }, "idem-progress-audit", "user-demo");
    const projectAfterFirst = database.prepare("SELECT status,deal_stage,technology_stage,version FROM projects WHERE id=?").get(projectId);
    expect(repository.createMilestone(projectId, { stage: "initiation", title: "立项会" }, "idem-progress-audit", "user-demo").id).toBe(first.id);
    expect(database.prepare("SELECT status,deal_stage,technology_stage,version FROM projects WHERE id=?").get(projectId)).toEqual(projectAfterFirst);

    const event = database.prepare("SELECT metadata_json FROM platform_timeline WHERE event_type='milestone.created' AND subject_id=?").get(first.id) as { metadata_json: string };
    expect(JSON.parse(event.metadata_json)).toMatchObject({
      stage: "initiation",
      projectProgress: {
        before: { status: "new", dealStage: "contact", dealStageLabel: "接触", version: 1 },
        after: { status: "researching", dealStage: "initiation", dealStageLabel: "立项", version: 2 },
      },
    });
  });

  it("rolls milestone and project progress back together when timeline auditing fails", () => {
    const before = database.prepare("SELECT status,deal_stage,technology_stage,version,latest_event_at FROM projects WHERE id=?").get(projectId);
    database.exec("CREATE TRIGGER fail_milestone_audit BEFORE INSERT ON platform_timeline WHEN NEW.event_type='milestone.created' BEGIN SELECT RAISE(ABORT, 'audit failed'); END;");

    expect(() => repository.createMilestone(projectId, { stage: "ic", title: "投决失败" }, "idem-progress-failure", "user-demo")).toThrow("audit failed");
    expect(database.prepare("SELECT status,deal_stage,technology_stage,version,latest_event_at FROM projects WHERE id=?").get(projectId)).toEqual(before);
    expect(database.prepare("SELECT count(*) AS count FROM project_milestones WHERE project_id=? AND title='投决失败'").get(projectId)).toEqual({ count: 0 });
  });

  it("is idempotent when the same idempotency key is replayed", () => {
    const first = repository.createMilestone(projectId, { stage: "dd", title: "技术尽调" }, "idem-dup", "user-demo");
    const second = repository.createMilestone(projectId, { stage: "dd", title: "技术尽调" }, "idem-dup", "user-demo");
    expect(second.id).toBe(first.id);
  });

  it("@mention in a comment notifies the mentioned member", () => {
    repository.addComment(
      projectId,
      { body: "请 @林川 补充技术尽调结论", milestoneId: null },
      "idem-comment-1",
      "user-demo",
    );
    const inbox = repository.listNotifications("user-linchuan", { unreadOnly: true });
    expect(inbox.length).toBe(1);
    expect(inbox[0].kind).toBe("mention");
    expect(repository.countUnread("user-linchuan")).toBe(1);

    const marked = repository.markNotification("user-linchuan", inbox[0].id, true);
    expect(marked.readAt).not.toBeNull();
    expect(repository.countUnread("user-linchuan")).toBe(0);
  });

  it("enforces optimistic concurrency on milestone updates", () => {
    const milestone = repository.createMilestone(projectId, { stage: "ic", title: "投决会" }, "idem-ic", "user-demo");
    const projectBefore = database.prepare("SELECT status,deal_stage,technology_stage,version,latest_event_at FROM projects WHERE id=?").get(projectId);
    expect(() =>
      repository.updateMilestone(
        projectId,
        milestone.id,
        { expectedVersion: milestone.version + 1, status: "done" },
        "idem-ic-update",
        "user-demo",
      ),
    ).toThrow();
    expect(database.prepare("SELECT status,deal_stage,technology_stage,version,latest_event_at FROM projects WHERE id=?").get(projectId)).toEqual(projectBefore);
  });
});
