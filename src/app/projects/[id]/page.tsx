import { requirePageUser } from "@/security/page-auth";
import { headers } from "next/headers";
import { resolveWorkspaceIdentity } from "@/security/workspace-session";
import { authenticationRequired, identityScope } from "@/security/identity-scope";
import { ProjectAdminEditor } from "@/components/project-admin-editor";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Project360 } from "@/components/project-360";
import { getAppRepository } from "@/db/app";
import { getAppDatabase, getDealTimelineRepository } from "@/db/app";
import { SqliteWorkbenchRepository } from "@/workbench/repository";
import { listProjectDocuments } from "@/workbench/documents";
import { loadTeamMembers } from "@/workbench/team";
import { DEAL_STAGES } from "@/workbench/deal-stages";
import { analysisProfileRegistry } from "@/workbench/analysis-profiles";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const project = getAppRepository().findById((await params).id);
  return { title: project?.name ?? "项目不存在" };
}

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageUser();
  const identity = authenticationRequired() ? await resolveWorkspaceIdentity(await headers()) : null;
  const canAdmin = Boolean(identity?.roles.includes("org_admin"));
  const id = (await params).id;
  const viewValue = (await searchParams).view;
  const activeView = typeof viewValue === "string" ? viewValue : "overview";
  const project = getAppRepository().findById(id);
  if (!project) notFound();
  const canViewPublicWorkContacts = !authenticationRequired() || (identity?.roles.some((role) => ["org_admin", "investment_manager", "researcher"].includes(role)) ?? false);
  const visibleProject = canViewPublicWorkContacts || !project.companyIntelligence ? project : { ...project, companyIntelligence: { ...project.companyIntelligence, contacts: [] } };
  const database = getAppDatabase();
  const workbench = new SqliteWorkbenchRepository(database);
  // Server components do not inherit the API wrapper's request identity scope.
  const readMilestones = () => getDealTimelineRepository().listMilestones(id);
  const milestones = identity ? identityScope.run(identity, readMilestones) : readMilestones();
  const stages = DEAL_STAGES.map((stage) => ({ id: stage.id, label: stage.label, suggestedMilestones: [...stage.suggestedMilestones] }));
  return <div className="page-shell project-page">{canAdmin && <div className="mb-3 flex justify-end"><ProjectAdminEditor project={visibleProject} /></div>}<Project360 project={visibleProject} activeView={activeView} timeline={workbench.getTimeline(id)} documents={listProjectDocuments(database, id)} knowledge={workbench.listKnowledge({ projectId: id })} team={loadTeamMembers()} profiles={analysisProfileRegistry.list()} milestones={milestones} stages={stages} recentScopeKey={identity ? `${identity.tenantId}:${identity.user.id}` : undefined} /></div>;
}
