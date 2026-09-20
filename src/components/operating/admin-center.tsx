"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { GitBranch, History, PlayCircle, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HubHeader, HubPage, HubTabs, MetricCards, SectionHeading, SourceBadge, StatusBadge } from "@/components/operating/hub-layout";
import { dispatchPrototype, usePrototypeState } from "@/prototype/store";
import { isDemoActionVisible } from "@/prototype/navigation";

const tabs = [{ id: "users", label: "用户" }, { id: "roles", label: "角色" }, { id: "workflows", label: "Workflow" }, { id: "sources", label: "Source Ops" }, { id: "audit", label: "Audit Log" }] as const;

export function AdminCenter({ initialView, sourceWorkspace }: { initialView: string; sourceWorkspace?: ReactNode }) {
  const state = usePrototypeState();
  const active = tabs.some((tab) => tab.id === initialView) ? initialView : "users";
  const [feedback, setFeedback] = useState<string | null>(null);

  function toggle(id: string, enabled: boolean) {
    dispatchPrototype({ type: "workflow.toggle", workflowId: id });
    setFeedback(enabled ? "工作流已停用" : "工作流已启用");
  }

  return (
    <HubPage>
      <HubHeader eyebrow="Governance & control" title="系统管理" description="管理人员、角色、条件审批流程、信源运行状态和不可变审计记录。" />
      <HubTabs basePath="/admin" tabs={tabs} active={active} />
      <MetricCards items={[{ label: "活跃用户", value: 26, detail: "过去 30 天登录" }, { label: "启用流程", value: state.workflows.filter((workflow) => workflow.enabled).length, detail: "条件审批工作流" }, { label: "健康信源", value: "18/20", detail: "2 个需要处理", tone: "orange" }, { label: "高风险事件", value: 0, detail: "过去 7 天", tone: "red" }]} />
      {feedback && <div role="status" className="rounded-lg border border-primary/20 bg-primary/[0.065] p-3 text-sm font-medium text-primary">{feedback}</div>}

      {active === "workflows" && <section className="grid gap-4"><SectionHeading title="条件审批流程" description="步骤列表 + 条件配置 + 只读分支预览" />{state.workflows.map((workflow) => <Card key={workflow.id} className="shadow-none"><CardHeader className="flex-row items-start justify-between"><div><div className="flex items-center gap-2"><CardTitle>{workflow.name}</CardTitle><StatusBadge value={workflow.enabled ? "active" : "draft"} /><SourceBadge source="demo" /></div><p className="mt-2 text-sm text-muted-foreground">触发：{workflow.trigger}</p></div>{isDemoActionVisible(state.persona, "manage_workflow") ? <Button variant="outline" aria-label={`${workflow.enabled ? "停用" : "启用"} ${workflow.name}`} onClick={() => toggle(workflow.id, workflow.enabled)}>{workflow.enabled ? "停用" : "启用"}</Button> : <span className="text-xs text-muted-foreground">只读</span>}</CardHeader><CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]"><ol className="grid gap-2">{workflow.steps.map((step, index) => <li key={step.id} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 rounded-lg border p-3"><span className="grid size-8 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{index + 1}</span><div><strong className="text-sm">{step.label}</strong><p className="mt-1 text-sm text-muted-foreground">审批人：{step.approver}</p><p className="mt-1 text-xs text-muted-foreground">条件：{step.condition}</p></div></li>)}</ol><div className="rounded-lg border border-dashed bg-muted/30 p-4"><div className="flex items-center gap-2"><GitBranch className="size-4 text-primary" aria-hidden="true" /><strong className="text-sm">分支预览</strong></div><p className="mt-3 text-sm leading-6 text-muted-foreground">满足金额或高风险条件时进入额外审批节点；否则沿默认路径继续。此预览只读，不需要画布编辑器。</p></div></CardContent></Card>)}</section>}

      {active === "users" && <section className="grid gap-3"><SectionHeading title="用户与团队" description="演示角色不会覆盖此处的真实权限" /><Card className="shadow-none"><CardContent className="grid gap-3 p-4 sm:grid-cols-3">{["示例经理 · 投资经理", "顾明远 · Partner", "林法务 · 法务合规"].map((user) => <div key={user} className="flex min-h-14 items-center gap-3 rounded-lg bg-muted/50 p-3"><Users className="size-5 text-primary" aria-hidden="true" /><strong className="text-sm">{user}</strong></div>)}</CardContent></Card></section>}
      {active === "roles" && <section className="grid gap-3"><SectionHeading title="角色权限" description="服务端权限仍由现有 RBAC 与租户边界控制" /><Card className="shadow-none"><CardContent className="grid gap-3 p-4 sm:grid-cols-2">{["组织管理员", "投资经理", "研究员", "合规复核", "只读访客"].map((role) => <div key={role} className="flex items-center gap-3 rounded-lg border p-4"><ShieldCheck className="size-5 text-primary" aria-hidden="true" /><div><strong className="text-sm">{role}</strong><p className="text-xs text-muted-foreground">按资源和动作授权</p></div></div>)}</CardContent></Card></section>}
      {active === "sources" && <section className="grid gap-3"><SectionHeading title="Source Ops" description="信源、连接器、采集记录、失败原因和重试操作" /><Card className="shadow-none"><CardContent className="flex items-center gap-3 p-5"><PlayCircle className="size-5 text-emerald-700" aria-hidden="true" /><div><strong>信源运行控制台</strong><p className="text-sm text-muted-foreground">真实状态与采集结果在下方统一呈现。</p></div></CardContent></Card>{sourceWorkspace}</section>}
      {active === "audit" && <section className="grid gap-3"><SectionHeading title="审计日志" description="关键操作包含操作者、对象、时间与差异摘要" />{["顾明远批准 IC-2026-091", "林法务退回合同用印申请", "系统执行项目阶段规则"].map((event, index) => <Card key={event} className="py-0 shadow-none"><CardContent className="flex items-center gap-3 p-4"><History className="size-4 text-muted-foreground" aria-hidden="true" /><div><strong className="text-sm">{event}</strong><p className="text-xs text-muted-foreground">2026-09-0{3 - index} · 已记录差异快照</p></div><SourceBadge source={index === 2 ? "real" : "demo"} /></CardContent></Card>)}</section>}
    </HubPage>
  );
}
