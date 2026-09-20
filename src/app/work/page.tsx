import { requirePageUser } from "@/security/page-auth";
import type { Metadata } from "next";
import { WorkCenter } from "@/components/operating/work-center";
import { authenticationRequired } from "@/security/identity-scope";
import { WorkspaceActivity } from "@/components/workspace-activity";
import { HubPage, HubHeader } from "@/components/operating/hub-layout";

export const metadata: Metadata = { title: "我的待办" };

export default async function WorkPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageUser();
  if (authenticationRequired()) return <HubPage><HubHeader eyebrow="My work" title="我的待办" description="任务与资料审批集中处理" source="real" /><WorkspaceActivity mode="tasks" /></HubPage>;
  const value = (await searchParams).view;
  return <WorkCenter initialView={typeof value === "string" ? value : "tasks"} />;
}
