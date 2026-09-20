"use client";

import Link from "next/link";
import { CheckCircle2, CircleDashed, Landmark, MessageSquareText, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SourceBadge, StatusBadge } from "@/components/operating/hub-layout";
import { usePrototypeState } from "@/prototype/store";

const views = [
  { id: "overview", label: "概览" },
  { id: "timeline", label: "时间线" },
  { id: "research", label: "研究" },
  { id: "meetings", label: "会议" },
  { id: "tasks", label: "任务" },
  { id: "dd", label: "尽职调查" },
  { id: "ic", label: "投决会" },
  { id: "transaction", label: "交易" },
  { id: "portfolio", label: "投后" },
  { id: "documents", label: "文档" },
  { id: "finance", label: "财务" },
  { id: "comments", label: "评论" },
] as const;

type ProjectView = typeof views[number]["id"];

const panelCopy: Record<ProjectView, { title: string; description: string; items: Array<{ title: string; detail: string; status: string }> }> = {
  overview: { title: "项目工作区", description: "把研究、决策、交易与投后信息汇集在同一个项目上下文。", items: [{ title: "下一决策点", detail: "完成商业尽调并提交 IC 预审", status: "in_progress" }, { title: "关键风险", detail: "客户集中度与量产爬坡需要持续验证", status: "attention" }] },
  timeline: { title: "项目时间线", description: "事实、资料、判断与系统操作按时间可追溯。", items: [{ title: "最近更新", detail: "访谈结论和材料解析结果已进入时间线", status: "completed" }] },
  research: { title: "项目研究", description: "研究任务、证据和 Open Questions 共同形成可复核判断。", items: [{ title: "行业与竞品研究", detail: "8 个开放问题 · 12 条字段级证据", status: "needs_review" }] },
  meetings: { title: "项目会议", description: "会议安排、参会人和 AI 纪要与项目自动关联。", items: [{ title: "创始人访谈", detail: "今天 14:00 · 纪要将在会议后生成", status: "scheduled" }] },
  tasks: { title: "项目任务", description: "按阶段集中查看负责人、截止时间和阻塞项。", items: [{ title: "补齐客户访谈", detail: "负责人：投资经理 · 今天到期", status: "in_progress" }] },
  dd: { title: "尽职调查清单", description: "按商业、财务、法务与技术四条线管理问题和证据。", items: [{ title: "商业尽调", detail: "已完成 7 / 10 项", status: "in_progress" }, { title: "财务尽调", detail: "收入确认材料待补充", status: "blocked" }, { title: "法务尽调", detail: "核心合同抽样完成", status: "completed" }] },
  ic: { title: "投决会材料", description: "将投资建议、核心争议与表决条件组织为统一版本。", items: [{ title: "IC Memo", detail: "版本 v3 · 等待 Partner 预审", status: "needs_review" }, { title: "表决条件", detail: "客户集中度纳入交割条件", status: "pending" }] },
  transaction: { title: "交易执行", description: "跟踪协议、用印、交割条件与付款节点。", items: [{ title: "增资协议", detail: "法务红线版本审查中", status: "review" }, { title: "首期付款", detail: "交割条件满足后触发", status: "pending" }] },
  portfolio: { title: "投后管理", description: "跟踪经营指标、董事会事项和风险变化。", items: [{ title: "月度经营数据", detail: "下次更新：9 月 10 日", status: "scheduled" }, { title: "投后风险", detail: "量产良率连续两月低于计划", status: "attention" }] },
  documents: { title: "项目文档", description: "真实项目资料与字段级证据继续由原工作台承载。", items: [{ title: "材料完整性", detail: "已解析文档和证据见下方证据工作台", status: "completed" }] },
  finance: { title: "项目财务", description: "关联费用、投资付款、预算与所属基金。", items: [{ title: "计划投资额", detail: "¥30,000,000 · 硬科技成长二期基金", status: "approved" }, { title: "本期付款", detail: "¥18,000,000 · 等待交割", status: "pending" }] },
  comments: { title: "协作评论", description: "将项目讨论固定在实体上下文，关键决定同步进入时间线。", items: [{ title: "Partner 评论", detail: "请在 IC 前补充客户续签概率的敏感性分析。", status: "needs_review" }] },
};

export function ProjectWorkspace({ projectId, projectName, activeView }: { projectId: string; projectName: string; activeView: string }) {
  const state = usePrototypeState();
  const active: ProjectView = views.some((view) => view.id === activeView) ? activeView as ProjectView : "overview";
  const panel = panelCopy[active];
  const relatedTasks = state.workItems.filter((item) => item.project?.id === projectId || item.project?.label === projectName);
  const relatedMeetings = state.meetings.filter((item) => item.project?.id === projectId || item.project?.label === projectName);
  const summary = active === "tasks" && relatedTasks.length > 0
    ? relatedTasks.map((item) => ({ title: item.title, detail: `${item.assignee} · ${new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", timeZone: "Asia/Shanghai" }).format(new Date(item.dueAt))} 到期`, status: item.status }))
    : active === "meetings" && relatedMeetings.length > 0
      ? relatedMeetings.map((item) => ({ title: item.title, detail: `${item.location} · ${item.attendees.join("、")}`, status: item.summaryStatus }))
      : panel.items;

  return (
    <section className="my-5 grid gap-4" aria-label={`${projectName}项目工作区`}>
      <nav aria-label="项目工作区视图" className="-mx-1 flex gap-1 overflow-x-auto py-1">
        {views.map((view) => <Link key={view.id} href={`/projects/${projectId}?view=${view.id}`} aria-current={active === view.id ? "page" : undefined} className={`min-h-11 shrink-0 rounded-lg px-3 py-2.5 text-sm font-medium ${active === view.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>{view.label}</Link>)}
      </nav>
      <Card className="border-primary/15 bg-card py-0 shadow-none">
        <CardContent className="grid gap-4 p-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div>
            <div className="flex flex-wrap items-center gap-2"><SourceBadge source="demo" /><span className="text-xs text-muted-foreground">项目真实资料仍在下方证据工作台</span></div>
            <h2 className="mt-3 text-lg font-semibold">{panel.title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{panel.description}</p>
          </div>
          <div className="grid gap-2">
            {summary.map((item) => <article key={item.title} className="flex min-h-16 items-center gap-3 rounded-lg border bg-card p-3"><ProjectStateIcon status={item.status} /><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold">{item.title}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p></div><StatusBadge value={item.status} /></article>)}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function ProjectStateIcon({ status }: { status: string }) {
  if (["completed", "approved", "done", "effective"].includes(status)) return <CheckCircle2 className="size-5 shrink-0 text-emerald-600" aria-hidden="true" />;
  if (["blocked", "attention", "returned"].includes(status)) return <ShieldCheck className="size-5 shrink-0 text-amber-600" aria-hidden="true" />;
  if (["payment", "paid"].includes(status)) return <Landmark className="size-5 shrink-0 text-primary" aria-hidden="true" />;
  if (status === "needs_review") return <MessageSquareText className="size-5 shrink-0 text-violet-600" aria-hidden="true" />;
  return <CircleDashed className="size-5 shrink-0 text-primary" aria-hidden="true" />;
}
