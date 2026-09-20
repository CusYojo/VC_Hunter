import { authenticationRequired } from "@/security/identity-scope";
import { OrganizationWorkspace } from "@/components/organization/organization-workspace";
import { requireOrgAdmin } from "@/organization/server";
import { requirePageUser } from "@/security/page-auth";
import type { Metadata } from "next";
import { AdminCenter } from "@/components/operating/admin-center";
import { SourceOpsClient } from "@/components/source-ops-client";
import { getAppDatabase } from "@/db/app";
import { listAgentSearchPlans, listDiscoveryCandidates, listProjectCandidates, listSources, listWebSearchLeads } from "@/repositories/dashboard-data";

export const metadata: Metadata = { title: "系统管理" };

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageUser();
  if (authenticationRequired()) {
    const actor = await requireOrgAdmin();
    return <OrganizationWorkspace mode="admin" currentAccountId={actor.accountId} />;
  }
  const value = (await searchParams).view;
  const initialView = typeof value === "string" ? value : "users";
  const database = getAppDatabase();
  const sourceWorkspace = initialView === "sources" ? <SourceOpsClient sources={listSources(database)} candidates={listDiscoveryCandidates(database)} webLeads={listWebSearchLeads(database)} agentPlans={listAgentSearchPlans(database)} projectCandidates={listProjectCandidates(database)} /> : undefined;
  return <AdminCenter initialView={initialView} sourceWorkspace={sourceWorkspace} />;
}
