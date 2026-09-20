import { requirePageUser } from "@/security/page-auth";
import { RoleDashboard } from "@/components/operating/role-dashboard";
import { getAppDatabase, getAppRepository, getDealTimelineRepository } from "@/db/app";
import { SqliteWorkbenchRepository } from "@/workbench/repository";
import { authenticationRequired } from "@/security/identity-scope";
import { WorkspaceActivity } from "@/components/workspace-activity";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const user = await requirePageUser();
  const database = getAppDatabase();
  const workbench = new SqliteWorkbenchRepository(database);
  const dealTimeline = getDealTimelineRepository();
  const projects = getAppRepository().list()
    .filter((project) => (project.owners ?? (project.owner ? [project.owner] : [])).some(owner => owner === user.name || owner === user.id) && !["pass", "exited"].includes(project.status))
    .map((project) => {
      const latestTimeline = workbench.getTimeline(project.id)[0];
      const latestComment = dealTimeline.listMilestones(project.id)
        .flatMap((milestone) => milestone.comments)
        .filter((comment) => comment.authorId !== user.id && comment.authorName !== user.name)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
      return {
        id: project.id,
        name: project.name,
        track: project.track,
        status: project.status,
        latestProgress: latestTimeline?.summary ?? project.whyNow ?? "暂无推进记录",
        latestAt: latestTimeline?.occurredAt ?? project.eventAt,
        latestComment: latestComment ? { author: latestComment.authorName, source: "project_comment" as const, body: latestComment.body, createdAt: latestComment.createdAt } : null,
      };
    })
    .sort((left, right) => right.latestAt.localeCompare(left.latestAt))
    .slice(0, 6);
  return <RoleDashboard userName={user.name} todayDate={todayInShanghai()} projects={projects} activity={authenticationRequired() ? <WorkspaceActivity compact /> : undefined} />;
}

function todayInShanghai() {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai" }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
