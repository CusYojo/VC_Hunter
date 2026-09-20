import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { publishWeekdayIntelligenceDigest } from "@/intelligence/digest";

describe("weekday intelligence digest", () => {
  let database: DatabaseSync;
  beforeEach(() => { database = createDatabase(":memory:"); initializeDatabase(database); });
  afterEach(() => database.close());

  it("publishes one in-app digest to admin, investment and research roles without outbound messages", () => {
    database.exec("CREATE TABLE workspace_memberships(id TEXT PRIMARY KEY,user_id TEXT,team_user_id TEXT,tenant_id TEXT,roles TEXT,active INTEGER)");
    for (const [id, roles] of [["admin", ["org_admin"]], ["manager", ["investment_manager"]], ["researcher", ["researcher"]], ["viewer", ["viewer"]]] as const) {
      database.prepare("INSERT INTO workspace_memberships VALUES(?,?,?,?,?,1)").run(id, `user-${id}`, id, "org", JSON.stringify(roles));
    }
    database.prepare(`INSERT INTO intelligence_candidates(id,entity_type,candidate_kind,subject_name,track,signal_type,event_date,source_channel,discovery_reason,priority_band,scores_json,completeness_level,status,content_hash,created_at,updated_at)
      VALUES('digest-a','company','entity_update','晨报项目','AI','hiring_growth','2026-09-14','hiring','研发岗位增长','A','{"technology":4,"team":4,"commercial":3,"signal":5,"evidence":4}','L1','pending_review','digest-a','2026-09-14T00:10:00.000Z','2026-09-14T00:10:00.000Z')`).run();
    const result = publishWeekdayIntelligenceDigest(database, "2026-09-14T00:31:00.000Z");
    expect(result).toMatchObject({ published: true, recipients: 3, candidateCount: 1 });
    expect(database.prepare("SELECT count(*) AS count FROM discovery_digests").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT recipient_id,kind,target_url FROM member_notifications ORDER BY recipient_id").all()).toEqual([
      { recipient_id: "admin", kind: "discovery_digest", target_url: "/projects?view=discovery" },
      { recipient_id: "manager", kind: "discovery_digest", target_url: "/projects?view=discovery" },
      { recipient_id: "researcher", kind: "discovery_digest", target_url: "/projects?view=discovery" },
    ]);
    expect(publishWeekdayIntelligenceDigest(database, "2026-09-14T01:00:00.000Z")).toMatchObject({ published: false, reason: "already_published" });
  });

  it("stays quiet before 08:30 and on weekends", () => {
    expect(publishWeekdayIntelligenceDigest(database, "2026-09-14T00:20:00.000Z")).toMatchObject({ published: false, reason: "not_due" });
    expect(publishWeekdayIntelligenceDigest(database, "2026-09-13T02:00:00.000Z")).toMatchObject({ published: false, reason: "not_due" });
  });
});
