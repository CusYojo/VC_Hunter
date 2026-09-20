import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { DiscoveryScheduleView } from "@/workbench/discovery-schedule-contracts";

const schema = z.object({ enabled: z.boolean(), version: z.number().int().positive() }).strict();
const dayMs = 86_400_000;
const slotHoursUTC = [2, 6] as const;
export function nextDiscoveryRun(now: string): string {
  const time = Date.parse(now);
  if (!Number.isFinite(time)) throw new RangeError("Invalid schedule time");
  const day = Math.floor(time / dayMs) * dayMs;
  const next = slotHoursUTC.map(hour => day + hour * 3_600_000).find(slot => slot > time);
  return new Date(next ?? day + dayMs + 2 * 3_600_000).toISOString();
}

/** One-time data upgrade, separate from schema DDL. Preserve an existing installation's enabled state. */
export function ensureDiscoverySchedule(database: DatabaseSync, now: string): void {
  if (database.prepare("SELECT 1 FROM discovery_schedule_settings WHERE id='organization'").get()) return;
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = database.prepare(`INSERT OR IGNORE INTO discovery_schedule_settings(id,enabled,version,updated_at,updated_by)
      SELECT 'organization',EXISTS(SELECT 1 FROM agent_search_plans WHERE enabled=1),1,?,NULL`).run(now);
    if (Number(result.changes) === 1) database.prepare("UPDATE agent_search_plans SET next_run_at=?").run(nextDiscoveryRun(now));
    database.exec("COMMIT");
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}

export function readDiscoverySchedule(database: DatabaseSync, now = new Date().toISOString()): DiscoveryScheduleView {
  ensureDiscoverySchedule(database, now);
  const row = database.prepare("SELECT enabled,version,updated_at FROM discovery_schedule_settings WHERE id='organization'").get() as { enabled: number; version: number; updated_at: string };
  const plans = database.prepare("SELECT count(*) AS total,min(next_run_at) AS next FROM agent_search_plans WHERE enabled=1").get() as { total: number; next: string | null };
  return { enabled: row.enabled === 1, version: row.version, timezone: "Asia/Shanghai", times: ["10:00", "14:00"], nextRunAt: row.enabled === 1 ? plans.next : null, planCount: plans.total, updatedAt: row.updated_at };
}

export class DiscoveryScheduleConflict extends Error {
  constructor() { super("定时发现设置已更新，请刷新后重试。"); }
}
export function updateDiscoverySchedule(database: DatabaseSync, input: unknown, actorAccountId: string, now = new Date().toISOString()): DiscoveryScheduleView {
  const parsed = schema.parse(input);
  if (!actorAccountId.trim()) throw new Error("Authenticated administrator required");
  ensureDiscoverySchedule(database, now);
  database.exec("BEGIN IMMEDIATE");
  try {
    const row = database.prepare("SELECT enabled,version FROM discovery_schedule_settings WHERE id='organization'").get() as { enabled: number; version: number };
    if (row.version !== parsed.version) throw new DiscoveryScheduleConflict();
    if (Boolean(row.enabled) !== parsed.enabled) {
      database.prepare("UPDATE discovery_schedule_settings SET enabled=?,version=version+1,updated_at=?,updated_by=? WHERE id='organization'").run(Number(parsed.enabled), now, actorAccountId);
      if (parsed.enabled) database.prepare("UPDATE agent_search_plans SET next_run_at=? WHERE enabled=1").run(nextDiscoveryRun(now));
      database.prepare("INSERT INTO discovery_schedule_audit(id,actor_account_id,previous_enabled,enabled,version,created_at) VALUES(?,?,?,?,?,?)").run(randomUUID(), actorAccountId, row.enabled, Number(parsed.enabled), row.version + 1, now);
    }
    database.exec("COMMIT");
  } catch (error) { database.exec("ROLLBACK"); throw error; }
  return readDiscoverySchedule(database, now);
}
