import { ProjectAdminEditor } from "@/components/project-admin-editor";
import { headers } from "next/headers";
import { personalSearchMode } from "@/ai/search-mode";
import { authenticationRequired } from "@/security/identity-scope";
import { resolveWorkspaceIdentity } from "@/security/workspace-session";
import { requirePageUser } from "@/security/page-auth";
import type { Metadata } from "next";
import { ProjectsCenter } from "@/components/operating/projects-center";
import { DiscoverTabs } from "@/components/discover-tabs";
import { getAppDatabase, getAppRepository, getIntelligenceRepository, getInvestorDirectoryRepository } from "@/db/app";
import { getProjectsView } from "@/prototype/navigation";
import { buildFundingDashboard } from "@/repositories/funding-dashboard";
import { SqliteWorkbenchRepository } from "@/workbench/repository";
import { loadTeamMembers } from "@/workbench/team";
import { IntelligenceDiscoveryRepository } from "@/intelligence/repository";
import { loadLocalPreviewCandidates, mergeLocalPreviewCandidates } from "@/intelligence/local-preview-candidates";
import type { IntelligencePlanView } from "@/components/intelligence-discovery-workbench";

export const metadata: Metadata = { title: "项目中心" };
export const dynamic = "force-dynamic";

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const currentUser = await requirePageUser();
  const params = await searchParams;
  const view = getProjectsView(typeof params.view === "string" ? params.view : null);
  const track = typeof params.track === "string" ? params.track : "all";
  const owner = typeof params.owner === "string" ? params.owner : "all";
  const query = typeof params.query === "string" ? params.query.trim().toLocaleLowerCase("zh-CN") : "";
  const allProjects = getAppRepository().list();
  const projects = allProjects.filter((project) => (track === "all" || project.track === track)
    && (owner === "all" || (owner === "unassigned" ? !project.owner : (project.owners ?? (project.owner ? [project.owner] : [])).includes(owner)))
    && (!query || [project.name, project.legalName, project.subtrack ?? ""].some((value) => value.toLocaleLowerCase("zh-CN").includes(query))));
  const database = getAppDatabase();
  const workbench = new SqliteWorkbenchRepository(database);
  const intelligence = new IntelligenceDiscoveryRepository(database);
  const intelligencePage = view === "discovery" ? intelligence.list({ limit: 200 }) : { items: [], total: 0 };
  const persistedIntelligenceCandidates = view === "discovery" ? intelligencePage.items.map((item) => intelligence.get(item.id) ?? item) : [];
  const localPreviewCandidates = view === "discovery" ? loadLocalPreviewCandidates() : [];
  const intelligenceCandidates = mergeLocalPreviewCandidates(persistedIntelligenceCandidates, localPreviewCandidates);
  const pendingCandidates = intelligence.list({ status: "pending_review", limit: 1 }).total;
  const directory = view === "discovery" ? getInvestorDirectoryRepository().list({ perPage: 60, page: 1 }) : null;
  const team = loadTeamMembers();
  const discoveryJobs = view === "discovery" ? workbench.listDiscoveryJobs() : [];
  const searchIdentity = authenticationRequired() ? await resolveWorkspaceIdentity(await headers()) : null;
  const searchMode = personalSearchMode(database, searchIdentity ?? undefined);
  const canAdminDiscovery = !authenticationRequired() || (searchIdentity?.roles.includes("org_admin") ?? false);
  const canReviewDiscovery = !authenticationRequired() || (searchIdentity?.roles.some((role) => role === "org_admin" || role === "investment_manager") ?? false);
  const canViewPublicWorkContacts = !authenticationRequired() || (searchIdentity?.roles.some((role) => ["org_admin", "investment_manager", "researcher"].includes(role)) ?? false);
  const visibleIntelligenceCandidates = canViewPublicWorkContacts ? intelligenceCandidates : intelligenceCandidates.map((candidate) => ({ ...candidate, contacts: [] }));
  const discoveryWorkspace = view === "discovery" && directory ? <DiscoverTabs canAdmin={canAdminDiscovery} canReview={canReviewDiscovery} searchMode={searchMode} dashboard={buildFundingDashboard(database)} investorNames={Object.fromEntries(getIntelligenceRepository().listInvestors().map((investor) => [investor.id, investor.name]))} directory={directory.items} directoryTotal={directory.total} jobs={discoveryJobs} candidates={workbench.listCandidates()} intelligenceCandidates={visibleIntelligenceCandidates} intelligenceTotal={intelligencePage.total + intelligenceCandidates.length - persistedIntelligenceCandidates.length} intelligencePlans={intelligence.listPlans() as IntelligencePlanView[]} team={team.map((member) => ({ id: member.id, name: member.name, departmentId: member.departmentId, departmentName: member.departmentName }))} currentUser={currentUser.name} recentScopeKey={searchIdentity ? `${searchIdentity.tenantId}:${searchIdentity.user.id}` : undefined} /> : undefined;
  const normalizedAll = allProjects.map((project) => {
    const latest = view === "manage" ? workbench.getTimeline(project.id)[0] : undefined;
    return {
      ...project,
      subtrack: project.subtrack ?? null,
      owner: project.owner ?? null,
      urgencyScore: project.urgencyScore ?? 0,
      qualityScore: project.qualityScore ?? 0,
      evidenceAuthority: project.evidenceAuthority ?? null,
      riskFlags: project.riskFlags ?? [],
      latestProgress: latest?.summary ?? project.whyNow ?? "暂无推进记录",
      latestAt: latest?.occurredAt ?? project.eventAt,
    };
  });
  const visibleProjectIds = new Set(projects.map((project) => project.id));
  return <ProjectsCenter adminActions={searchIdentity?.roles.includes("org_admin") ? <ProjectAdminEditor /> : undefined} view={view} projects={normalizedAll.filter((project) => visibleProjectIds.has(project.id))} allProjects={normalizedAll} pendingCandidates={pendingCandidates} discoveryJobs={discoveryJobs} currentUser={currentUser.name} filters={{ query, track, owner }} discoveryWorkspace={discoveryWorkspace} />;
}
