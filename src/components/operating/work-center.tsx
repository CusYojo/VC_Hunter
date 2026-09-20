"use client";

import { useMemo, useState } from "react";
import { CalendarDays, Check, FileText, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HubHeader, HubPage, HubTabs, MetricCards, SectionHeading, SourceBadge, StatusBadge } from "@/components/operating/hub-layout";
import { MonthCalendar } from "@/components/operating/month-calendar";
import { dispatchPrototype, usePrototypeState } from "@/prototype/store";

const tabs = [{ id: "tasks", label: "任务" }, { id: "calendar", label: "日历" }, { id: "meetings", label: "会议" }, { id: "reports", label: "日报周报" }, { id: "okr", label: "OKR / KPI" }] as const;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).format(new Date(value));
}

export function WorkCenter({ initialView }: { initialView: string }) {
  const state = usePrototypeState();
  const active = tabs.some((tab) => tab.id === initialView) ? initialView : "tasks";
  const [updated, setUpdated] = useState(0);
  const pending = useMemo(() => state.workItems.filter((item) => item.status !== "done"), [state.workItems]);

  function complete(workItemId: string) {
    dispatchPrototype({ type: "work.complete", workItemId });
    setUpdated((value) => value + 1);
  }

  return (
    <HubPage>
      <HubHeader eyebrow="Execution center" title="协作中心" description="把项目动作、会议结论与个人目标放在同一工作队列中，减少跨工具切换。" />
      <HubTabs basePath="/work" tabs={tabs} active={active} />
      <MetricCards items={[{ label: "未完成任务", value: pending.length, detail: "跨项目与运营事项" }, { label: "今日会议", value: state.meetings.filter((meeting) => meeting.startsAt.startsWith("2026-09-03")).length, detail: "含线上与现场会议" }, { label: "本周逾期", value: 1, detail: "需要负责人确认", tone: "red" }, { label: "周报完成率", value: "82%", detail: "团队提交进度", tone: "orange" }]} />
      {updated > 0 && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"><strong>任务已完成</strong><span className="ml-2">{updated} 项刚刚更新并已保存到本机</span></div>}

      {active === "tasks" && <section className="grid gap-3"><SectionHeading title="我的工作队列" description="优先处理受阻和高优先级事项" />{state.workItems.map((item) => <Card key={item.id} className="py-0 shadow-none"><CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><StatusBadge value={item.status} /><span className="text-xs font-medium text-muted-foreground">{item.priority.toUpperCase()}</span><SourceBadge source="demo" /></div><h3 className="mt-2 font-semibold">{item.title}</h3><p className="mt-1 text-sm text-muted-foreground">{item.assignee} · 截止 {formatDate(item.dueAt)}{item.project ? ` · ${item.project.label}` : ""}</p></div>{item.status !== "done" && <Button variant="outline" className="min-h-11" aria-label={`完成 ${item.title}`} onClick={() => complete(item.id)}><Check aria-hidden="true" />完成</Button>}</CardContent></Card>)}</section>}

      {active === "calendar" && <section className="grid gap-3"><SectionHeading title="团队日历" description="会议、尽调里程碑和审批截止日" /><MonthCalendar meetings={state.meetings} workItems={state.workItems} /></section>}

      {active === "meetings" && <section className="grid gap-3"><SectionHeading title="会议与 AI 纪要" description="会前材料、参会人、结论与后续任务" />{state.meetings.map((meeting) => <Card key={meeting.id} className="py-0 shadow-none"><CardContent className="flex items-center gap-4 p-4"><CalendarDays className="size-5 text-primary" aria-hidden="true" /><div className="flex-1"><h3 className="font-semibold">{meeting.title}</h3><p className="text-sm text-muted-foreground">{meeting.attendees.join("、")} · {meeting.location}</p></div><StatusBadge value={meeting.summaryStatus} /></CardContent></Card>)}</section>}

      {active === "reports" && <section className="grid gap-3"><SectionHeading title="日报与周报" description="自动聚合项目变化，提交前由负责人确认" /><div className="grid gap-3 md:grid-cols-2"><Card className="shadow-none"><CardHeader><FileText className="size-5 text-primary" aria-hidden="true" /><CardTitle>先进制造周报 · W36</CardTitle></CardHeader><CardContent><p className="text-sm leading-6 text-muted-foreground">12 个项目发生变化，3 个高优先级风险，2 个项目建议进入下一阶段。</p><Button className="mt-4">查看并发布</Button></CardContent></Card><Card className="shadow-none"><CardHeader><FileText className="size-5 text-primary" aria-hidden="true" /><CardTitle>个人日报 · 9 月 3 日</CardTitle></CardHeader><CardContent><p className="text-sm leading-6 text-muted-foreground">已完成 4 项，待跟进 3 项。系统已关联会议与审批动作。</p><Button variant="outline" className="mt-4">编辑草稿</Button></CardContent></Card></div></section>}

      {active === "okr" && <section className="grid gap-3"><SectionHeading title="团队目标" description="从项目推进与研究交付自动回填" /><Card className="shadow-none"><CardContent className="grid gap-4 p-5"><div className="flex items-center gap-3"><Target className="size-5 text-primary" aria-hidden="true" /><div><h3 className="font-semibold">O1：形成先进制造赛道系统性覆盖</h3><p className="text-sm text-muted-foreground">负责人：投资一组 · Q3</p></div></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full w-[68%] bg-primary" /></div><p className="text-sm text-muted-foreground">68% · 已覆盖 34/50 家重点企业</p></CardContent></Card></section>}
    </HubPage>
  );
}
