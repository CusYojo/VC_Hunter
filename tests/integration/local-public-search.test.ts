import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { LocalPublicSearchProvider, PublicSearchFallback } from "@/connectors/local-public-search";
describe("local public source search", () => {
  let db: DatabaseSync;
  beforeEach(() => { db = createDatabase(":memory:"); initializeDatabase(db); });
  afterEach(() => db.close());
  function source(id: string, mode = "rss", policy = "approved", accessClass = "public", allowExternalModel = 1, termsReviewStatus = "reviewed") {
    db.prepare(`INSERT INTO sources(id,name,source_type,authority,access_mode,robots_status,license_notes,policy_status,independent_group,last_checked_at,access_class,allow_external_model,terms_review_status)
      VALUES (?,?,'media','B',?,'allowed','public',?,'independent','2026-09-04',?,?,?)`).run(id,id,mode,policy,accessClass,allowExternalModel,termsReviewStatus);
    db.prepare("INSERT INTO documents VALUES (?,?,?,?,'2026-09-04','2026-09-04',?,?)").run(`d-${id}`,id,`https://news.cn/${id}`,"半导体设备融资",id,`公司披露半导体设备融资。${id}`);
  }
  it("returns stored public evidence and excludes internal, fixture, blocked content", async () => {
    source("public"); source("internal","manual"); source("demo","fixture"); source("blocked","rss","blocked");
    source("licensed","rss","approved","licensed_internal",0); source("no-consent","rss","approved","public",0); source("pending-terms","rss","approved","public",1,"pending");
    const result = await new LocalPublicSearchProvider(db).search({ query: "半导体 融资", limit: 20 });
    expect(result.results).toEqual([{ externalId: "d-public", title: "半导体设备融资", url: "https://news.cn/public", publishedAt: "2026-09-04", highlights: ["公司披露半导体设备融资。public"] }]);
    expect(result.lineage?.provider).toBe("local-index");
  });
  it("falls back to a clearly attributed local index when a remote search fails", async () => {
    source("public");
    const provider = new PublicSearchFallback({ name:"exa",search:async()=>{throw new Error("unauthorized");} },new LocalPublicSearchProvider(db));
    const response = await provider.search({query:"半导体",limit:5});
    expect(response.lineage?.provider).toBe("local-index"); expect(response.results[0].url).toBe("https://news.cn/public");
  });
  it("returns empty for unmatched topics and rejects empty/wildcard abuse", async () => {
    source("public"); const search = new LocalPublicSearchProvider(db);
    expect((await search.search({ query: "航空发动机", limit: 5 })).results).toEqual([]);
    expect((await search.search({ query: "%%", limit: 5 })).results).toEqual([]);
    await expect(search.search({ query: "", limit: 5 })).rejects.toThrow();
  });
  it("applies the publication window before relevance and result limits", async () => {
    for (let index = 0; index < 101; index++) {
      source(`old-${index}`);
      db.prepare("UPDATE documents SET published_at='2020-01-01' WHERE id=?").run(`d-old-${index}`);
    }
    source("current");
    db.prepare("UPDATE documents SET title='设备' WHERE id='d-current'").run();
    const response = await new LocalPublicSearchProvider(db).search({ query: "半导体设备融资", limit: 1, publicationWindow: { start: "2026-09-03T16:00:00.000Z", end: "2026-09-04T16:00:00.000Z" } });
    expect(response.results.map(result => result.externalId)).toEqual(["d-current"]);
  });

});
