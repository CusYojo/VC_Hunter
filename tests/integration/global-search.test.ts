import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { seedDemoData } from "@/db/seed";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), database: vi.fn() }));
vi.mock("@/security/workspace-session", () => ({ resolveWorkspaceIdentity: mocks.identity }));
vi.mock("@/db/app", () => ({ getAppDatabase: mocks.database }));
import { GET } from "@/app/api/v1/search/route";
let db: DatabaseSync;
const search = (q: string) => GET(new Request(`http://localhost/api/v1/search?q=${encodeURIComponent(q)}`));
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BETTER_AUTH_URL", "http://localhost");
  db = createDatabase(":memory:"); initializeDatabase(db); seedDemoData(db); mocks.database.mockReturnValue(db);
  mocks.identity.mockResolvedValue({ user: { id: "u1", name: "用户" }, accountId: crypto.randomUUID(), tenantId: "org", roles: ["viewer"] });
  db.prepare("UPDATE projects SET name='检索样本项目100%_' WHERE id='project-qiongxin'").run();
  db.prepare("UPDATE investors SET name='检索样本机构' WHERE id=(SELECT id FROM investors LIMIT 1)").run();
  db.prepare("UPDATE people SET name='检索样本人物' WHERE id=(SELECT id FROM people LIMIT 1)").run();
  db.prepare("INSERT INTO knowledge_entries(id,type,title,content,source_type,source_id,status,created_by,created_at,updated_at) VALUES ('search-note','research','检索样本知识','可靠的项目技术记录','evidence','e1','approved','u1','2026-09-04','2026-09-04')").run();
  db.prepare("INSERT INTO technologies(id,name,normalized_name,track,definition,maturity,key_metrics_json,papers_json,patents_json,alternatives_json,competitors_json,created_at,updated_at) VALUES('search-tech','检索样本技术','检索样本技术','AI','可靠的技术情报','laboratory','[]','[]','[]','[]','[]','2026-09-04','2026-09-04')").run();
  db.prepare(`INSERT INTO intelligence_candidates(id,entity_type,candidate_kind,subject_name,track,signal_type,event_date,source_channel,discovery_reason,priority_band,scores_json,completeness_level,status,content_hash,created_at,updated_at)
    VALUES('search-candidate','company','entity_update','检索样本更新','AI','hiring_growth','2026-09-04','hiring','研发招聘增加','B','{"technology":2,"team":2,"commercial":2,"signal":4,"evidence":3}','L1','pending_review','search-candidate','2026-09-04','2026-09-04')`).run();
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("authorized global entity search", () => {
  it("returns real project, investor, person and knowledge results with working destinations", async () => {
    const response = await search("检索样本"); expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.items.map((item: { type: string }) => item.type).sort()).toEqual(["candidate", "investor", "knowledge", "person", "project", "technology"]);
    expect(data.items.find((item: { type: string }) => item.type === "project").href).toBe("/projects/project-qiongxin");
    expect(data.items.find((item: { type: string }) => item.type === "knowledge").href).toContain("/knowledge?query=");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(JSON.stringify(data)).not.toContain("storage_key");
  });
  it("treats SQL wildcards literally, bounds queries and handles empty results", async () => {
    expect((await (await search("%_")).json()).data.items).toHaveLength(1);
    expect((await (await search("' OR 1=1 --")).json()).data.items).toHaveLength(0);
    expect((await (await search(" ")).json()).data.items).toHaveLength(0);
    expect((await search("a".repeat(101))).status).toBe(400);
  });
  it("limits each entity type and truncates result snippets", async () => {
    for (let i = 0; i < 10; i += 1) db.prepare("INSERT INTO knowledge_entries(id,type,title,content,source_type,source_id,status,created_by,created_at,updated_at) VALUES (?, 'research', ?, ?, 'evidence','e1','approved','u1','2026-09-04','2026-09-04')").run(`bounded-${i}`, `检索样本知识${i}`, "正文".repeat(300));
    const items = (await (await search("检索样本")).json()).data.items;
    expect(items.filter((item: { type: string }) => item.type === "knowledge")).toHaveLength(6);
    expect(items.length).toBeLessThanOrEqual(36);
    expect(items.every((item: { snippet: string }) => item.snippet.length <= 180)).toBe(true);
  });
  it("requires verified membership and masks unexpected failures", async () => {
    mocks.identity.mockResolvedValueOnce(null); expect((await search("检索样本")).status).toBe(401);
    mocks.database.mockImplementationOnce(() => { throw new Error("secret /private/db"); });
    const response = await search("检索样本"); expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain("/private/db");
  });
});
