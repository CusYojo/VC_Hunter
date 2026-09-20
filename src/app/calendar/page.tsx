import type { Metadata } from "next";
import { WorkspaceActivity } from "@/components/workspace-activity";
import { HubHeader, HubPage } from "@/components/operating/hub-layout";
import { requirePageUser } from "@/security/page-auth";

export const metadata: Metadata = { title: "日程表" };
export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  await requirePageUser();
  return <HubPage><HubHeader eyebrow="Calendar" title="日程表" description="按周查看会议、行程、任务和审批时间" source="real" /><WorkspaceActivity mode="calendar" /></HubPage>;
}
