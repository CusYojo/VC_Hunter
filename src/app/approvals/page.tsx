import { requirePageUser } from "@/security/page-auth";
import type { Metadata } from "next";
import { ApprovalsCenter } from "@/components/operating/approvals-center";
import { authenticationRequired } from "@/security/identity-scope";
import { WorkspaceActivity } from "@/components/workspace-activity";
import { HubPage, HubHeader } from "@/components/operating/hub-layout";

export const metadata: Metadata = { title: "审批中心" };

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageUser();
  if (authenticationRequired()) return <HubPage><HubHeader eyebrow="Approvals" title="项目资料审批" description="指定审核人、处理意见与审计记录" source="real" /><WorkspaceActivity onlyKind="approval" /></HubPage>;
  const value = (await searchParams).view;
  return <ApprovalsCenter initialView={typeof value === "string" ? value : "inbox"} />;
}
