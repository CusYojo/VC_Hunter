"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { Accordion, AccordionItem, Button, InlineNotification, Tab, TabList, TabPanel, TabPanels, Tabs, Tag } from "@/components/ui/legacy";
import { ArrowLeft, ClipboardCheck, ExternalLink as Launch, X as Close } from "lucide-react";
import type { AssertionView, EvidenceView, ProjectDetail } from "@/repositories/projects";
import { ProjectActions } from "@/components/project-actions";
import { ProjectTimeline } from "@/components/project-timeline";
import type { MilestoneView } from "@/components/project-timeline";
import type { AnalysisProfile, TeamMember, TimelineEntry } from "@/workbench/contracts";

import { ProjectKnowledgeWorkspace } from "@/components/project-knowledge-workspace";
import { ProjectDocuments } from "@/components/project-documents";
import type { ProjectDocumentView } from "@/workbench/project-document-contracts";
interface KnowledgeEntryView { id: string; title: string; content: string; type: string; status: string; sourceType: string; createdAt: string; }
interface StageDef { id: string; label: string; suggestedMilestones: string[] }

export function Project360({ project, activeView = "overview", timeline = [], documents = [], knowledge = [], team, profiles, milestones = [], stages = [], recentScopeKey }: { project: ProjectDetail; activeView?: string; timeline?: TimelineEntry[]; documents?: ProjectDocumentView[]; knowledge?: KnowledgeEntryView[]; team?: TeamMember[]; profiles?: AnalysisProfile[]; milestones?: MilestoneView[]; stages?: StageDef[]; recentScopeKey?: string }) {
  const [selectedEvidence, setSelectedEvidence] = useState<{ assertion: AssertionView; evidence: EvidenceView } | null>(null);
  const hasConflict = project.assertions.some((assertion) => assertion.status === "disputed");
  return (
    <>
      <header className="rounded-xl border border-border bg-card p-5 sm:p-6">
        <Link className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-medium text-primary hover:bg-primary/[0.05]" href="/projects?view=manage"><ArrowLeft className="size-4" aria-hidden="true" />返回项目管理</Link>
        <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div><div className="flex flex-wrap items-center gap-2"><h1 className="font-editorial text-3xl font-normal tracking-[-0.03em] sm:text-4xl">{project.name}</h1><Tag type="blue">{project.track}</Tag>{project.subtrack && <Tag type="gray">{project.subtrack}</Tag>}</div><p className="mt-2 text-sm text-muted-foreground">{project.legalName}</p><p className="mt-2 text-sm text-muted-foreground">负责人：{(project.owners ?? (project.owner ? [project.owner] : [])).join("、") || "待分配"}</p><p className="mt-4 max-w-3xl text-sm leading-6">{project.executiveSummary}</p></div>
          <ProjectActions key={`${project.id}:${project.version}`} projectId={project.id} version={project.version} owner={project.owner} owners={project.owners} status={project.status} dealStage={project.dealStage} team={team} profiles={profiles} recentScopeKey={recentScopeKey} />
        </div>
      </header>

      <section className="my-5 grid overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-[minmax(0,1.5fr)_repeat(2,minmax(8rem,0.5fr))]" aria-labelledby="why-now-heading">
        <div className="p-5 sm:p-6"><p className="text-xs font-semibold text-primary">本期关注</p><h2 id="why-now-heading" className="mt-2 text-lg font-semibold leading-7">{project.whyNow}</h2></div>
        <div className="border-t border-border p-5 lg:border-l lg:border-t-0"><strong className="font-mono text-3xl font-medium tabular-nums">{project.urgencyScore ?? "—"}</strong><span className="mt-2 block text-sm font-medium">{project.urgencyScore === undefined ? "紧迫度待评估" : "紧迫度"}</span><small className="mt-1 block text-xs text-muted-foreground">新事件与时间敏感性</small></div>
        <div className="border-t border-border p-5 lg:border-l lg:border-t-0"><strong className="font-mono text-3xl font-medium tabular-nums">{project.qualityScore ?? "—"}</strong><span className="mt-2 block text-sm font-medium">{project.qualityScore === undefined ? "质量待评估" : "项目质量"}</span><small className="mt-1 block text-xs text-muted-foreground">技术、市场、团队与证据</small></div>
      </section>

      {activeView !== "overview" && <section className="mb-5 rounded-xl border border-border bg-muted/35 px-5 py-4"><p className="text-xs font-semibold text-primary">当前工作上下文</p><h2 className="mt-1 text-lg font-semibold">{legacyViewTitle(activeView)}</h2><p className="mt-1 text-sm text-muted-foreground">原入口已归并到下方项目工作区，资料、流程与判断仍保留在同一项目中。</p></section>}

      {hasConflict && <InlineNotification kind="warning" lowContrast title="存在待复核冲突" subtitle="融资金额有两条不同断言，系统保留双方证据且未自动覆盖。" hideCloseButton />}

      <section aria-labelledby="evidence-workspace-title" className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="mb-4"><h2 id="evidence-workspace-title" className="text-xl font-semibold">项目工作区</h2><p className="mt-1 text-sm text-muted-foreground">流程、资料和知识都与当前项目绑定。</p></div>
      <Tabs key={`${project.id}:${activeView}`} defaultIndex={activeView === "knowledge" ? 3 : activeView === "documents" ? 2 : activeView === "timeline" ? 1 : 0}>
        <TabList aria-label="项目详情页签" contained fullWidth>
          <Tab>项目总览</Tab><Tab>项目流程</Tab><Tab>资料与审批</Tab><Tab>项目知识库</Tab>
        </TabList>
        <TabPanels>
          <TabPanel>
            <div className="project-overview-grid">
              <section className="overview-primary"><h2>投资快照</h2><p className="lead-copy">{project.executiveSummary}</p><h3>核心事实</h3><AssertionList assertions={project.assertions.filter((item) => item.predicate !== "revenue")} onEvidence={setSelectedEvidence} /><h3>最近动态</h3>{timeline.length > 0 ? <ol className="evidence-timeline unified">{timeline.slice(0, 5).map((entry) => <li key={`${entry.kind}:${entry.id}`} className={`timeline-${entry.kind}`}><time>{formatDate(entry.occurredAt)}</time><div><Tag type={timelineTag(entry.kind)} size="sm">{timelineLabel(entry.kind)}</Tag><h3>{entry.title}</h3><p>{entry.summary}</p>{entry.actor && <small>记录者：{entry.actor}</small>}</div></li>)}</ol> : <p className="text-sm text-muted-foreground">暂无项目动态。</p>}</section>
              <aside className="overview-aside"><h3>技术阶段</h3><strong className="stage-value">{formatStage(project.technologyStage)}</strong><p>阶段结论以项目资料与已核验的证据为准。</p><h3>风险标记</h3><div className="tag-stack">{project.riskFlags?.map((risk) => <Tag key={risk} type="red">{risk}</Tag>)}</div><h3>开放问题</h3><ol>{project.openQuestions.map((question) => <li key={question}>{question}</li>)}</ol></aside>
            </div>
            {project.companyIntelligence && <CompanyIntelligence intelligence={project.companyIntelligence} />}
          </TabPanel>
          <TabPanel>
            <div className="py-5"><ProjectTimeline key={`${project.id}:${project.version}:${project.dealStage}`} projectId={project.id} projectVersion={project.version} projectStatus={project.status} projectStage={project.dealStage} stages={stages} team={(team ?? []).map((member) => ({ id: member.id, name: member.name, departmentId: member.departmentId, departmentName: member.departmentName }))} initialMilestones={milestones} recentScopeKey={recentScopeKey} /></div>
          </TabPanel>
          <TabPanel><section className="document-workspace"><ProjectDocuments projectId={project.id} documents={documents} /><MilestoneApprovalSummary milestones={milestones} /><h2>字段级证据与复核</h2><AssertionList assertions={project.assertions} onEvidence={setSelectedEvidence} expanded /></section></TabPanel>
          <TabPanel><ProjectKnowledgeWorkspace projectId={project.id} projectName={project.name} version={project.version} documents={documents} knowledge={knowledge}/></TabPanel>
        </TabPanels>
      </Tabs>
      </section>

      {selectedEvidence && <EvidencePanel selection={selectedEvidence} onClose={() => setSelectedEvidence(null)} />}
    </>
  );
}

function CompanyIntelligence({ intelligence }: { intelligence: NonNullable<ProjectDetail["companyIntelligence"]> }) {
  return <section className="mt-6 border-t pt-6" aria-labelledby="company-intelligence-title"><h2 id="company-intelligence-title" className="text-lg font-semibold">公司情报补充</h2><p className="mt-1 text-sm text-muted-foreground">仅展示已审核入库或明确标记待补充的公司、团队和交易信息。</p><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
    <IntelligenceBlock title="产品与核心技术"><FactList values={intelligence.products} empty="主要产品待补充" /><FactList values={intelligence.coreTechnologies} empty="核心技术待补充" /></IntelligenceBlock>
    <IntelligenceBlock title="核心团队">{intelligence.team.length ? intelligence.team.map((person) => <div key={`${person.id}:${person.role}`} className="border-b py-2 last:border-0"><strong>{person.name} · {person.role}</strong><p className="mt-1 text-xs text-muted-foreground">{[person.organization, person.title, ...person.education].filter(Boolean).join(" · ") || "履历待补充"}</p>{person.technicalBackground && <p className="mt-1 text-xs">{person.technicalBackground}</p>}</div>) : <EmptyFact>核心团队待补充</EmptyFact>}</IntelligenceBlock>
    <IntelligenceBlock title="融资与并购"><h4 className="text-xs font-semibold text-muted-foreground">融资</h4>{intelligence.financing.length ? intelligence.financing.map((event) => <div key={event.id} className="border-b py-2 text-sm last:border-0"><strong>{event.round} · {event.announcedAt.slice(0, 10)}</strong><p className="mt-1 text-xs text-muted-foreground">{event.amount === null ? "金额未披露" : `${event.currency ?? ""} ${new Intl.NumberFormat("zh-CN").format(event.amount)}`} · {event.investors.join("、") || "投资方待补充"}</p>{event.valuation !== null && <p className="mt-1 text-xs text-muted-foreground">披露/估算估值：{event.currency ?? ""} {new Intl.NumberFormat("zh-CN").format(event.valuation)}</p>}</div>) : <EmptyFact>融资历史待补充</EmptyFact>}<h4 className="mt-3 text-xs font-semibold text-muted-foreground">并购 / 战略交易</h4>{intelligence.mergersAndAcquisitions.length ? intelligence.mergersAndAcquisitions.map((event) => <div key={event.id} className="border-b py-2 text-sm last:border-0"><strong>{event.acquirerName} · {event.announcementDate.slice(0, 10)}</strong><p className="mt-1 text-xs text-muted-foreground">{transactionTypeLabel(event.transactionType)} · {transactionStageLabel(event.transactionStage)} · {event.transactionValue === null ? "金额未披露" : `${event.currency ?? ""} ${new Intl.NumberFormat("zh-CN").format(event.transactionValue)}`}</p>{event.strategicRationale && <p className="mt-1 text-xs">{event.strategicRationale}</p>}</div>) : <EmptyFact>并购与战略交易待补充</EmptyFact>}</IntelligenceBlock>
    <IntelligenceBlock title="竞品与替代路线"><FactList values={intelligence.competitors} empty="竞品待补充" /></IntelligenceBlock>
    <IntelligenceBlock title="工商与研发地"><p className="text-sm">统一社会信用代码：{intelligence.unifiedCreditCode ?? "待补充"}</p><p className="mt-2 text-sm">官网：{intelligence.officialWebsite ? <a href={intelligence.officialWebsite} target="_blank" rel="noreferrer" className="break-all text-primary hover:underline">{intelligence.officialWebsite}</a> : "待补充"}</p><p className="mt-2 text-sm">注册地址：{intelligence.registeredAddress ?? "待补充"}</p><p className="mt-2 text-sm">研发地：{intelligence.researchLocations.join("、") || "待补充"}</p>{intelligence.businessScope && <p className="mt-2 text-xs leading-5 text-muted-foreground">经营范围：{intelligence.businessScope}</p>}</IntelligenceBlock>
    <IntelligenceBlock title="公开工作联系方式">{intelligence.contacts.length ? intelligence.contacts.map((contact) => <p key={`${contact.type}:${contact.value}`} className="py-1 text-sm"><a href={contact.sourceUrl} target="_blank" rel="noreferrer" className="break-all text-primary hover:underline">{contact.value}</a><span className="ml-2 text-xs text-muted-foreground">核验于 {contact.verifiedAt.slice(0, 10)}</span></p>) : <EmptyFact>公开工作联系方式待补充</EmptyFact>}</IntelligenceBlock>
  </div></section>;
}
function IntelligenceBlock({ title, children }: { title: string; children: ReactNode }) { return <section className="rounded-lg border bg-muted/20 p-4"><h3 className="font-semibold">{title}</h3><div className="mt-2">{children}</div></section>; }
function FactList({ values, empty }: { values: string[]; empty: string }) { return values.length ? <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{values.map((value) => <li key={value}>{value}</li>)}</ul> : <EmptyFact>{empty}</EmptyFact>; }
function EmptyFact({ children }: { children: ReactNode }) { return <p className="text-sm text-muted-foreground">{children}</p>; }
function transactionTypeLabel(value: string): string { return ({ acquisition: "收购", merger: "合并", asset_purchase: "资产收购", strategic_investment: "战略投资" } as Record<string, string>)[value] ?? value; }
function transactionStageLabel(value: string): string { return ({ proposed: "拟议", approved: "已批准", closed: "已完成", terminated: "已终止" } as Record<string, string>)[value] ?? value; }

function AssertionList({ assertions, onEvidence, expanded = false }: { assertions: AssertionView[]; onEvidence: (selection: { assertion: AssertionView; evidence: EvidenceView }) => void; expanded?: boolean }) {
  return <div className="assertion-list">{assertions.map((assertion) => <article data-testid={`assertion-${assertion.predicate}`} className={`assertion-row ${assertion.status === "disputed" ? "is-disputed" : ""}`} key={assertion.id}><div><div className="assertion-label"><strong>{assertion.label}</strong><Tag type={assertion.valueStatus === "not_disclosed" ? "gray" : assertion.epistemicType === "estimate" ? "purple" : "green"} size="sm">{epistemicLabel(assertion)}</Tag>{assertion.status === "disputed" && <Tag type="red" size="sm">待核验冲突</Tag>}</div><p className="assertion-value">{formatAssertionValue(assertion)}</p>{expanded && <small>抽取：{assertion.extractionMethod} / {assertion.modelVersion} / 置信度 {Math.round(assertion.confidence * 100)}%</small>}</div><div>{assertion.evidence.map((evidence) => <Button key={evidence.id} kind="ghost" size="sm" onClick={() => onEvidence({ assertion, evidence })}>证据 {evidence.authority}</Button>)}</div></article>)}</div>;
}

function MilestoneApprovalSummary({ milestones }: { milestones: MilestoneView[] }) {
  const approvalItems = milestones.filter((milestone) => ["initiation", "pre_ic", "ic", "closing"].includes(milestone.stage) || /立项|审批|投决|签约|交割|TS/i.test(milestone.title));
  return <section className="my-6" aria-labelledby="milestone-approval-title"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2"><ClipboardCheck className="size-5 text-primary" aria-hidden="true" /><h2 id="milestone-approval-title">关键流程状态</h2></div><Link href="/approvals" className="text-sm font-semibold text-primary hover:underline">查看正式审批</Link></div><p className="mt-1 text-sm text-muted-foreground">这里展示立项、投决与交割里程碑，不等同于审批结果；正式审批以审批中心记录为准。</p>{approvalItems.length === 0 ? <div className="empty-state mt-3"><strong>暂无关键流程节点</strong><p>在立项、内决会、投决会或签约阶段添加节点后会显示在这里。</p></div> : <div className="mt-3 grid gap-2">{approvalItems.map((milestone) => <article key={milestone.id} className="flex min-h-16 flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><strong className="text-sm">{milestone.stageLabel} · {milestone.title}</strong><p className="mt-1 text-xs text-muted-foreground">{milestone.ownerName ?? "待分配"} · 更新于 {formatDate(milestone.updatedAt)}</p></div><Tag type={milestone.status === "done" ? "green" : milestone.status === "blocked" ? "red" : milestone.status === "in_progress" ? "blue" : "gray"}>{milestoneStatusLabel(milestone.status)}</Tag></article>)}</div>}</section>;
}

function EvidencePanel({ selection, onClose }: { selection: { assertion: AssertionView; evidence: EvidenceView }; onClose: () => void }) {
  const { assertion, evidence } = selection;
  return <div className="evidence-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="evidence-panel" role="dialog" aria-modal="true" aria-labelledby="evidence-title"><header><div><p className="section-kicker">字段级证据</p><h2 id="evidence-title">{assertion.label}</h2></div><Button hasIconOnly iconDescription="关闭证据面板" kind="ghost" renderIcon={Close} onClick={onClose} /></header><div className="evidence-facts"><div><span>事实状态</span><strong>{epistemicLabel(assertion)}</strong></div><div><span>来源等级</span><strong>{evidence.authority} 级</strong></div><div><span>置信度</span><strong>{Math.round(assertion.confidence * 100)}%</strong></div></div><blockquote>{evidence.quote}</blockquote><dl><div><dt>来源</dt><dd>{evidence.sourceName}</dd></div><div><dt>发布时间</dt><dd>{formatDate(evidence.publishedAt)}</dd></div><div><dt>系统观察时间</dt><dd>{formatDate(evidence.observedAt)}</dd></div><div><dt>内容哈希</dt><dd><code>{evidence.contentHash.slice(0, 16)}...</code></dd></div></dl><Accordion><AccordionItem title="处理记录"><p>抽取方式：{assertion.extractionMethod}</p><p>模型版本：{assertion.modelVersion}</p><p>独立来源组：{evidence.independentGroup}</p></AccordionItem></Accordion><Button as="a" href={evidence.url} target="_blank" rel="noreferrer" renderIcon={Launch}>查看原文</Button></aside></div>;
}

const epistemicLabel = (assertion: AssertionView) => assertion.valueStatus === "not_disclosed" ? "未披露" : assertion.valueStatus === "unknown" ? "未知" : assertion.epistemicType === "estimate" ? "估算" : "已披露事实";
function formatAssertionValue(assertion: AssertionView): string { if (assertion.value === null) return assertion.nullReason ?? "无可用值"; if (typeof assertion.value === "number") return new Intl.NumberFormat("zh-CN", { style: assertion.unit === "CNY" ? "currency" : "decimal", currency: assertion.unit === "CNY" ? "CNY" : undefined, maximumFractionDigits: 0 }).format(assertion.value); return String(assertion.value); }
const formatDate = (value: string) => new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeZone: "Asia/Shanghai" }).format(new Date(value));
const formatStage = (value: string) => value.replaceAll("_", " ");
const timelineLabel = (kind: TimelineEntry["kind"]) => ({ fact: "事实", document: "资料", judgment: "人工判断", research: "研究", agent: "Agent", audit: "审计" }[kind]);
const timelineTag = (kind: TimelineEntry["kind"]): "blue" | "teal" | "purple" | "green" | "gray" => ({ fact: "teal", document: "blue", judgment: "green", research: "purple", agent: "purple", audit: "gray" }[kind] as "blue" | "teal" | "purple" | "green" | "gray");
const legacyViewTitle = (value: string) => ({ research: "项目研究", dd: "尽职调查清单", overview: "项目工作区", profile: "项目档案", decision: "投决材料" }[value] ?? "项目工作区");
const milestoneStatusLabel = (value: MilestoneView["status"]) => ({ planned: "计划中", in_progress: "进行中", done: "已完成", blocked: "受阻", cancelled: "已取消" }[value]);
