"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CheckSquare2,
  MapPin,
  MessageSquareText,
  RefreshCcw,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { HubPage, StatusBadge } from "@/components/operating/hub-layout";
import { cn } from "@/lib/utils";
import { demoPersonas } from "@/prototype/navigation";
import { dispatchPrototype, usePrototypeState } from "@/prototype/store";

type ResponseState = "pending" | "accepted" | "declined" | "change_requested";
type ProjectHighlight = {
  id: string;
  name: string;
  track: string;
  status: string;
  latestProgress: string;
  latestAt: string;
  latestComment: {
    author: string;
    authorRole?: string;
    source?: "external" | "project_comment";
    body: string;
    createdAt: string;
  } | null;
};
export function RoleDashboard({
  userName,
  todayDate,
  projects,
  activity,
}: {
  userName: string;
  todayDate: string;
  projects: ProjectHighlight[];
  activity?: ReactNode;
}) {
  const state = usePrototypeState();
  const [feedback, setFeedback] = useState("");
  const persona = demoPersonas.find((item) => item.id === state.persona) ?? demoPersonas[3];
  const openTasks = state.workItems.filter((item) => item.assignee === userName && item.status !== "done");
  const todaySchedule = [...state.meetings]
    .filter((meeting) => dateKeyInShanghai(meeting.startsAt) === todayDate && (meeting.attendees.includes(userName) || meeting.attendees.includes("投资团队")))
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  const projectOpinions = projects.flatMap((project) => project.latestComment
    ? [{ id: `${project.id}:${project.latestComment.createdAt}`, projectName: project.name, author: project.latestComment.author, body: project.latestComment.body, at: project.latestComment.createdAt }]
    : []).sort((left, right) => right.at.localeCompare(left.at));

  function respondToWork(workItemId: string, title: string, response: Exclude<ResponseState, "pending">) {
    dispatchPrototype({ type: "work.respond", workItemId, response });
    setFeedback(`本机演示状态已保存 · ${response === "accepted" ? `已接受待办：${title}` : response === "declined" ? `已拒绝待办：${title}` : `已提出调整意见：${title}`}`);
  }

  function respondToMeeting(meetingId: string, title: string, response: Exclude<ResponseState, "pending">) {
    dispatchPrototype({ type: "meeting.respond", meetingId, response });
    setFeedback(`本机演示状态已保存 · ${response === "accepted" ? `已接受会议：${title}` : response === "declined" ? `已拒绝会议：${title}` : `已建议改期：${title}`}`);
  }

  return (
    <HubPage>
      <header className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{formatDay(todayDate)}</span>
            <span aria-hidden="true">·</span>
            <span>{userName}</span>
            <Badge variant="outline">{activity ? "个人工作空间" : `${persona.label}视图`}</Badge>
          </div>
          <h1 className="mt-2 font-editorial text-3xl font-normal tracking-[-0.03em] sm:text-4xl">今日工作台</h1>
          <p className="mt-2 text-sm text-muted-foreground">项目、意见、待办和日程，一屏看清今天要推进的事。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/work" className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}><CheckSquare2 aria-hidden="true" />全部待办</Link>
          <Link href="/projects?view=discovery" className={cn(buttonVariants(), "min-h-11")}><Sparkles aria-hidden="true" />复核新项目</Link>
        </div>
      </header>

      {feedback && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"><Check className="mr-2 inline size-4" aria-hidden="true" />{feedback}</div>}

      <section className="grid gap-4" aria-labelledby="owned-projects-heading">
        <SectionHeader icon={BriefcaseBusiness} title="我负责的项目" detail={`${projects.length} 个进行中`} href="/projects?view=manage" linkLabel="查看全部项目" />
        {projects.length === 0 ? <EmptyState title="还没有负责的项目" detail="从新项目发现中加入项目，或等待负责人分配。" /> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{projects.slice(0, 6).map((project) => <ProjectSummaryCard key={project.id} project={project} />)}</div>}
      </section>

      {!activity &&
        <section className="grid content-start gap-3" aria-labelledby="today-tasks-heading" aria-label="今日待办">
          <SectionHeader icon={CheckSquare2} title="今日待办" detail={`${openTasks.length} 项待处理 · 本机演示交互`} href="/work" linkLabel="进入协作中心" />
          {openTasks.length === 0 ? <EmptyState title="今日待办已清空" detail="新的指派任务会出现在这里。" /> : openTasks.slice(0, 4).map((item) => {
            const response = item.response ?? "pending";
            return <Card key={item.id} className="py-0 shadow-none"><CardContent className="grid gap-3 p-4"><div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/[0.07] text-primary"><CheckSquare2 className="size-[18px]" aria-hidden="true" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><StatusBadge value={item.status} /><span className="text-xs font-medium text-muted-foreground">{priorityLabel(item.priority)}</span></div><h3 className="mt-2 font-semibold">{item.title}</h3><p className="mt-1 text-xs text-muted-foreground">{item.project?.label ?? "机构事项"} · 截止 {formatTime(item.dueAt)}</p></div></div>{response === "pending" ? <ResponseActions subject={`待办 ${item.title}`} onRespond={(value) => respondToWork(item.id, item.title, value)} changeLabel="提出调整" /> : <ResponseResult value={response} />}</CardContent></Card>;
          })}
        </section>}

      <section className="grid content-start gap-3" aria-labelledby="opinions-heading" aria-label="最新项目批注">
        <SectionHeader icon={MessageSquareText} title="最新项目批注" detail={`${projectOpinions.length} 条新批注`} href="/projects?view=manage" linkLabel="查看项目" />
        {projectOpinions.length === 0 ? <EmptyState title="暂无新批注" detail="其他协作者在项目节点留下的意见会汇总到这里。" /> : <div className="rounded-xl border border-border bg-card">{projectOpinions.slice(0, 4).map((opinion, index) => <article key={opinion.id} className={`p-4 ${index > 0 ? "border-t border-border" : ""}`}><div className="flex items-center justify-between gap-3"><strong className="text-sm">{opinion.projectName}</strong><time className="text-xs text-muted-foreground">{formatCompactDate(opinion.at)}</time></div><p className="mt-2 text-sm leading-6"><span className="font-medium">{opinion.author}：</span>{opinion.body}</p></article>)}</div>}
      </section>

      {activity ??
        <section className="grid content-start gap-3" aria-labelledby="today-schedule-heading" aria-label="今日日程">
          <SectionHeader icon={CalendarDays} title="今日日程" detail={`${todaySchedule.length} 项安排 · 本机演示交互`} href="/calendar" linkLabel="打开日历" />
          {todaySchedule.length === 0 ? <EmptyState title="今天没有日程" detail="会议邀请和行程安排会显示在这里。" /> : todaySchedule.map((meeting) => {
            const response = meeting.response ?? "pending";
            return <Card key={meeting.id} className="py-0 shadow-none"><CardContent className="grid gap-3 p-4"><div className="flex gap-3"><div className="w-12 shrink-0 border-r border-border pr-3 text-center"><strong className="font-mono text-sm tabular-nums">{formatClock(meeting.startsAt)}</strong><span className="mt-1 block text-[11px] text-muted-foreground">{scheduleKind(meeting.title)}</span></div><div className="min-w-0 flex-1"><h3 className="font-semibold">{meeting.title}</h3><p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><MapPin className="size-3.5 shrink-0" aria-hidden="true" />{meeting.location}</p><p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-muted-foreground"><UserRound className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{meeting.attendees.join("、")}</p>{meeting.project && <p className="mt-1 text-xs font-medium text-primary">关联项目：{meeting.project.label}</p>}</div></div>{response === "pending" ? <ResponseActions subject={`会议 ${meeting.title}`} onRespond={(value) => respondToMeeting(meeting.id, meeting.title, value)} changeLabel="建议改期" /> : <ResponseResult value={response} />}</CardContent></Card>;
          })}
        </section>}
    </HubPage>
  );
}

function ProjectSummaryCard({ project }: { project: ProjectHighlight }) {
  return <article aria-label={`${project.name}项目摘要`} className="flex min-h-60 flex-col rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/35"><div className="flex items-start justify-between gap-3"><div className="flex flex-wrap gap-2"><StatusBadge value={project.status} /><Badge variant="secondary">{project.track}</Badge></div><time className="text-xs text-muted-foreground">{formatCompactDate(project.latestAt)}</time></div><h3 className="mt-5 text-xl font-semibold tracking-tight">{project.name}</h3><div className="mt-4 border-l-2 border-primary/30 pl-3"><p className="text-[11px] font-semibold text-muted-foreground">最新进展</p><p className="mt-1 line-clamp-2 text-sm leading-6">{project.latestProgress}</p></div>{project.latestComment ? <div className="mt-3 rounded-lg bg-muted/50 p-3"><p className="text-[11px] font-semibold text-muted-foreground">最新意见 · {project.latestComment.authorRole ?? "项目协作者"}</p><p className="mt-1 line-clamp-2 text-sm leading-5">{project.latestComment.author}：{project.latestComment.body}</p></div> : <p className="mt-3 text-xs text-muted-foreground">暂无新的项目批注</p>}<Link aria-label={`打开${project.name}`} href={`/projects/${project.id}`} className="mt-auto inline-flex min-h-11 items-center justify-end gap-1.5 pt-4 text-sm font-semibold text-primary hover:underline">进入项目<ArrowRight className="size-4" aria-hidden="true" /></Link></article>;
}

function SectionHeader({ icon: Icon, title, detail, href, linkLabel }: { icon: typeof BriefcaseBusiness; title: string; detail: string; href: string; linkLabel: string }) {
  return <div className="flex items-end justify-between gap-3"><div><div className="flex items-center gap-2"><Icon className="size-5 text-primary" aria-hidden="true" /><h2 id={headingId(title)} className="text-xl font-semibold tracking-tight">{title}</h2></div><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div><Link href={href} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-primary hover:bg-primary/[0.05]">{linkLabel}<ArrowRight className="size-4" aria-hidden="true" /></Link></div>;
}

function ResponseActions({ subject, changeLabel, onRespond }: { subject: string; changeLabel: string; onRespond: (response: Exclude<ResponseState, "pending">) => void }) {
  return <div className="grid grid-cols-3 gap-2 border-t border-border pt-3"><Button variant="ghost" className="min-h-11" aria-label={`拒绝${subject}`} onClick={() => onRespond("declined")}><X aria-hidden="true" />拒绝</Button><Button variant="outline" className="min-h-11" aria-label={`${changeLabel}${subject}`} onClick={() => onRespond("change_requested")}><RefreshCcw aria-hidden="true" />{changeLabel}</Button><Button className="min-h-11" aria-label={`接受${subject}`} onClick={() => onRespond("accepted")}><Check aria-hidden="true" />接受</Button></div>;
}

function ResponseResult({ value }: { value: Exclude<ResponseState, "pending"> }) {
  const label = value === "accepted" ? "已接受" : value === "declined" ? "已拒绝" : "已提出调整";
  return <div className="flex min-h-11 items-center justify-end border-t border-border pt-3 text-sm font-medium text-muted-foreground"><Check className="mr-1.5 size-4" aria-hidden="true" />{label}</div>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center"><strong className="text-sm">{title}</strong><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>;
}

function headingId(title: string) {
  return title === "我负责的项目" ? "owned-projects-heading" : title === "今日待办" ? "today-tasks-heading" : title === "今日日程" ? "today-schedule-heading" : title === "最新项目批注" ? "opinions-heading" : "agent-review-heading";
}

export function dateKeyInShanghai(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai" }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function formatDay(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long", timeZone: "Asia/Shanghai" }).format(new Date(`${value}T00:00:00+08:00`)); }
function formatTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).format(new Date(value)); }
function formatClock(value: string) { return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).format(new Date(value)); }
function formatCompactDate(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", timeZone: "Asia/Shanghai" }).format(new Date(value)); }
function priorityLabel(value: string) { return ({ urgent: "紧急", high: "高优先", medium: "普通", low: "低优先" }[value] ?? value); }
function scheduleKind(title: string) { return /出差|行程|拜访/.test(title) ? "行程" : "会议"; }
