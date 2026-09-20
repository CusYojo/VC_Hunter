"use client";

import { useState } from "react";
import { Check, ChevronRight, Clock3, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { HubHeader, HubPage, HubTabs, MetricCards, SectionHeading, SourceBadge, StatusBadge } from "@/components/operating/hub-layout";
import type { ApprovalRequest } from "@/prototype/contracts";
import { dispatchPrototype, usePrototypeState } from "@/prototype/store";
import { isDemoActionVisible } from "@/prototype/navigation";

const tabs = [{ id: "inbox", label: "待我审批" }, { id: "outbox", label: "我发起的" }, { id: "completed", label: "已完成" }] as const;
const typeLabels: Record<ApprovalRequest["requestType"], string> = { project: "立项", dd: "尽调", ic: "IC", trip: "出差", expense: "报销", payment: "请款", seal: "用印", contract: "合同", purchase: "采购", leave: "请假" };

function formatAmount(value: number | undefined) {
  return value === undefined ? null : new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: value < 10000 ? 2 : 0 }).format(value);
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).format(new Date(value));
}

export function ApprovalsCenter({ initialView }: { initialView: string }) {
  const state = usePrototypeState();
  const active = tabs.some((tab) => tab.id === initialView) ? initialView : "inbox";
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const selected = state.approvals.find((item) => item.id === selectedId) ?? null;
  const canDecide = selected ? selected.requestType === "ic" || selected.requestType === "project" || selected.requestType === "dd"
    ? isDemoActionVisible(state.persona, "approve_investment")
    : selected.requestType === "contract" || selected.requestType === "seal"
      ? isDemoActionVisible(state.persona, "review_contract")
      : isDemoActionVisible(state.persona, "complete_payment") : false;
  const requests = state.approvals.filter((item) => active === "inbox" ? item.status === "pending" : active === "outbox" ? item.applicant === "示例经理" : ["approved", "returned"].includes(item.status));

  function decide(decision: "approved" | "returned") {
    if (!selected) return;
    dispatchPrototype({ type: "approval.transition", approvalId: selected.id, decision, actor: selected.currentApprover, note: decision === "approved" ? "同意进入下一节点" : "请补充关键材料后重新提交" });
    setFeedback(decision === "approved" ? "审批已通过" : "申请已退回");
  }

  return (
    <HubPage>
      <HubHeader eyebrow="Unified approval inbox" title="审批中心" description="在一个收件箱处理立项、DD、IC、出差、合同、用印、采购、报销和付款。" actions={<Button>发起申请</Button>} />
      <HubTabs basePath="/approvals" tabs={tabs} active={active} />
      <MetricCards items={[{ label: "待我审批", value: state.approvals.filter((item) => item.status === "pending").length, detail: "其中 1 项为高优先级" }, { label: "即将超时", value: 1, detail: "剩余 4 小时", tone: "red" }, { label: "本周完成", value: 12, detail: "中位处理时长 5.2 小时" }, { label: "退回率", value: "8.3%", detail: "主要缺少合同版本对照", tone: "orange" }]} />
      {feedback && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-900">{feedback}</div>}
      <section className="grid gap-3">
        <SectionHeading title={tabs.find((tab) => tab.id === active)?.label ?? "审批"} description="选择申请查看摘要、关联对象和完整审批轨迹" />
        {requests.length === 0 ? <div className="rounded-xl border border-dashed bg-white p-10 text-center"><Check className="mx-auto size-7 text-emerald-700" aria-hidden="true" /><h3 className="mt-3 font-semibold">当前没有待处理申请</h3><p className="mt-1 text-sm text-muted-foreground">新的申请会自动进入此队列。</p></div> : requests.map((request) => (
          <Card key={request.id} className="py-0 shadow-none"><CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><StatusBadge value={request.status} /><StatusBadge value={request.risk} /><span className="text-xs text-muted-foreground">{typeLabels[request.requestType]}</span><SourceBadge source="demo" /></div><h3 className="mt-2 font-semibold">{request.title}</h3><p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">{request.summary}</p></div><div className="flex items-center gap-4"><div className="text-right text-sm"><strong className="block tabular-nums">{formatAmount(request.amountCny) ?? "—"}</strong><span className="text-xs text-muted-foreground">{request.applicant} · {formatTime(request.submittedAt)}</span></div><Button variant="outline" className="min-h-11" aria-label={`查看 ${request.title}`} onClick={() => { setSelectedId(request.id); setFeedback(null); }}>查看<ChevronRight aria-hidden="true" /></Button></div></CardContent></Card>
        ))}
      </section>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
        <SheetContent aria-label={selected?.title} className="w-full overflow-y-auto sm:max-w-xl">
          {selected && <><SheetHeader><div className="flex flex-wrap items-center gap-2"><StatusBadge value={selected.status} /><StatusBadge value={selected.risk} /><SourceBadge source="demo" /></div><SheetTitle>{selected.title}</SheetTitle><SheetDescription>{selected.summary}</SheetDescription></SheetHeader><div className="grid gap-6 px-4 pb-6"><dl className="grid grid-cols-2 gap-3 rounded-xl border bg-muted/30 p-4 text-sm"><div><dt className="text-muted-foreground">申请人</dt><dd className="mt-1 font-medium">{selected.applicant}</dd></div><div><dt className="text-muted-foreground">当前审批人</dt><dd className="mt-1 font-medium">{selected.currentApprover}</dd></div><div><dt className="text-muted-foreground">类型</dt><dd className="mt-1 font-medium">{typeLabels[selected.requestType]}</dd></div><div><dt className="text-muted-foreground">金额</dt><dd className="mt-1 font-medium tabular-nums">{formatAmount(selected.amountCny) ?? "—"}</dd></div></dl><section><h3 className="font-semibold">审批轨迹</h3><ol className="mt-3 grid gap-3">{selected.trail.map((step) => <li key={step.id} className="relative border-l-2 border-border pl-4 text-sm"><span className="absolute -left-[5px] top-1 size-2 rounded-full bg-primary" /><strong>{step.actor} · {step.action === "approved" ? "已批准" : step.action === "returned" ? "已退回" : step.action === "submitted" ? "已提交" : "已评论"}</strong><p className="mt-1 text-muted-foreground">{step.note}</p><time className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="size-3" aria-hidden="true" />{formatTime(step.at)}</time></li>)}</ol></section>{selected.status === "pending" && canDecide ? <div className="sticky bottom-0 flex gap-2 border-t bg-white py-4"><Button variant="outline" className="min-h-11 flex-1" onClick={() => decide("returned")}><RotateCcw aria-hidden="true" />退回补充</Button><Button className="min-h-11 flex-1" aria-label="批准申请" onClick={() => decide("approved")}><Check aria-hidden="true" />批准申请</Button></div> : selected.status === "pending" ? <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">当前演示角色可查看，但没有此类审批动作。</p> : null}</div></>}
        </SheetContent>
      </Sheet>
    </HubPage>
  );
}
