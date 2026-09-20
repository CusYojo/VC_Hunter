import { afterEach, beforeEach, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { editCandidate } from "@/workbench/candidate-admin";
let db: DatabaseSync;
const owner = { tenantId: "org", accountId: "admin", user: { id: "admin-team" }, roles: ["org_admin"] };
const input = { expectedVersion: 1, companyName: "已核验芯片公司", track: "半导体", summary: "人工核验的最新摘要", investorNames: ["投资甲", "投资乙"], eventDate: "2026-09-01", round: "A轮", amountText: "数亿元" };
beforeEach(() => {
  db=createDatabase(":memory:");initializeDatabase(db);
  db.prepare("INSERT INTO web_search_leads(id,url,title,highlights_json,first_seen_at,last_seen_at,status) VALUES ('lead','https://example.test/source','真实来源','[]','2026-09-04','2026-09-04','discovered')").run();
  db.prepare("INSERT INTO project_candidates(id,lead_id,company_name,track,investor_names_json,signal_type,summary,confidence,status,model,prompt_version,created_at,updated_at) VALUES ('candidate','lead','原始公司','AI','[]','funding','原始摘要',0.8,'pending_review','fixture','v1','2026-09-04','2026-09-04')").run();
  db.prepare("INSERT INTO candidate_documents(candidate_id,original_name,media_type,document_kind,byte_length,bytes,created_by,created_at) VALUES ('candidate','原件.txt','text/plain','text',3,?,'author','2026-09-04')").run(Buffer.from("raw"));
});
afterEach(() => db.close());
it("lets an administrator edit validated candidate fields while retaining AI provenance and original bytes", () => {
  const edited = editCandidate(db, owner, "candidate", input, "edit");
  expect(edited).toMatchObject({ companyName: input.companyName, summary: input.summary, eventDate: "2026-09-01", round: "A轮", amountText: "数亿元", version: 2, origin: "ai", confidence: 0.8 });
  expect(edited.investorNames).toEqual(input.investorNames);
  expect(Buffer.from(db.prepare("SELECT bytes FROM candidate_documents WHERE candidate_id='candidate'").get()!.bytes as Uint8Array).toString()).toBe("raw");
  expect(editCandidate(db, owner, "candidate", input, "edit")).toEqual(edited);
  expect(() => editCandidate(db, owner, "candidate", { ...input, summary: "不同请求" }, "edit")).toThrow(/幂等/);
});
it("rejects non-admins, hidden field injection, invalid calendar dates, stale edits and admitted candidates", () => {
  expect(() => editCandidate(db, { ...owner, roles: ["investment_manager"] }, "candidate", input, "role")).toThrow(/管理员/);
  expect(() => editCandidate(db, owner, "candidate", { ...input, status: "promoted" }, "inject")).toThrow();
  expect(() => editCandidate(db, owner, "candidate", { ...input, eventDate: "2026-02-30" }, "date")).toThrow();
  expect(() => editCandidate(db, owner, "candidate", { ...input, expectedVersion: 2 }, "stale")).toThrow(/版本冲突/);
  db.prepare("UPDATE project_candidates SET status='promoted'").run();
  expect(() => editCandidate(db, owner, "candidate", input, "admitted")).toThrow(/正式项目/);
  expect(db.prepare("SELECT review_version FROM project_candidates").get()?.review_version).toBe(1);
});
it("keeps all changes atomic if the audit write fails", () => {
  db.exec("CREATE TRIGGER fail_candidate_edit BEFORE INSERT ON audit_log WHEN NEW.action='candidate.edited' BEGIN SELECT RAISE(ABORT,'private-sql-detail'); END");
  expect(() => editCandidate(db, owner, "candidate", input, "fail")).toThrow();
  expect(db.prepare("SELECT company_name,review_version FROM project_candidates").get()).toMatchObject({ company_name: "原始公司", review_version: 1 });
  expect(db.prepare("SELECT count(*) n FROM candidate_details").get()?.n).toBe(0);
});
