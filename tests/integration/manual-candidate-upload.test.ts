import { afterEach, beforeEach, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { createManualCandidate, getCandidateDocument } from "@/workbench/manual-candidate";
let db: DatabaseSync;
beforeEach(() => { db = createDatabase(":memory:"); initializeDatabase(db); });
afterEach(() => db.close());
it("persists an editable confirmed candidate and its downloadable original with idempotent retries", () => {
  const file = { name: "项目.txt", mimeType: "text/plain", bytes: new Uint8Array(Buffer.from("融资资料原文")) };
  const input = { companyName: "真实公司", track: "半导体", summary: "用户核对后的融资摘要", investorNames: "某机构", sourceText: "融资资料原文" };
  const candidate = createManualCandidate(db,input,file,{ tenantId: "t", accountId: "a" },"key-1");
  expect(db.prepare("SELECT event_type,actor FROM platform_timeline WHERE subject_id=?").get(candidate.id)).toMatchObject({event_type:"candidate.created",actor:"a"});
  expect(candidate.companyName).toBe("真实公司"); expect(candidate.status).toBe("pending_review"); expect(candidate.confidence).toBeNull();
  expect(Buffer.from(getCandidateDocument(db,candidate.id)!.bytes).toString()).toBe("融资资料原文");
  expect(createManualCandidate(db,input,file,{ tenantId: "t", accountId: "a" },"key-1").id).toBe(candidate.id);
  expect(() => createManualCandidate(db,{...input,summary:"changed"},file,{ tenantId: "t", accountId: "a" },"key-1")).toThrow(/幂等/);
});
