import { requirePageUser } from "@/security/page-auth";
import type { Metadata } from "next";
import { ResearchCenter } from "@/components/operating/research-center";
import { getAppDatabase } from "@/db/app";
import { listAlerts } from "@/repositories/dashboard-data";
import { SqliteWorkbenchRepository } from "@/workbench/repository";
import { IntelligenceDiscoveryRepository } from "@/intelligence/repository";

export const metadata: Metadata = { title: "研究中心" };
export const dynamic = "force-dynamic";

export default async function ResearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageUser();
  const value = (await searchParams).view;
  const database = getAppDatabase();
  const reportRows = database.prepare("SELECT id,profile_id,status,created_at FROM research_jobs ORDER BY created_at DESC LIMIT 20").all() as unknown as Array<{ id: string; profile_id: string; status: string; created_at: string }>;
  const knowledgeRows = new SqliteWorkbenchRepository(database).listKnowledge();
  const alertRows = listAlerts(database);
  const technologyRows = new IntelligenceDiscoveryRepository(database).listTechnologies({ limit: 200 }).items;
  const openQuestions = (database.prepare("SELECT COALESCE(SUM(json_array_length(open_questions_json)),0) AS total FROM projects").get() as { total: number }).total;
  const reportCount = (database.prepare("SELECT COUNT(*) AS total FROM research_jobs").get() as { total: number }).total;
  const highAlerts = alertRows.filter((alert) => alert.severity === "high").length;
  return <ResearchCenter initialView={typeof value === "string" ? value : "workspace"} realSummary={{ reports: reportCount, knowledge: knowledgeRows.length, alerts: highAlerts, openQuestions }} realData={{ reports: reportRows.map((report) => ({ id: report.id, title: report.profile_id, detail: `${report.status} · ${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeZone: "Asia/Shanghai" }).format(new Date(report.created_at))}` })), knowledge: knowledgeRows.map((item) => ({ id: item.id, title: item.title, content: item.content, status: item.status })), technology: technologyRows.map((item) => ({ id: String(item.id), name: String(item.name), track: String(item.track), subtrack: item.subtrack ? String(item.subtrack) : null, definition: String(item.definition), maturity: String(item.maturity), keyMetrics: item.keyMetrics as string[], investmentSummary: String(item.investmentSummary ?? "") })), alerts: alertRows.map((alert) => ({ id: alert.id, projectName: alert.projectName, reason: alert.reason, severity: alert.severity })) }} />;
}
