import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { loadTeamMembers } from "@/workbench/team";
import { shanghaiBusinessTime } from "./scheduling";

type DigestResult = { published: true; recipients: number; candidateCount: number; digestId: string } | { published: false; reason: "not_due" | "already_published" };

export function publishWeekdayIntelligenceDigest(database: DatabaseSync, now = new Date().toISOString()): DigestResult {
  const businessTime = shanghaiBusinessTime(now);
  if ([0, 6].includes(businessTime.weekday) || businessTime.minutes < 8 * 60 + 30) return { published: false, reason: "not_due" };
  if (database.prepare("SELECT 1 FROM discovery_digests WHERE digest_date=?").get(businessTime.date)) return { published: false, reason: "already_published" };
  const candidates = database.prepare(`SELECT id,priority_band,candidate_kind,source_channel,status FROM intelligence_candidates
    WHERE created_at>=? ORDER BY CASE priority_band WHEN 'A' THEN 0 WHEN 'B' THEN 1 ELSE 2 END,event_date DESC`).all(businessTime.dayStart) as Array<{ id: string; priority_band: string; candidate_kind: string; source_channel: string; status: string }>;
  const ab = candidates.filter((item) => item.priority_band === "A" || item.priority_band === "B").length;
  const updates = candidates.filter((item) => item.candidate_kind === "entity_update").length;
  const hiring = candidates.filter((item) => item.source_channel === "hiring").length;
  const ranking = candidates.filter((item) => item.source_channel === "ranking_award").length;
  const pending = (database.prepare("SELECT count(*) AS count FROM intelligence_candidates WHERE status='pending_review'").get() as { count: number }).count;
  const summary = `情报晨报：新增 A/B 级候选 ${ab} 条，已有实体更新 ${updates} 条，招聘增长 ${hiring} 条，榜单人才/技术 ${ranking} 条，当前待审核 ${pending} 条。`;
  const recipients = digestRecipients(database);
  const digestId = randomUUID();
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("INSERT INTO discovery_digests(id,digest_date,summary,candidate_ids_json,recipient_roles_json,status,created_at,published_at) VALUES(?,?,?,?,?,'published',?,?)")
      .run(digestId, businessTime.date, summary, JSON.stringify(candidates.map((item) => item.id)), JSON.stringify(["org_admin", "investment_manager", "researcher"]), now, now);
    const insert = database.prepare("INSERT INTO member_notifications(id,recipient_id,actor_id,kind,project_id,milestone_id,comment_id,message,target_url,read_at,created_at) VALUES(?,?,?,'discovery_digest',NULL,NULL,NULL,?,'/projects?view=discovery',NULL,?)");
    for (const recipient of recipients) insert.run(randomUUID(), recipient, "background-agent", summary, now);
    database.exec("COMMIT");
    return { published: true, recipients: recipients.length, candidateCount: candidates.length, digestId };
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}

function digestRecipients(database: DatabaseSync): string[] {
  const membershipTable = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspace_memberships'").get();
  if (!membershipTable) return loadTeamMembers().map((member) => member.id);
  const rows = database.prepare("SELECT team_user_id,roles FROM workspace_memberships WHERE active=1").all() as Array<{ team_user_id: string; roles: string }>;
  const eligible = new Set(["org_admin", "investment_manager", "researcher"]);
  return rows.filter((row) => {
    try { return (JSON.parse(row.roles) as string[]).some((role) => eligible.has(role)); } catch { return false; }
  }).map((row) => row.team_user_id);
}
