import { requirePageUser } from "@/security/page-auth";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getIntelligenceRepository, getInvestorDirectoryRepository } from "@/db/app";
import { InvestorProfile } from "@/components/investor-profile";

export const metadata: Metadata = { title: "机构档案" };
export const dynamic = "force-dynamic";

export default async function InvestorPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const investor = getInvestorDirectoryRepository().findById((await params).id);
  if (!investor) notFound();
  const names = new Set([investor.name, investor.englishName, ...investor.aliases].filter(Boolean).map((name) => name!.trim().toLocaleLowerCase("zh-CN")));
  const people = getIntelligenceRepository().listPeople().filter((person) => person.currentOrganization && names.has(person.currentOrganization.trim().toLocaleLowerCase("zh-CN")));
  return <InvestorProfile investor={investor} people={people} canEdit={user.capabilities.includes("assign")} />;
}
