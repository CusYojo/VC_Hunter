import { afterEach, beforeEach, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { SqliteBackgroundAgentRepository } from "@/repositories/background-agent";
import { nextDiscoveryRun, readDiscoverySchedule, updateDiscoverySchedule } from "@/services/discovery-schedule";
let db: DatabaseSync;
beforeEach(() => { db = createDatabase(":memory:"); initializeDatabase(db); });
afterEach(() => db.close());
it("uses Shanghai 10:00 and 14:00 boundaries including day rollover", () => {
  expect(nextDiscoveryRun("2026-09-04T01:59:59.000Z")).toBe("2026-09-04T02:00:00.000Z");
  expect(nextDiscoveryRun("2026-09-04T02:00:00.000Z")).toBe("2026-09-04T06:00:00.000Z");
  expect(nextDiscoveryRun("2026-09-04T06:00:00.000Z")).toBe("2026-09-05T02:00:00.000Z");
});
it("persists administrator pause across manifest reload and schedules the next fixed slot on enable", () => {
  const repo = new SqliteBackgroundAgentRepository(db);
  const plans = [{ id: "plan-1", name: "半导体搜索", query: "半导体投资", intervalMinutes: 1440, limit: 5, enabled: true, workflow: { id: "project-discovery", version: "1.0.0" }, searchProvider: { id: "deepseek-web-search", version: "1.0.0" } }];
  repo.syncSearchPlans(plans, "2026-09-04T01:00:00.000Z");
  expect(readDiscoverySchedule(db).enabled).toBe(false);
  const enabled = updateDiscoverySchedule(db, { enabled: true, version: 1 }, "admin-account", "2026-09-04T01:59:00.000Z");
  expect(enabled.nextRunAt).toBe("2026-09-04T02:00:00.000Z");
  expect(repo.claimDueSearchPlan("worker", "2026-09-04T01:59:59.000Z")).toBeUndefined();
  expect(repo.claimDueSearchPlan("worker", "2026-09-04T02:00:00.000Z")?.id).toBe("plan-1");
  expect(repo.claimDueSearchPlan("other", "2026-09-04T02:06:00.000Z")).toBeUndefined();
  const paused = updateDiscoverySchedule(db, { enabled: false, version: enabled.version }, "admin-account", "2026-09-04T03:00:00.000Z");
  repo.syncSearchPlans(plans, "2026-09-04T05:00:00.000Z");
  expect(readDiscoverySchedule(db).enabled).toBe(false);
  expect(repo.claimDueSearchPlan("worker", "2026-09-04T06:00:00.000Z")).toBeUndefined();
  expect(paused.nextRunAt).toBeNull();
  expect(db.prepare("SELECT COUNT(*) AS n FROM discovery_schedule_audit").get()).toMatchObject({ n: 2 });
});
it("rejects stale settings writes and invalid input without changing the schedule", () => {
  readDiscoverySchedule(db);
  const saved = updateDiscoverySchedule(db, { enabled: true, version: 1 }, "admin-a", "2026-09-04T01:00:00.000Z");
  expect(() => updateDiscoverySchedule(db, { enabled: false, version: 1 }, "admin-b")).toThrow("已更新");
  expect(() => updateDiscoverySchedule(db, { enabled: "true", version: saved.version }, "admin-a")).toThrow();
  expect(() => updateDiscoverySchedule(db, { enabled: false, version: saved.version, times: ["08:00"] }, "admin-a")).toThrow();
  expect(readDiscoverySchedule(db).enabled).toBe(true);
  expect(db.prepare("SELECT COUNT(*) AS n FROM discovery_schedule_audit").get()).toMatchObject({ n: 1 });
});
it("keeps all configured plans eligible once in each fixed slot", () => {
  const repo = new SqliteBackgroundAgentRepository(db);
  const common = { name: "搜索计划", query: "半导体投资", intervalMinutes: 1440, limit: 5, enabled: true, workflow: { id: "project-discovery", version: "1.0.0" }, searchProvider: { id: "deepseek-web-search", version: "1.0.0" } };
  repo.syncSearchPlans([{ ...common, id: "one" }, { ...common, id: "two" }], "2026-09-04T01:00:00.000Z");
  updateDiscoverySchedule(db, { enabled: true, version: 1 }, "admin", "2026-09-04T01:50:00.000Z");
  const first = repo.claimDueSearchPlan("worker", "2026-09-04T02:00:00.000Z")!;
  repo.completeSearchPlan(first, "2026-09-04T02:00:10.000Z", "worker", {}, "trace-one");
  const second = repo.claimDueSearchPlan("worker", "2026-09-04T02:00:10.000Z")!;
  expect(first.id).not.toBe(second.id);
  repo.failSearchPlan(second, "2026-09-04T02:00:20.000Z", "worker", "trace-two");
  expect(repo.claimDueSearchPlan("worker", "2026-09-04T02:30:00.000Z")).toBeUndefined();
  expect(repo.claimDueSearchPlan("worker", "2026-09-04T06:00:00.000Z")).toBeDefined();
});
it("preserves an existing enabled installation once and aligns its legacy interval", () => {
  db.prepare(`INSERT INTO agent_search_plans(id,name,query,interval_minutes,result_limit,enabled,next_run_at,created_at,updated_at) VALUES('legacy','旧计划','旧查询',1440,5,1,'2026-09-04T03:00:00Z','2026-09-01','2026-09-01')`).run();
  expect(readDiscoverySchedule(db, "2026-09-04T01:00:00.000Z")).toMatchObject({ enabled: true, nextRunAt: "2026-09-04T02:00:00.000Z", planCount: 1 });
  readDiscoverySchedule(db, "2026-09-04T02:30:00.000Z");
  expect(db.prepare("SELECT next_run_at FROM agent_search_plans WHERE id='legacy'").get()).toMatchObject({ next_run_at: "2026-09-04T02:00:00.000Z" });
});
