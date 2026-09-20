import { afterEach, beforeEach, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { candidateQueueMigration } from "@/workbench/candidate-queue-migration";
import { archiveUnassignedCandidates, filterCandidateQueue, orderCandidateQueue } from "@/workbench/candidate-queue";
import type { CandidateView } from "@/workbench/candidate-details";
let db: DatabaseSync;
const now = new Date("2026-09-04T02:00:00.000Z");
const admin = { tenantId: "org", accountId: "alice", user: { id: "member-a" }, roles: ["org_admin"] };
function seed(id: string, at: string, status = "pending_review") {
  db.prepare("INSERT INTO web_search_leads(id,url,title,highlights_json,first_seen_at,last_seen_at,status) VALUES (?,?,?,'[]',?,?,'discovered')").run(id, `https://example.test/${id}`, id, at, at);
  db.prepare("INSERT INTO project_candidates(id,lead_id,company_name,track,investor_names_json,signal_type,summary,confidence,status,model,prompt_version,created_at,updated_at) VALUES (?,?,?,'AI','[]','funding','摘要',0.9,?,'fixture','v1',?,?)").run(id,id,id,status,at,at);
}
function view(id: string, createdAt: string, status = "pending_review", rank = 1000000): CandidateView {
  return { id, createdAt, status, queueRank: rank, companyName: id, track: "AI", investorNames: [], signalType: "funding", summary: "机器人芯片", confidence: 0.9, version: 1, lead: { title: id, url: "https://example.test", publishedAt: createdAt, publicationVerifiedAt: createdAt }, projectId: null };
}
beforeEach(() => { db=createDatabase(":memory:"); initializeDatabase(db); if (!db.prepare("PRAGMA table_info(project_candidates)").all().some(row => row.name === "archived_at")) db.exec(candidateQueueMigration.upSql); });
afterEach(() => db.close());
it("archives only pending unassigned candidates strictly older than seven days and retains originals", () => {
  seed("old", "2026-08-28T01:59:59.000Z"); seed("boundary", "2026-08-28T02:00:00.000Z"); seed("recent", "2026-09-03T01:00:00.000Z"); seed("admitted", "2026-08-01T01:00:00.000Z", "promoted"); seed("rejected", "2026-08-01T01:00:00.000Z", "dismissed");
  db.prepare("INSERT INTO candidate_documents(candidate_id,original_name,media_type,document_kind,byte_length,bytes,created_by,created_at) VALUES ('old','原件.txt','text/plain','text',3,?,'author',?)").run(Buffer.from("raw"), now.toISOString());
  expect(archiveUnassignedCandidates(db, now)).toBe(1); expect(archiveUnassignedCandidates(db, now)).toBe(0);
  expect(db.prepare("SELECT archived_at,review_version FROM project_candidates WHERE id='old'").get()).toMatchObject({ archived_at: now.toISOString(), review_version: 2 });
  expect(db.prepare("SELECT archived_at FROM project_candidates WHERE id='boundary'").get()?.archived_at).toBeNull();
  expect(db.prepare("SELECT count(*) n FROM candidate_documents").get()?.n).toBe(1);
  expect(db.prepare("SELECT count(*) n FROM platform_timeline WHERE event_type='candidate.archived'").get()?.n).toBe(1);
});
it("uses Shanghai calendar dates for today and recent seven days, with exact date and keyword search", () => {
  const rows = [view("today", "2026-09-03T16:00:00Z"), view("yesterday", "2026-09-03T15:59:59Z"), view("day7", "2026-08-28T16:00:00Z"), view("day8", "2026-08-28T15:59:59Z")];
  expect(filterCandidateQueue(rows, { period: "today" }, now).map(row => row.id)).toEqual(["today"]);
  expect(filterCandidateQueue(rows, { period: "week" }, now)).toHaveLength(3);
  expect(filterCandidateQueue(rows, { period: "all", q: "不存在" }, now)).toEqual([]);
  expect(filterCandidateQueue(rows, { period: "today", date: "2026-09-03", q: "机器人" }, now).map(row => row.id)).toEqual(["yesterday"]);
  expect(() => filterCandidateQueue(rows, { date: "2026-02-30" }, now)).toThrow();
});
it("always leaves rejections at the bottom of their day while honoring administrative rank", () => {
  const rows = [view("rejected", "2026-09-04T01:00:00Z", "dismissed", 0), view("first", "2026-09-04T00:00:00Z", "pending_review", 1), view("second", "2026-09-04T01:00:00Z", "pending_review", 2), view("yesterday", "2026-09-03T01:00:00Z", "pending_review", 0)];
  expect(filterCandidateQueue(rows, { period: "all" }, now).map(row => row.id)).toEqual(["first", "second", "rejected", "yesterday"]);
});
it("restricts reordering to admins and rolls stale batches back atomically with stable replay", () => {
  seed("one", now.toISOString()); seed("two", now.toISOString());
  const body = { items: [{ id: "one", expectedVersion: 1, rank: 0 }, { id: "two", expectedVersion: 1, rank: 1 }] };
  expect(() => orderCandidateQueue(db, { ...admin, roles: ["investment_manager"] }, body, "order")).toThrow(/管理员/);
  const saved = orderCandidateQueue(db, admin, body, "order");
  expect(saved.items).toEqual([{ id: "one", version: 2, queueRank: 0 }, { id: "two", version: 2, queueRank: 1 }]);
  expect(orderCandidateQueue(db, admin, body, "order")).toEqual(saved);
  expect(() => orderCandidateQueue(db, admin, { items: [{ id: "one", expectedVersion: 2, rank: 5 }, { id: "two", expectedVersion: 1, rank: 4 }] }, "stale")).toThrow(/版本冲突/);
  expect(db.prepare("SELECT queue_rank FROM project_candidates WHERE id='one'").get()?.queue_rank).toBe(0);
  expect(() => orderCandidateQueue(db, admin, { items: [{ id: "one", expectedVersion: 2, rank: 8 }] }, "order")).toThrow(/幂等/);
});
it("moves a single item within an unbounded same-day group and preserves other day/status ordering", () => {
  for (let i=0; i<105; i++) seed(`item-${String(i).padStart(3,"0")}`, now.toISOString());
  seed("dismissed", now.toISOString(), "dismissed");
  const moved = orderCandidateQueue(db, admin, { move: { id: "item-100", expectedVersion: 1, direction: "up" } }, "move");
  expect(moved.items).toHaveLength(105);
  const order = db.prepare("SELECT id FROM project_candidates WHERE status='pending_review' ORDER BY queue_rank").all().map(row => row.id);
  expect(order.slice(98,102)).toEqual(["item-098", "item-100", "item-099", "item-101"]);
  expect(db.prepare("SELECT review_version FROM project_candidates WHERE id='dismissed'").get()?.review_version).toBe(1);
  expect(orderCandidateQueue(db, admin, { move: { id: "item-100", expectedVersion: 1, direction: "up" } }, "move")).toEqual(moved);
  expect(() => orderCandidateQueue(db, admin, { move: { id: "item-100", expectedVersion: 1, direction: "down" } }, "stale-move")).toThrow(/版本冲突/);
});
it("hides stale or undated AI news from date views but preserves manual uploads and the full historical library", () => {
  const at = now.toISOString();
  const rows = [
    { ...view("fresh", at), origin: "ai" as const, lead: { title: "fresh", url: "https://news.test/fresh", publishedAt: "2026-09-03T16:00:00Z", publicationVerifiedAt: at } },
    { ...view("stale", at), origin: "ai" as const, lead: { title: "stale", url: "https://news.test/stale", publishedAt: "2025-09-04", publicationVerifiedAt: at } },
    { ...view("yesterday-news", at), origin: "ai" as const, lead: { title: "yesterday", url: "https://news.test/yesterday", publishedAt: "2026-09-03", publicationVerifiedAt: at } },
    { ...view("undated", at), origin: "ai" as const, lead: { title: "undated", url: "https://news.test/undated", publishedAt: null } },
    { ...view("manual", at), origin: "manual_screenshot" as const },
  ];
  expect(filterCandidateQueue(rows, { period: "today" }, now).map(row => row.id)).toEqual(["fresh", "manual"]);
  expect(filterCandidateQueue(rows, { period: "week" }, now).map(row => row.id)).toEqual(["fresh", "manual", "yesterday-news"]);
  expect(filterCandidateQueue(rows, { period: "all" }, now)).toHaveLength(5);
  expect(filterCandidateQueue(rows, { period: "all", date: "2026-09-04" }, now).map(row => row.id)).toEqual(["fresh", "manual"]);
});
it("requires verified publication provenance for AI news in time-filtered views", () => {
  const row = { ...view("unverified", now.toISOString()), origin: "ai" as const, lead: { title: "claim", url: "https://news.test/claim", publishedAt: "2026-09-04" } };
  expect(filterCandidateQueue([row], { period: "today" }, now)).toEqual([]);
  expect(filterCandidateQueue([row], { period: "all" }, now)).toEqual([row]);
});
