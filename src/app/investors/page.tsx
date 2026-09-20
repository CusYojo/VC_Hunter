import { requirePageUser } from "@/security/page-auth";
import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { getInvestorDirectoryRepository } from "@/db/app";
import { InvestorDirectory } from "@/components/investor-directory";
import { HubPage } from "@/components/operating/hub-layout";

export const metadata: Metadata = { title: "机构追踪" };
export const dynamic = "force-dynamic";

export default async function InvestorsPage() {
  await requirePageUser();
  const directory = getInvestorDirectoryRepository().list({ perPage: 60, page: 1 });
  return <HubPage><header className="rounded-lg border border-border bg-card p-5 sm:p-6"><div className="mb-3 flex items-center gap-2 text-xs font-medium text-primary"><Building2 className="size-4" aria-hidden="true" />机构档案 / 独立名录</div><h1 className="text-3xl font-semibold tracking-tight">机构追踪</h1><p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">管理投资机构、核心成员、投资风格和公开投资记录。机构独立于项目库，来源与核验口径保留在档案中。</p></header><InvestorDirectory initial={directory.items} total={directory.total} /></HubPage>;
}
