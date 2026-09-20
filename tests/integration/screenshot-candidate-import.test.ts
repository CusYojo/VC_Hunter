import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { SqliteWorkbenchRepository } from "@/workbench/repository";
import { importScreenshotCandidates, prepareScreenshotCandidates } from "@/services/screenshot-candidate-import";
import { SqliteBackgroundAgentRepository } from "@/repositories/background-agent";

const row = {
  companyName: "截图芯片", track: "半导体", eventDate: "2026-09-02", round: "A轮", amountText: "数亿元", valuation: null,
  investorNames: ["测试创投"], summary: "截图记录融资线索，待复核。", sources: [{ title: "公开报道", url: "https://example.com/news/1", publishedAt: "2026-09-03" }],
  verificationNotes: "金额和轮次待二次核验", sourceScreenshot: "截图1.png", sourceRow: 1, eventType: "融资",
};

describe("screenshot candidate import", () => {
  let database: DatabaseSync;
  beforeEach(() => { database = createDatabase(":memory:"); initializeDatabase(database); });
  afterEach(() => database.close());
  it("writes pending candidates and complete detail without creating projects, owners or fake confidence", () => {
    expect(importScreenshotCandidates(database, [row], { actor: "test" })).toMatchObject({ inserted: 1, updated: 0, skipped: 0 });
    const candidate = new SqliteWorkbenchRepository(database).listCandidates()[0];
    expect(candidate).toMatchObject({ companyName: row.companyName, status: "pending_review", projectId: null, confidence: null, eventDate: row.eventDate, round: "A轮", amountText: "数亿元", valuation: null, origin: "manual_screenshot", sources: row.sources, verificationNotes: row.verificationNotes, sourceScreenshot: "截图1.png", sourceRow: "1" });
    for (const table of ["projects", "companies", "investment_events", "discovery_jobs"]) expect(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count).toBe(0);
    expect(database.prepare("SELECT COUNT(*) AS count FROM candidate_details").get()?.count).toBe(1);
  });
  it("allows absent sources and null optional fields using a non-news internal archive URI", () => {
    importScreenshotCandidates(database, [{ ...row, eventDate: null, round: null, amountText: null, investorNames: [], sources: [], verificationNotes: null, sourceScreenshot: null, sourceRow: null, eventType: null, track: "工业软件" }], { actor: "test" });
    const candidate = new SqliteWorkbenchRepository(database).listCandidates()[0];
    expect(candidate).toMatchObject({ track: "待分类", rawTrack: "工业软件", eventDate: null, sources: [], valuation: null, confidence: null });
    expect(candidate.lead.url).toMatch(/^manual:\/\/screenshot\//);
  });
  it("validates the entire batch before any write and rejects invalid dates, unsafe URLs and duplicate keys", () => {
    expect(() => importScreenshotCandidates(database, [row, { ...row, companyName: "坏日期", eventDate: "2026-02-30" }], { actor: "test" })).toThrow();
    expect(database.prepare("SELECT COUNT(*) AS count FROM web_search_leads").get()?.count).toBe(0);
    expect(() => prepareScreenshotCandidates([{ ...row, sources: [{ title: "非法", url: "javascript:alert(1)", publishedAt: null }] }])).toThrow();
    expect(() => prepareScreenshotCandidates([row, { ...row, companyName: ` ${row.companyName} ` }])).toThrow(/重复/);
    expect(() => prepareScreenshotCandidates([{ ...row, companyName: "" }])).toThrow();
  });
  it("is idempotent on normalized company and event date and increments review version only for changed pending input", () => {
    importScreenshotCandidates(database, [row], { actor: "test" });
    expect(importScreenshotCandidates(database, [row], { actor: "test" })).toMatchObject({ inserted: 0, updated: 0, skipped: 1 });
    const changed = { ...row, summary: "新增核验说明" };
    expect(importScreenshotCandidates(database, [changed], { actor: "test" })).toMatchObject({ inserted: 0, updated: 1, skipped: 0 });
    expect(new SqliteWorkbenchRepository(database).listCandidates()[0]).toMatchObject({ summary: "新增核验说明", version: 2 });
  });
  it("does not overwrite dismissed or promoted candidates", () => {
    importScreenshotCandidates(database, [row], { actor: "test" });
    database.prepare("UPDATE project_candidates SET status='dismissed',review_version=2").run();
    expect(importScreenshotCandidates(database, [{ ...row, summary: "不能覆盖" }], { actor: "test" })).toMatchObject({ skipped: 1 });
    expect(new SqliteWorkbenchRepository(database).listCandidates()[0]).toMatchObject({ status: "dismissed", summary: row.summary, version: 2 });
  });
  it("orders the review queue by discovery time while preserving original financing dates", () => {
    importScreenshotCandidates(database, [{ ...row, companyName: "较早", eventDate: "2026-01-01" }, { ...row, companyName: "较新", eventDate: "2026-09-03" }, { ...row, companyName: "未标日期", eventDate: null }], { actor: "test" });
    database.prepare("UPDATE project_candidates SET created_at=? WHERE company_name=?").run("2026-09-04T02:00:00Z", "较早");
    database.prepare("UPDATE project_candidates SET created_at=? WHERE company_name=?").run("2026-09-04T01:00:00Z", "未标日期");
    database.prepare("UPDATE project_candidates SET created_at=? WHERE company_name=?").run("2026-09-03T01:00:00Z", "较新");
    const candidates = new SqliteWorkbenchRepository(database).listCandidates({}, new Date("2026-09-04T04:00:00Z"));
    expect(candidates.map(item => item.companyName)).toEqual(["较早", "未标日期", "较新"]);
    expect(candidates.map(item => item.eventDate)).toEqual(["2026-01-01", null, "2026-09-03"]);
  });
  it("rolls back the whole batch if a later detail write fails", () => {
    database.exec("CREATE TRIGGER fail_candidate BEFORE INSERT ON candidate_details WHEN NEW.raw_track='触发回滚' BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
    expect(() => importScreenshotCandidates(database, [row, { ...row, companyName: "失败条目", track: "触发回滚" }], { actor: "test" })).toThrow("test failure");
    for (const table of ["web_search_leads", "project_candidates", "candidate_details", "platform_timeline"]) expect(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count).toBe(0);
  });
  it("requires explicit valid classification before promoting an out-of-taxonomy track", () => {
    importScreenshotCandidates(database, [{ ...row, track: "先进制造" }], { actor: "test" });
    const repository = new SqliteWorkbenchRepository(database);
    const candidate = repository.listCandidates()[0];
    expect(() => repository.reviewCandidate(candidate.id, { decision: "promote", expectedVersion: 1 }, "review-unknown", "test")).toThrow(/赛道/);
    expect(database.prepare("SELECT COUNT(*) AS count FROM projects").get()?.count).toBe(0);
    const promoted = repository.reviewCandidate(candidate.id, { decision: "promote", expectedVersion: 1, track: "半导体" }, "review-classified", "test");
    expect(database.prepare("SELECT track,owner FROM projects WHERE id=?").get(promoted.projectId)).toMatchObject({ track: "半导体", owner: null });
    expect(repository.listCandidates()[0]).toMatchObject({ track: "半导体", rawTrack: "先进制造", status: "promoted" });
    expect(importScreenshotCandidates(database, [{ ...row, track: "先进制造", summary: "不能覆盖已转项" }], { actor: "test" })).toMatchObject({ skipped: 1, reviewedSkipped: 1 });
  });
  it("preserves existing AI candidates and deduplicates imported rows against their name and published date", () => {
    database.prepare(`INSERT INTO web_search_leads (id,url,title,published_at,highlights_json,first_seen_at,last_seen_at,status) VALUES ('old-lead','https://example.com/old','已有新闻','2026-09-02','[]','2026-09-04','2026-09-04','discovered')`).run();
    database.prepare(`INSERT INTO project_candidates (id,lead_id,company_name,track,investor_names_json,signal_type,summary,confidence,status,model,prompt_version,created_at,updated_at) VALUES ('old-candidate','old-lead','截图芯片','半导体','[]','funding','旧AI摘要',0.8,'pending_review','test','p1','2026-09-04','2026-09-04')`).run();
    expect(new SqliteWorkbenchRepository(database).listCandidates()[0]).toMatchObject({ origin: "ai", confidence: 0.8, round: null, amountText: null, valuation: null });
    expect(importScreenshotCandidates(database, [row], { actor: "test" })).toMatchObject({ inserted: 0, updated: 1 });
    expect(new SqliteWorkbenchRepository(database).listCandidates()).toHaveLength(1);
  });
  it("prevents subsequent AI qualification from overwriting a manually imported existing AI candidate", () => {
    database.prepare(`INSERT INTO web_search_leads (id,url,title,published_at,highlights_json,first_seen_at,last_seen_at,status) VALUES ('existing-ai-lead','https://example.com/existing','已有新闻','2026-09-02','[]','2026-09-04','2026-09-04','discovered')`).run();
    database.prepare("UPDATE web_search_leads SET publication_verified_at=? WHERE id='existing-ai-lead'").run("2026-09-02T00:00:00.000Z");
    const agent = new SqliteBackgroundAgentRepository(database);
    const assessment = { leadId: "existing-ai-lead", relevant: true, companyName: row.companyName, track: "AI" as const, investorNames: [], signalType: "investment" as const, summary: "初始AI摘要", confidence: 0.8 };
    agent.persistQualifiedCandidates([assessment], "2026-09-02T00:00:00.000Z", "initial-ai");
    importScreenshotCandidates(database, [row], { actor: "test" });
    const repository = new SqliteWorkbenchRepository(database);
    const before = repository.listCandidates()[0];
    agent.persistQualifiedCandidates([{ ...assessment, companyName: "模型改名", summary: "不得覆盖人工摘要", investorNames: ["模型猜测机构"] }], "2026-09-04T01:00:00.000Z", "repeated-ai");
    expect(repository.listCandidates()[0]).toEqual(before);
    expect(importScreenshotCandidates(database, [row], { actor: "test" })).toMatchObject({ inserted: 0, updated: 0, skipped: 1 });
    expect(repository.listCandidates()[0]).toEqual(before);
  });
});
