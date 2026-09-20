import { requirePageUser } from "@/security/page-auth";
import type { Metadata } from "next";
import { ResourcesCenter } from "@/components/operating/resources-center";
import { getAppDatabase, getIntelligenceRepository } from "@/db/app";

import { listOperations } from "@/workbench/business-operations";
import { getCurrentTenantId } from "@/workbench/team";
import { authenticationRequired } from "@/security/identity-scope";
import { resolveWorkspaceIdentity } from "@/security/workspace-session";
import { headers } from "next/headers";

export const metadata: Metadata = { title: "资源中心" };
export const dynamic = "force-dynamic";

export default async function ResourcesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageUser();
  const identity = authenticationRequired() ? await resolveWorkspaceIdentity(await headers()) : null;
  const value = (await searchParams).view;
  const repository = getIntelligenceRepository();
  const canViewPublicWorkContacts = !authenticationRequired() || (identity?.roles.some((role) => ["org_admin", "investment_manager", "researcher"].includes(role)) ?? false);
  const people = repository.listPeopleDetailed(canViewPublicWorkContacts);
  const institutions = repository.listInvestors();
  const actor = { tenantId: getCurrentTenantId(), id: "page-read", roles: [] };
  const contacts = listOperations(getAppDatabase(), actor, "contact");
  const experts = listOperations(getAppDatabase(), actor, "expert");
  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.parse(today) + 7 * 86400000).toISOString().slice(0, 10);
  const followUps = [...contacts, ...experts].filter((item) => typeof item.data.nextContactDate === "string" && item.data.nextContactDate >= today && item.data.nextContactDate <= until).length;
  return <ResourcesCenter initialView={typeof value === "string" ? value : "contacts"} realSummary={{ people: people.length, institutions: institutions.length, experts: experts.length, contacts: contacts.length, followUps }} realPeople={people.map((person) => ({ id: person.id, name: person.name, organization: person.currentOrganization, title: person.currentTitle, track: person.track, companyRoles: person.companyRoles, previousStartups: person.previousStartups, technicalEvidenceCount: person.technicalEvidenceCount, careerEvents24m: person.careerEvents24m, education: person.education, employment: person.employment, technicalBackground: person.technicalBackground, publications: person.publications, patents: person.patents, homepage: person.homepage, reports: person.reports, publicContacts: person.publicContacts }))} realInstitutions={institutions.map((institution) => ({ id: institution.id, name: institution.name, headquarters: institution.headquarters, tracks: institution.focusTracks, portfolioCount: institution.portfolioCount }))} />;
}
