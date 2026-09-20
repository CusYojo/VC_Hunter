import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase, initializeDatabase } from "@/db/client";
import { WorkspaceActivityRepository } from "@/repositories/workspace-activity";
import { SqliteBackgroundAgentRepository } from "@/repositories/background-agent";
import { runBackgroundAgentCycle, syncAgentManifest } from "@/services/background-agent";
let db: DatabaseSync;
const midnight = "2026-09-05T16:00:00.000Z";
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); db = createDatabase(":memory:"); initializeDatabase(db); syncAgentManifest(db, { searchPlans: [] }, "2026-09-05T15:59:00.000Z"); });
afterEach(() => { db.close(); vi.useRealTimers(); });
const seed = (status: string, archiveAt: string) => {
  vi.setSystemTime(new Date(Date.parse(archiveAt) - 60_000));
  const repository = new WorkspaceActivityRepository(db, ["alice", "bob"]);
  const activity = repository.create({ kind: "approval", title: "已办结审批", participantIds: ["bob"] }, "alice", crypto.randomUUID());
  if (status === "withdrawn") repository.lifecycle(activity.id, { action: "withdraw", expectedVersion: 1 }, "alice");
  if (status === "completed") {
    repository.respond(activity.id, { action: "approved", expectedVersion: 1 }, "bob");
    repository.lifecycle(activity.id, { action: "complete", expectedVersion: 2 }, "alice");
  }
  return activity.id;
};
async function tick(now: string) {
  const search = vi.fn(), generateResearchBrief = vi.fn(), qualifyDiscoveryLeads = vi.fn();
  const result = await runBackgroundAgentCycle({ repository: new SqliteBackgroundAgentRepository(db), workerId: "archive-test", now, searchProvider: { name: "exa", search }, researchGateway: { generateResearchBrief, qualifyDiscoveryLeads } });
  expect(search).not.toHaveBeenCalled(); expect(generateResearchBrief).not.toHaveBeenCalled(); expect(qualifyDiscoveryLeads).not.toHaveBeenCalled();
  expect(result).toMatchObject({ searchRuns: 0, researchRuns: 0, failures: 0 });
}
it("archives at Shanghai midnight while discovery stays disabled, with idempotent subsequent ticks", async () => {
  const id = seed("completed", midnight), activeId = seed("active", midnight), withdrawnId = seed("withdrawn", midnight);
  const schedule = db.prepare("SELECT * FROM discovery_schedule_settings").get();
  expect(schedule?.enabled).toBe(0);
  await tick("2026-09-05T15:59:59.999Z");
  expect(db.prepare("SELECT status FROM workspace_activity WHERE id=?").get(id)?.status).toBe("completed");
  await tick(midnight);
  const archived = db.prepare("SELECT status,version FROM workspace_activity WHERE id=?").get(id);
  expect(archived).toMatchObject({ status: "archived", version: 4 });
  await tick("2026-09-05T16:00:30.000Z");
  expect(db.prepare("SELECT status,version FROM workspace_activity WHERE id=?").get(id)).toEqual(archived);
  expect(db.prepare("SELECT status FROM workspace_activity WHERE id=?").get(activeId)?.status).toBe("active");
  expect(db.prepare("SELECT status FROM workspace_activity WHERE id=?").get(withdrawnId)?.status).toBe("withdrawn");
  expect(db.prepare("SELECT * FROM discovery_schedule_settings").get()).toEqual(schedule);
});
it("catches up on the first cycle after downtime without waiting for a scheduled discovery slot", async () => {
  const tomorrow = seed("completed", "2026-09-06T16:00:00.000Z");
  const overdue = seed("completed", "2026-09-02T16:00:00.000Z");
  expect(db.prepare("SELECT status FROM workspace_activity WHERE id=?").get(overdue)?.status).toBe("completed");
  await tick("2026-09-05T20:25:00.000Z");
  expect(db.prepare("SELECT status FROM workspace_activity WHERE id=?").get(overdue)?.status).toBe("archived");
  expect(db.prepare("SELECT status FROM workspace_activity WHERE id=?").get(tomorrow)?.status).toBe("completed");
});
