import { z } from "zod";
import type { ProjectSummary } from "@/domain/types";
import type { IntelligenceCandidateView } from "@/intelligence/repository";
import type { CandidateView } from "./candidate-details";
import { discoveryEventIdentity } from "./discovery-identity";

export const PROJECT_CATEGORIES = { following: "跟进中", invested: "已投项目", exited: "退出项目", stopped: "中止项目", other: "其他项目" } as const;
export type ProjectCategory = keyof typeof PROJECT_CATEGORIES;
const calendarDate = z.string().refine(value => !value || /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value, "请输入有效日期");
export const projectCatalogFiltersSchema = z.object({
  category: z.enum(["all", "following", "invested", "exited", "stopped", "other"]).default("all"),
  track: z.string().max(128).default("all"), owner: z.string().max(128).default("all"),
  q: z.string().trim().max(200).default(""), from: calendarDate.default(""), to: calendarDate.default(""),
}).refine(input => !input.from || !input.to || input.from <= input.to, "开始日期不能晚于结束日期");
export type ProjectCatalogFilters = z.input<typeof projectCatalogFiltersSchema>;
export type CatalogProject = ProjectSummary & { latestAt?: string; fallbackAt?: string; latestProgress?: string };
export interface IntelligenceCatalogCandidate {
  id: string; name: string; track: string; subtrack: string; city: string; signalType: string; eventDate: string;
  status: "pending_review" | "promoted" | "dismissed" | "merged"; summary: string; createdAt: string;
  candidate?: IntelligenceCandidateView;
}
export interface ProjectCatalogRow {
  id: string; kind: "project" | "candidate" | "intelligence"; name: string; legalName: string; track: string; subtrack: string;
  category: ProjectCategory; statusLabel: string; owners: string[]; latestAt: string | null; summary: string;
  candidate?: CandidateView; intelligenceCandidate?: IntelligenceCandidateView; discoveryHref?: string;
}
const stageLabels: Record<string, string> = { new: "新发现", researching: "研究中", contacting: "接触中", dd: "尽调中", ic: "投决中", invested: "已投", exited: "已退出", pass: "暂不跟进" };
export function catalogDate(value: string | null): string {
  return value && Number.isFinite(Date.parse(value)) ? new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 10) : "日期未记录";
}
function latestDate(values: (string | null | undefined)[]): string | null {
  return values.filter((value): value is string => Boolean(value) && Number.isFinite(Date.parse(value!))).toSorted((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
}
export function buildProjectCatalog(projects: readonly CatalogProject[], candidates: readonly (CandidateView & { latestAt?: string })[], intelligenceCandidates: readonly IntelligenceCatalogCandidate[] = []): ProjectCatalogRow[] {
  const projectIds = new Set(projects.map(project => project.id));
  const formal: ProjectCatalogRow[] = projects.map(project => ({
    id: project.id, kind: "project", name: project.name, legalName: project.legalName, track: project.track, subtrack: project.subtrack ?? "",
    category: project.status === "pass" ? "stopped" : project.status === "invested" ? "invested" : project.status === "exited" ? "exited" : ["new", "researching", "contacting", "dd", "ic"].includes(project.status) ? "following" : "other",
    statusLabel: stageLabels[project.status] ?? "其他", owners: project.owners?.length ? [...project.owners] : project.owner ? [project.owner] : [],
    latestAt: latestDate([project.latestAt, project.eventAt]) ?? latestDate([project.fallbackAt]), summary: project.latestProgress || project.whyNow || "暂无推进记录",
  }));
  const intelligenceKeys = new Set(intelligenceCandidates.map(candidate => discoveryEventIdentity(candidate.name, candidate.eventDate, candidate.signalType)));
  const unpromoted: ProjectCatalogRow[] = candidates.filter(candidate => (!candidate.projectId || !projectIds.has(candidate.projectId)) && !intelligenceKeys.has(discoveryEventIdentity(candidate.companyName, candidate.eventDate || catalogDate(candidate.createdAt), candidate.signalType))).map(candidate => ({
    id: candidate.id, kind: "candidate", name: candidate.companyName, legalName: "", track: candidate.track || "未分类", subtrack: candidate.rawTrack ?? "", category: "other",
    statusLabel: candidate.status === "dismissed" ? "暂不跟进" : candidate.archivedAt ? "已归档线索" : candidate.status === "promoted" ? "已入库线索" : "待查看线索",
    owners: [], latestAt: latestDate([candidate.latestAt, candidate.reviewedAt, candidate.createdAt]), summary: candidate.summary, candidate,
  }));
  const newestIntelligence = new Map<string, IntelligenceCatalogCandidate>();
  for (const candidate of intelligenceCandidates) {
    const key = discoveryEventIdentity(candidate.name, candidate.eventDate, candidate.signalType);
    const current = newestIntelligence.get(key);
    if (!current || catalogCandidateQuality(candidate) > catalogCandidateQuality(current)) newestIntelligence.set(key, candidate);
  }
  const intelligence: ProjectCatalogRow[] = [...newestIntelligence.values()].map(candidate => ({
    id: candidate.id, kind: "intelligence", name: candidate.name, legalName: "", track: candidate.track || "未分类", subtrack: candidate.subtrack,
    category: "other", statusLabel: candidate.status === "dismissed" ? "新项目发现 · 暂不跟进" : "新项目发现 · 待审核", owners: [],
    latestAt: `${candidate.eventDate}T00:00:00+08:00`, summary: candidate.summary,
    intelligenceCandidate: candidate.candidate,
    discoveryHref: `/projects?view=discovery#intelligence-${encodeURIComponent(candidate.id)}`,
  }));
  return [...formal, ...unpromoted, ...intelligence];
}
function catalogCandidateQuality(candidate: IntelligenceCatalogCandidate): number {
  const completeness = candidate.candidate ? { L0: 0, L1: 1, L2: 2 }[candidate.candidate.completeness] : 0;
  const supportingRecords = candidate.candidate ? (candidate.candidate.evidence?.length ?? 0) + (candidate.candidate.assertions?.length ?? 0) + (candidate.candidate.relationships?.length ?? 0) : 0;
  const freshness = Number.isFinite(Date.parse(candidate.createdAt)) ? Date.parse(candidate.createdAt) / 1e13 : 0;
  return completeness * 10_000 + supportingRecords * 100 + freshness;
}
export function filterProjectCatalog(rows: readonly ProjectCatalogRow[], raw: ProjectCatalogFilters = {}): ProjectCatalogRow[] {
  const filters = projectCatalogFiltersSchema.parse(raw);
  const query = filters.q.toLocaleLowerCase("zh-CN");
  return rows.filter(row => {
    if (filters.category !== "all" && row.category !== filters.category) return false;
    if (filters.track !== "all" && row.track !== filters.track) return false;
    if (filters.owner !== "all" && (filters.owner === "unassigned" ? row.owners.length > 0 : !row.owners.includes(filters.owner))) return false;
    const date = catalogDate(row.latestAt);
    if ((filters.from || filters.to) && !row.latestAt || filters.from && date < filters.from || filters.to && date > filters.to) return false;
    return !query || [row.name, row.legalName, row.track, row.subtrack, row.summary, ...row.owners].join(" ").toLocaleLowerCase("zh-CN").includes(query);
  }).toSorted((a, b) => (b.latestAt ? Date.parse(b.latestAt) : -Infinity) - (a.latestAt ? Date.parse(a.latestAt) : -Infinity) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}
