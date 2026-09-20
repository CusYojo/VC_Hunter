import type { ReactNode } from "react";
import Link from "next/link";
import { Activity, ArrowRight, CircleAlert, Database, FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export type HubTab = { id: string; label: string };

export function SourceBadge({ source }: { source: "real" | "demo" }) {
  return source === "real"
    ? <Badge variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-800"><Database aria-hidden="true" />真实数据</Badge>
    : <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 text-amber-900"><FlaskConical aria-hidden="true" />演示数据</Badge>;
}

export function HubHeader({ eyebrow, title, source = "demo", actions }: { eyebrow: string; title: string; description: string; source?: "real" | "demo"; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-5 rounded-lg border border-border bg-card p-5 sm:p-6 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-3xl">
        <div className="mb-2.5 flex flex-wrap items-center gap-2"><p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.17em] text-primary"><span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />{eyebrow}</p><SourceBadge source={source} /></div>
        <h1 className="font-editorial text-balance text-3xl font-normal tracking-[-0.025em] sm:text-[2.25rem]">{title}</h1>
      </div>
      {actions && <div className="relative flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function HubTabs({ basePath, tabs, active }: { basePath: string; tabs: ReadonlyArray<HubTab>; active: string }) {
  return (
    <nav aria-label="页面视图" className="flex w-full gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1 sm:w-fit">
      {tabs.map((tab) => <Link key={tab.id} href={`${basePath}?view=${tab.id}`} aria-current={active === tab.id ? "page" : undefined} className={`min-h-10 shrink-0 rounded-md px-3.5 py-2.5 text-sm font-medium transition-colors ${active === tab.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/75 hover:text-foreground"}`}>{tab.label}</Link>)}
    </nav>
  );
}

export function MetricCards({ items }: { items: ReadonlyArray<{ label: string; value: string | number; detail: string; tone?: "blue" | "orange" | "red" }> }) {
  return (
    <section aria-label="关键指标" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => {
        const danger = item.tone === "red";
        const warning = item.tone === "orange";
        const Icon = danger ? CircleAlert : Activity;
        const iconTone = danger ? "bg-red-50 text-red-700 ring-red-100" : warning ? "bg-amber-50 text-amber-700 ring-amber-100" : "bg-primary/[0.07] text-primary ring-primary/10";
        return <article key={item.label}><Card className="relative h-full overflow-hidden py-0"><CardContent className="p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><span className="text-sm font-medium text-muted-foreground">{item.label}</span><span className={`grid size-8 place-items-center rounded-lg ring-1 ${iconTone}`}><Icon className="size-4" aria-hidden="true" /></span></div><strong className="mt-4 block text-3xl font-semibold tracking-[-0.04em] tabular-nums text-foreground">{item.value}</strong><small className="mt-1.5 block text-xs leading-5 text-muted-foreground">{item.detail}</small><span className={`absolute inset-x-0 bottom-0 h-0.5 ${danger ? "bg-red-500" : warning ? "bg-amber-500" : "bg-primary"}`} aria-hidden="true" /></CardContent></Card></article>;
      })}
    </section>
  );
}

export function SectionHeading({ title, actionHref, actionLabel }: { title: string; description?: string; actionHref?: string; actionLabel?: string }) {
  return <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><h2 className="text-lg font-semibold">{title}</h2>{actionHref && actionLabel && <Link href={actionHref} className="inline-flex min-h-11 items-center gap-1 py-2 text-sm font-medium text-primary hover:underline">{actionLabel}<ArrowRight className="size-4" aria-hidden="true" /></Link>}</div>;
}

export function StatusBadge({ value }: { value: string }) {
  const success = ["done", "approved", "paid", "completed", "effective", "ready", "active"].includes(value);
  const danger = ["blocked", "returned", "failed", "overdue", "high"].includes(value);
  const labels: Record<string, string> = { todo: "待处理", in_progress: "进行中", blocked: "受阻", done: "已完成", draft: "草稿", pending: "待审批", approved: "已批准", returned: "已退回", paid: "已支付", overdue: "已逾期", running: "运行中", queued: "排队中", completed: "已完成", failed: "失败", needs_review: "待复核", effective: "已生效", review: "审查中", signing: "签署中", ready: "已就绪", scheduled: "已安排", processing: "处理中", active: "启用", normal: "正常", attention: "关注", high: "高风险", new: "新发现", researching: "研究中", contacting: "接触中", dd: "尽调", ic: "投决会", invested: "已投", exited: "已退出", pass: "暂不跟进" };
  return <Badge variant="outline" className={success ? "border-emerald-200 bg-emerald-50 text-emerald-800" : danger ? "border-red-200 bg-red-50 text-red-800" : "border-primary/20 bg-primary/[0.065] text-primary"}>{labels[value] ?? value}</Badge>;
}

export function HubPage({ children }: { children: ReactNode }) {
  return <div className="mx-auto grid w-full max-w-[96rem] gap-5 px-4 py-5 sm:px-6 lg:gap-6 lg:px-8 lg:py-7">{children}</div>;
}
