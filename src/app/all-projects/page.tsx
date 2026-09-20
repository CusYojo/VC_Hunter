import type { Metadata } from "next";
import { headers } from "next/headers";
import { resolveWorkspaceIdentity } from "@/security/workspace-session";
import { authenticationRequired } from "@/security/identity-scope";
import { loadTeamMembers } from "@/workbench/team";
import { requirePageUser } from "@/security/page-auth";
import { getAppDatabase } from "@/db/app";
import { loadProjectCatalog } from "@/workbench/project-catalog-read-model";
import { projectCatalogFiltersSchema } from "@/workbench/project-catalog";
import { ProjectCatalog } from "@/components/operating/project-catalog";
import { loadLocalPreviewCandidates } from "@/intelligence/local-preview-candidates";

export const metadata: Metadata = { title: "全部项目" };
export const dynamic = "force-dynamic";
export default async function AllProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const currentUser = await requirePageUser();
  const identity = authenticationRequired() ? await resolveWorkspaceIdentity(await headers()) : null;
  const params = await searchParams;
  const parsed = projectCatalogFiltersSchema.safeParse(Object.fromEntries(["category", "track", "owner", "q", "from", "to"].flatMap(key => typeof params[key] === "string" ? [[key, params[key]]] : [])));
  const db = getAppDatabase();
  const localPreviewCandidates = loadLocalPreviewCandidates();
  return <ProjectCatalog team={loadTeamMembers().map(({id, name, departmentId, departmentName}) => ({id, name, departmentId, departmentName}))} currentUser={currentUser.name} recentScopeKey={identity ? `${identity.tenantId}:${identity.user.id}` : undefined} canAdmin={identity?.roles.includes("org_admin") ?? false} canReview={!authenticationRequired() || Boolean(identity?.roles.some(role => role === "org_admin" || role === "investment_manager"))} rows={loadProjectCatalog(db, localPreviewCandidates)} page={typeof params.page === "string" && /^\d{1,6}$/.test(params.page) ? Number(params.page) : 1} filters={parsed.success ? parsed.data : {}} error={parsed.success ? undefined : "筛选条件无效，请检查日期范围和输入内容后重试。"} />;
}
