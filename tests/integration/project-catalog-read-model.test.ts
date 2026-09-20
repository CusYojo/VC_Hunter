import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { loadProjectCatalog } from "@/workbench/project-catalog-read-model";
import { filterProjectCatalog } from "@/workbench/project-catalog";
import { editCandidate } from "@/workbench/candidate-admin";
import { orderCandidateQueue } from "@/workbench/candidate-queue";
let db: DatabaseSync;
const admin = { tenantId: "org", accountId: "admin", user: { id: "admin" }, roles: ["org_admin"] };
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-05T10:00:00Z")); db = createDatabase(":memory:"); initializeDatabase(db); });
afterEach(() => { db.close(); vi.useRealTimers(); });
function project(id: string, eventAt: string, discoveryAt: string) {
  db.prepare("INSERT INTO companies(id,legal_name,aliases_json,region_scope) VALUES(?,?,'[]','CN')").run(id, id);
  db.prepare(`INSERT INTO projects(id,company_id,name,track,subtrack,discovery_at,discovery_reason,status,executive_summary,technology_stage,urgency_score,quality_score,evidence_quality,signal_type,latest_event_at,risk_flags_json,open_questions_json,last_researched_at)
    VALUES(?,?,?,'AI','',?,'发现原因','new','','',0,0,0,'funding',?,'[]','[]','')`).run(id, id, id, discoveryAt, eventAt);
}
function candidate(id: string, createdAt: string) {
  db.prepare("INSERT INTO web_search_leads(id,url,title,highlights_json,first_seen_at,last_seen_at,status) VALUES(?,?,?,'[]',?,?,'discovered')").run(id, `https://example.test/${id}`, id, createdAt, createdAt);
  db.prepare("INSERT INTO project_candidates(id,lead_id,company_name,track,investor_names_json,signal_type,summary,confidence,status,model,prompt_version,created_at,updated_at) VALUES(?,?,'同名公司','AI','[]','funding','旧摘要',0.8,'pending_review','fixture','v1',?,?)").run(id, id, createdAt, createdAt);
}
function intelligenceCandidate(id: string, createdAt: string, summary = "新项目投资摘要") {
  db.prepare(`INSERT INTO intelligence_candidates(
    id,entity_type,candidate_kind,subject_name,track,subtrack,city,signal_type,event_date,source_channel,
    discovery_reason,investment_summary,investment_highlights_json,priority_band,scores_json,completeness_level,
    open_questions_json,missing_fields_json,status,review_version,details_json,content_hash,created_at,updated_at
  ) VALUES(?,'company','new_entity','新项目公司','AI','Agent 基础设施','杭州','funding','2026-09-10','manual_codex',
    '近一个月融资报道',?,'["Agent 数据闭环"]','A','{"technology":4,"team":4,"commercial":2,"signal":4,"evidence":4}','L1',
    '["收入与客户验证待核"]','[]','pending_review',1,'{}',?,?,?)`)
    .run(id, summary, `hash-${id}`, createdAt, createdAt);
}
it("uses discovery only as fallback and picks valid timeline instants before applying inclusive Shanghai filters", () => {
  project("fallback", "", "2026-09-03T16:00:00Z");
  project("event", "2026-09-03T15:59:59Z", "2026-09-05T10:00:00Z");
  project("timeline", "2026-09-01T00:00:00Z", "2026-09-05T10:00:00Z");
  for (const [id, at] of [["older", "2026-09-04T10:00:00+08:00"], ["newer", "2026-09-04T03:00:00Z"], ["invalid", "invalid"]]) {
    db.prepare("INSERT INTO platform_timeline(id,event_type,subject_type,subject_id,project_id,actor,summary,metadata_json,trace_id,created_at) VALUES(?,'project.updated','project','timeline','timeline','admin',?,'{}',?,?)").run(id, id, id, at);
  }
  const rows = loadProjectCatalog(db);
  expect(rows.find(row => row.id === "fallback")?.latestAt).toBe("2026-09-03T16:00:00Z");
  expect(rows.find(row => row.id === "event")?.latestAt).toBe("2026-09-03T15:59:59Z");
  expect(rows.find(row => row.id === "timeline")).toMatchObject({ latestAt: "2026-09-04T03:00:00Z", summary: "newer" });
  expect(filterProjectCatalog(rows, { from: "2026-09-04", to: "2026-09-04" }).map(row => row.id)).toEqual(["timeline", "fallback"]);
});
it("uses real candidate edit audits while retaining duplicate names and ignoring automatic archive or reorder timestamps", () => {
  candidate("edited", "2026-08-01T00:00:00Z"); candidate("untouched", "2026-08-01T00:00:00Z");
  editCandidate(db, admin, "edited", { expectedVersion: 1, companyName: "同名公司", track: "AI", summary: "人工最新摘要", investorNames: [], eventDate: "2026-09-04", round: "A轮", amountText: "未披露" }, "edit");
  vi.setSystemTime(new Date("2026-09-06T10:00:00Z"));
  orderCandidateQueue(db, admin, { items: [{ id: "edited", expectedVersion: 2, rank: 1 }] }, "order");
  const rows = loadProjectCatalog(db);
  expect(rows).toHaveLength(2);
  expect(rows.find(row => row.id === "edited")).toMatchObject({ latestAt: "2026-09-05T10:00:00.000Z", summary: "人工最新摘要", candidate: { reviewedAt: null, archivedAt: "2026-09-06T10:00:00.000Z" } });
  expect(rows.find(row => row.id === "untouched")?.latestAt).toBe("2026-08-01T00:00:00Z");
  expect(db.prepare("SELECT count(*) AS n FROM project_candidates").get()?.n).toBe(2);
});
it("adds unified company discoveries to the timeline once and keeps legacy backfills from appearing twice", () => {
  candidate("legacy", "2026-09-09T00:00:00Z");
  intelligenceCandidate("unified-older", "2026-09-10T01:00:00Z", "较早采集的同一融资信息");
  intelligenceCandidate("unified-newer", "2026-09-10T03:00:00Z", "较晚核验的同一融资信息");

  const rows = loadProjectCatalog(db);

  expect(rows.filter(row => row.name === "同名公司")).toHaveLength(1);
  expect(rows.filter(row => row.name === "新项目公司")).toHaveLength(1);
  expect(rows.find(row => row.name === "新项目公司")).toMatchObject({
    id: "unified-newer",
    kind: "intelligence",
    latestAt: "2026-09-10T00:00:00+08:00",
    statusLabel: "新项目发现 · 待审核",
  });
});
