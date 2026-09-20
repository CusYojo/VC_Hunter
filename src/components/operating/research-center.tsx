import type { ComponentType } from "react";
import { AlertTriangle, BookOpenCheck, FileText, Radar, SearchCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { HubHeader, HubPage, HubTabs, MetricCards, SectionHeading, SourceBadge } from "@/components/operating/hub-layout";

const tabs = [{ id: "workspace", label: "研究工作区" }, { id: "reports", label: "报告" }, { id: "knowledge", label: "知识库" }, { id: "technology", label: "技术情报" }, { id: "alerts", label: "告警" }] as const;
type ResearchItem = { title: string; detail: string; icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>; source: "real" | "demo" };

export function ResearchCenter({ initialView, realSummary, realData }: {
  initialView: string;
  realSummary: { reports: number; knowledge: number; alerts: number; openQuestions?: number };
  realData?: {
    reports: Array<{ id: string; title: string; detail: string }>;
    knowledge: Array<{ id: string; title: string; content: string; status: string }>;
    technology: Array<{ id: string; name: string; track: string; subtrack: string | null; definition: string; maturity: string; keyMetrics: string[]; investmentSummary: string }>;
    alerts: Array<{ id: string; projectName: string; reason: string; severity: string }>;
  };
}) {
  const active = tabs.some((tab) => tab.id === initialView) ? initialView : "workspace";
  const items: ResearchItem[] = active === "reports"
    ? (realData?.reports.map((item) => ({ title: item.title, detail: item.detail, icon: FileText, source: "real" as const })) ?? [])
    : active === "knowledge"
      ? (realData?.knowledge.map((item) => ({ title: item.title, detail: `${item.status} · ${item.content.slice(0, 90)}`, icon: BookOpenCheck, source: "real" as const })) ?? [])
      : active === "technology"
        ? (realData?.technology.map((item) => ({ title: item.name, detail: `${maturityLabel(item.maturity)} · ${item.definition}`, icon: Radar, source: "real" as const })) ?? [])
        : active === "alerts"
          ? (realData?.alerts.map((item) => ({ title: item.projectName, detail: `${item.severity} · ${item.reason}`, icon: AlertTriangle, source: "real" as const })) ?? [])
          : [{ title: "行业研究任务", detail: `${realSummary.reports} 项报告与研究任务`, icon: SearchCheck, source: "real" }, { title: "知识沉淀", detail: `${realSummary.knowledge} 条知识沉淀`, icon: BookOpenCheck, source: "real" }];

  return <HubPage>
    <HubHeader eyebrow="Evidence-first research" title="研究中心" description="从任务、证据和 Open Questions 出发，形成可复核、可复用的行业与项目判断。" source="real" />
    <HubTabs basePath="/research" tabs={tabs} active={active} />
    <MetricCards items={[{ label: "研究与报告", value: realSummary.reports, detail: "真实 API / 数据库" }, { label: "知识条目", value: realSummary.knowledge, detail: "已审核与草稿" }, { label: "高优告警", value: realSummary.alerts, detail: "需在 24 小时内确认", tone: "red" }, { label: "Open Questions", value: realSummary.openQuestions ?? 0, detail: "项目中待核验的问题", tone: "orange" }]} />
    <section className="grid gap-3">
      <SectionHeading title={tabs.find((tab) => tab.id === active)?.label ?? "研究工作区"} description="每条结论都可回到原始证据" />
      {active === "technology" && realData?.technology.length ? <div className="grid gap-3 md:grid-cols-2">{realData.technology.map((item) => <Card id={`technology-${item.id}`} key={item.id} className="scroll-mt-24 shadow-none"><CardContent className="p-5"><div className="flex items-start gap-3"><Radar className="mt-0.5 size-5 text-primary" aria-hidden="true" /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{item.name}</h3><SourceBadge source="real" /><span className="text-xs text-muted-foreground">{item.track}{item.subtrack ? ` / ${item.subtrack}` : ""}</span></div><p className="mt-2 text-sm leading-6 text-muted-foreground">{item.definition}</p></div></div><dl className="mt-4 grid gap-3 border-t pt-4 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">成熟度</dt><dd className="mt-1 font-medium">{maturityLabel(item.maturity)}</dd></div><div><dt className="text-muted-foreground">关键指标</dt><dd className="mt-1 font-medium">{item.keyMetrics.join("、") || "待补充"}</dd></div></dl>{item.investmentSummary && <p className="mt-4 rounded-lg bg-primary/[0.045] p-3 text-sm leading-6"><strong className="text-primary">投资摘要：</strong>{item.investmentSummary}</p>}</CardContent></Card>)}</div> : items.length === 0 ? <div className="rounded-xl border border-dashed bg-white p-10 text-center text-sm text-muted-foreground">当前视图暂无真实记录</div> : <div className="grid gap-3 md:grid-cols-2">{items.map((item) => <Card key={item.title} className="shadow-none"><CardContent className="flex gap-4 p-5"><item.icon className="size-5 text-primary" aria-hidden={true} /><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{item.title}</h3><SourceBadge source={item.source} /></div><p className="mt-2 text-sm leading-6 text-muted-foreground">{item.detail}</p></div></CardContent></Card>)}</div>}
    </section>
  </HubPage>;
}

function maturityLabel(value: string): string { return ({ concept: "概念阶段", laboratory: "实验室阶段", engineering_validation: "工程验证", pilot: "中试阶段", commercial: "商业化", unknown: "成熟度待核" } as Record<string, string>)[value] ?? value; }
