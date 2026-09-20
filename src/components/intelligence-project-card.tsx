"use client";

import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Check, ChevronDown, CircleX, Pencil } from "lucide-react";
import { Button, InlineNotification, Modal, Select, SelectItem, Tag, TextArea } from "@/components/ui/legacy";
import type { IntelligenceCandidateView } from "@/intelligence/repository";
import { buildIntelligenceInvestmentBrief, DiscoveryInvestmentBrief } from "./discovery-investment-brief";

const entityLabels = { company: "公司", person: "人才", technology: "技术" } as const;
const channelLabels: Record<string, string> = { venture_tech: "创投/科技", registry: "工商企业", hiring: "招聘增长", ranking_award: "榜单奖项", manual_codex: "Codex/人工" };
const statusLabels: Record<string, string> = { pending_review: "待审核", promoted: "已入库", dismissed: "暂不跟进", merged: "已合并" };

export function IntelligenceProjectCard({ candidate: initialCandidate, canAdmin = false, canReview = false, headingLevel = "h3", orderControls, onUpdated }: {
  candidate: IntelligenceCandidateView;
  canAdmin?: boolean;
  canReview?: boolean;
  headingLevel?: "h2" | "h3";
  orderControls?: ReactNode;
  onUpdated?: (candidate: IntelligenceCandidateView) => void;
}) {
  const [candidate, setCandidate] = useState(initialCandidate);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reviewing, setReviewing] = useState<"promote" | "reject" | "merge" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; title: string; subtitle?: string } | null>(null);
  const Heading = headingLevel;
  const isLocalPreview = candidate.id.startsWith("local-preview:");
  const publishUpdate = (updated: IntelligenceCandidateView) => { setCandidate(updated); onUpdated?.(updated); };

  async function review() {
    if (!reviewing || reason.trim().length < 2) return;
    setBusy(true); setNotice(null);
    if (isLocalPreview) {
      const status = reviewing === "reject" ? "dismissed" : reviewing === "merge" ? "merged" : "promoted";
      publishUpdate({ ...candidate, status, version: candidate.version + 1, reviewReason: reason.trim(), updatedAt: new Date().toISOString() });
      setReviewing(null); setReason(""); setBusy(false);
      setNotice({ kind: "success", title: reviewing === "reject" ? "已在本地预览中设为暂不跟进" : reviewing === "merge" ? "已在本地预览中标记为合并" : "项目已在本地预览中标记为入库" });
      return;
    }
    try {
      const response = await fetch(`/api/v1/discovery/items/${encodeURIComponent(candidate.id)}/review`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ decision: reviewing, expectedVersion: candidate.version, reason: reason.trim(), ...(reviewing === "merge" ? { matchedEntityType: candidate.matchedEntityType, matchedEntityId: candidate.matchedEntityId } : {}) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "操作失败，请稍后重试。");
      publishUpdate(payload.data);
      setReviewing(null); setReason("");
      setNotice({ kind: "success", title: reviewing === "reject" ? "已设为暂不跟进" : reviewing === "merge" ? "已合并到已有项目" : "项目已入库" });
    } catch (error) { setNotice({ kind: "error", title: "操作失败", subtitle: error instanceof Error ? error.message : "请稍后重试。" }); }
    finally { setBusy(false); }
  }

  return <article id={`intelligence-${candidate.id}`} className={`flex min-w-0 scroll-mt-24 flex-col rounded-xl border border-border bg-card p-4 transition-colors motion-reduce:transition-none hover:border-primary/35 ${expanded ? "md:col-span-2 xl:col-span-3" : ""}`}>
    {notice && <InlineNotification kind={notice.kind} title={notice.title} subtitle={notice.subtitle} onCloseButtonClick={() => setNotice(null)} />}
    <header className="flex items-start justify-between gap-3">
      <Heading className="min-w-0 text-lg font-semibold tracking-tight">{candidate.name}</Heading>
      <div className="flex shrink-0 flex-wrap justify-end gap-1.5"><Tag type={candidate.priority === "A" ? "red" : candidate.priority === "B" ? "blue" : "gray"} size="sm">{candidate.priority} 级</Tag><Tag type={candidate.status === "promoted" || candidate.status === "merged" ? "green" : candidate.status === "pending_review" ? "warm-gray" : "gray"} size="sm">{statusLabels[candidate.status] ?? candidate.status}</Tag>{isLocalPreview && <Tag type="outline" size="sm">本地预览</Tag>}</div>
    </header>
    <DiscoveryInvestmentBrief name={candidate.name} brief={buildIntelligenceInvestmentBrief(candidate)} />
    <button type="button" aria-expanded={expanded} aria-label={`查看${candidate.name}项目详情`} onClick={() => setExpanded((current) => !current)} className="mt-2 flex min-h-11 cursor-pointer items-center justify-between rounded-lg px-2 text-left text-sm font-medium text-primary transition-colors hover:bg-primary/[0.05] focus-visible:ring-2 focus-visible:ring-ring">
      {expanded ? "收起详细信息" : "展开详细信息"}<ChevronDown className={`size-4 transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
    </button>
    {expanded && <>
      <IntelligenceProjectDetails candidate={candidate} />
      {canAdmin && candidate.status === "pending_review" && <div className="mt-2 flex flex-wrap items-center justify-between gap-2">{orderControls ?? <span />}<Button kind="secondary" size="sm" className="min-h-11" renderIcon={Pencil} aria-label={`编辑${candidate.name}信息`} onClick={() => { setEditing(true); setNotice(null); }}>编辑项目信息</Button></div>}
      {candidate.status === "pending_review" && canReview && <footer className="mt-2 border-t border-border pt-3"><div className="grid grid-cols-2 gap-2">
          <Button kind="danger--tertiary" size="sm" className="min-h-11" renderIcon={CircleX} aria-label={`暂不跟进${candidate.name}`} disabled={busy} onClick={() => { setReviewing("reject"); setReason("投资经理人工排除"); }}>暂不跟进</Button>
          <Button size="sm" className="min-h-11" renderIcon={Check} aria-label={`入库${candidate.name}`} disabled={busy || candidate.completeness === "L0"} onClick={() => { setReviewing("promote"); setReason("来源与主体信息已人工确认"); }}>入库</Button>
          {candidate.matchedEntityId && <Button kind="secondary" size="sm" className="col-span-2 min-h-11" aria-label={`合并${candidate.name}到已有项目`} disabled={busy || candidate.completeness === "L0"} onClick={() => { setReviewing("merge"); setReason("确认匹配已有主体，合并新增信息"); }}>合并已有项目</Button>}
        </div></footer>}
    </>}
    {editing && <IntelligenceProjectEditor candidate={candidate} busy={busy} localOnly={isLocalPreview} onBusyChange={setBusy} onSaved={(updated) => { publishUpdate(updated); setEditing(false); setNotice({ kind: "success", title: isLocalPreview ? "本地预览内容已更新" : "项目信息已更新" }); }} onClose={() => setEditing(false)} />}
    <Modal open={Boolean(reviewing)} modalHeading={reviewing === "reject" ? `暂不跟进：${candidate.name}` : reviewing === "merge" ? `合并项目：${candidate.name}` : `审核入库：${candidate.name}`} primaryButtonText={reviewing === "reject" ? "确认暂不跟进" : reviewing === "merge" ? "确认合并" : "确认入库"} secondaryButtonText="取消" primaryButtonDisabled={busy || reason.trim().length < 2} onRequestClose={() => { if (!busy) { setReviewing(null); setReason(""); } }} onRequestSubmit={review}>
      <p className="text-sm leading-6 text-muted-foreground">请核对投资速览、来源和关键待核问题；处理后仍保留完整记录。</p>
      <TextArea id={`review-reason-${candidate.id}`} labelText="审核意见" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2_000} />
    </Modal>
  </article>;
}

function IntelligenceProjectDetails({ candidate }: { candidate: IntelligenceCandidateView }) {
  const labels: Record<string, string> = { technology: "技术", team: "团队", commercial: "商业", signal: "信号", evidence: "证据" };
  return <section aria-label={`${candidate.name}详细信息`} className="mt-2 grid gap-3 rounded-lg bg-muted/35 p-3 text-sm">
    <dl className="grid grid-cols-2 gap-2 rounded-lg border bg-background p-3 text-xs"><div><dt className="text-muted-foreground">地区</dt><dd className="mt-0.5 font-medium">{candidate.city || "待核"}</dd></div><div><dt className="text-muted-foreground">来源渠道</dt><dd className="mt-0.5 font-medium">{channelLabels[candidate.channel] ?? candidate.channel}</dd></div><div><dt className="text-muted-foreground">主体类型</dt><dd className="mt-0.5 font-medium">{entityLabels[candidate.entityType]}</dd></div><div><dt className="text-muted-foreground">完整度</dt><dd className="mt-0.5 font-medium">{candidate.completeness}{candidate.candidateKind === "entity_update" ? " · 已有实体更新" : ""}</dd></div></dl>
    <IntelligenceEntityProfile candidate={candidate} />
    <div className="grid grid-cols-5 gap-1 text-center">{Object.entries(candidate.scores).map(([key, value]) => <div key={key} className="rounded-md bg-background p-2"><div className="text-xs text-muted-foreground">{labels[key] ?? key}</div><strong>{value}/5</strong></div>)}</div>
    {candidate.investmentHighlights.length > 0 && <div><strong>投资亮点</strong><ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">{candidate.investmentHighlights.map((item) => <li key={item}>{item}</li>)}</ul></div>}
    {(candidate.evidence ?? []).length > 0 && <div><strong>信息来源</strong><ul className="mt-1 grid gap-2">{candidate.evidence?.map((source) => { const href = safeExternalUrl(source.url); return <li key={String(source.id ?? source.ref)} className="rounded-md border bg-background p-2">{href ? <a href={href} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">{String(source.title)}</a> : <span className="font-medium">{String(source.title)}</span>}{source.excerpt ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{String(source.excerpt)}{source.authority ? ` · 来源等级 ${String(source.authority)}` : ""}</p> : null}</li>; })}</ul></div>}
    {candidate.openQuestions.length > 0 && <div><strong>关键待核问题</strong><ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">{candidate.openQuestions.map((question) => <li key={question}>{question}</li>)}</ul></div>}
    {candidate.missingFields.length > 0 && <div className="flex flex-wrap gap-2">{candidate.missingFields.map((field) => <Tag key={field} type="warm-gray">待补：{field}</Tag>)}</div>}
  </section>;
}

function IntelligenceEntityProfile({ candidate }: { candidate: IntelligenceCandidateView }) {
  const profile = entityProfile(candidate);
  if (profile.facts.length === 0) return null;
  return <div className="rounded-lg border bg-background p-3"><h4 className="font-semibold">{profile.title}</h4><dl className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-2">{profile.facts.map((fact) => { const href = safeExternalUrl(fact.href); return <div key={`${fact.label}:${fact.value}`} className="min-w-0"><dt className="text-xs text-muted-foreground">{fact.label}</dt><dd className="mt-0.5 break-words leading-5">{href ? <a href={href} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">{fact.value}</a> : fact.value}</dd></div>; })}</dl></div>;
}

type ProfileFact = { label: string; value: string; href?: string };
function entityProfile(candidate: IntelligenceCandidateView): { title: string; facts: ProfileFact[] } {
  if (candidate.entityType === "person") {
    const person = record(candidate.details.person);
    return { title: "人才画像", facts: profileFacts([
      profileFact("当前机构", joinStrings([text(person.organization), text(person.title)], " · ")),
      profileFact("教育背景", strings(person.education).slice(0, 3).join("；")),
      profileFact("工作履历", strings(person.employment).slice(0, 3).join("；")),
      profileFact("技术背景", text(person.technicalBackground)),
      profileFact("论文/专利", [...strings(person.publications), ...strings(person.patents)].slice(0, 3).join("；")),
      profileFact("个人主页", text(person.homepage), text(person.homepage)),
      profileFact("公开工作联系", contactSummary(candidate.contacts)),
    ]) };
  }
  if (candidate.entityType === "technology") {
    const technology = record(candidate.details.technology);
    return { title: "技术画像", facts: profileFacts([
      profileFact("技术定义", text(technology.definition)),
      profileFact("成熟度", text(technology.maturity)),
      profileFact("关键指标", strings(technology.keyMetrics).slice(0, 4).join("；")),
      profileFact("替代路线", strings(technology.alternatives).slice(0, 3).join("；")),
      profileFact("竞品/对标", strings(technology.competitors).slice(0, 4).join("、")),
      profileFact("论文/专利", [...strings(technology.papers), ...strings(technology.patents)].slice(0, 3).join("；")),
    ]) };
  }
  const company = record(candidate.details.company);
  return { title: "公司画像", facts: profileFacts([
    profileFact("核心产品", strings(company.products).slice(0, 3).join("、")),
    profileFact("核心技术", strings(company.coreTechnologies).slice(0, 3).join("；")),
    profileFact("核心团队", teamSummary(candidate.relationships)),
    profileFact("融资与投资机构", fundingSummary(company.fundingHistory)),
    profileFact("竞品公司", strings(company.competitors).slice(0, 4).join("、")),
    profileFact("工商主体", joinStrings([text(company.legalName), text(company.unifiedCreditCode)], " · ")),
    profileFact("官网", text(company.officialWebsite), text(company.officialWebsite)),
    profileFact("公开工作联系", contactSummary(candidate.contacts)),
  ]) };
}

function fundingSummary(value: unknown): string {
  const latest = Array.isArray(value) ? record(value.toSorted((left, right) => text(record(right).announcedAt).localeCompare(text(record(left).announcedAt))).at(0)) : {};
  const roundLabels: Record<string, string> = { angel: "天使轮", pre_a: "Pre-A轮", a: "A轮", b: "B轮", c: "C轮", d_plus: "D轮及以后", strategic: "战略融资", other: "其他轮次" };
  const currency = text(latest.currency), amount = typeof latest.amount === "number" ? money(latest.amount, currency) : "", valuation = typeof latest.valuation === "number" ? `估值 ${money(latest.valuation, currency)}` : "";
  return joinStrings([roundLabels[text(latest.round)] ?? text(latest.round), amount, valuation, strings(latest.investors).slice(0, 4).join("、")], " · ");
}
function money(value: number, currency: string): string {
  const unit = currency === "USD" ? "美元" : currency === "CNY" ? "元人民币" : currency;
  if (value >= 100_000_000) return `${Number((value / 100_000_000).toFixed(2))}亿${unit}`;
  if (value >= 10_000) return `${Number((value / 10_000).toFixed(2))}万${unit}`;
  return `${value.toLocaleString("zh-CN")}${unit}`;
}
function teamSummary(value: IntelligenceCandidateView["relationships"]): string {
  return (value ?? []).flatMap((item) => { const row = record(item); return row.entityType === "person" && text(row.name) ? [joinStrings([text(row.name), text(row.relation)], " · ")] : []; }).slice(0, 4).join("、");
}
function contactSummary(value: IntelligenceCandidateView["contacts"]): string {
  return (value ?? []).flatMap((item) => { const row = record(item); return text(row.value) ? [text(row.value)] : []; }).slice(0, 3).join("、");
}
function profileFact(label: string, value: string, href?: string): ProfileFact | null { return value ? { label, value, ...(href ? { href } : {}) } : null; }
function profileFacts(value: Array<ProfileFact | null>): ProfileFact[] { return value.filter((item): item is ProfileFact => Boolean(item)); }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : []; }
function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function joinStrings(value: string[], separator: string): string { return value.filter(Boolean).join(separator); }
function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return url.protocol === "https:" ? url.toString() : null; }
  catch { return null; }
}

function IntelligenceProjectEditor({ candidate, busy, localOnly, onBusyChange, onSaved, onClose }: { candidate: IntelligenceCandidateView; busy: boolean; localOnly: boolean; onBusyChange: (value: boolean) => void; onSaved: (candidate: IntelligenceCandidateView) => void; onClose: () => void }) {
  const [summary, setSummary] = useState(candidate.investmentSummary);
  const [highlights, setHighlights] = useState(candidate.investmentHighlights.join("\n"));
  const [questions, setQuestions] = useState(candidate.openQuestions.join("\n"));
  const [priority, setPriority] = useState(candidate.priority);
  const [error, setError] = useState("");
  const retry = useRef<{ body: string; key: string } | null>(null);
  async function save() {
    const body = JSON.stringify({ expectedVersion: candidate.version, investmentSummary: summary.trim(), investmentHighlights: lines(highlights), openQuestions: lines(questions), priority });
    if (localOnly) {
      onSaved({ ...candidate, investmentSummary: summary.trim(), investmentHighlights: lines(highlights), openQuestions: lines(questions), priority, version: candidate.version + 1, updatedAt: new Date().toISOString() });
      return;
    }
    if (retry.current?.body !== body) retry.current = { body, key: crypto.randomUUID() };
    onBusyChange(true); setError("");
    try {
      const response = await fetch(`/api/v1/discovery/items/${encodeURIComponent(candidate.id)}`, { method: "PATCH", headers: { "content-type": "application/json", "idempotency-key": retry.current.key }, body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "保存失败，请稍后重试。");
      onSaved(payload.data);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "保存失败，请检查网络。"); }
    finally { onBusyChange(false); }
  }
  return <Modal open modalHeading={`编辑项目 · ${candidate.name}`} primaryButtonText={busy ? "保存中…" : "保存项目内容"} secondaryButtonText="取消" primaryButtonDisabled={busy || summary.trim().length === 0} onRequestClose={() => { if (!busy) onClose(); }} onRequestSubmit={save}>
    <TextArea id={`summary-${candidate.id}`} labelText="投资摘要" value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={1_000} />
    <TextArea id={`highlights-${candidate.id}`} labelText="投资亮点（每行一项）" value={highlights} onChange={(event) => setHighlights(event.target.value)} maxLength={10_000} />
    <TextArea id={`questions-${candidate.id}`} labelText="关键待核问题（每行一项）" value={questions} onChange={(event) => setQuestions(event.target.value)} maxLength={25_000} />
    <Select id={`priority-${candidate.id}`} labelText="优先级" value={priority} onChange={(event) => setPriority(event.target.value as IntelligenceCandidateView["priority"])}><SelectItem value="A" text="A 级" /><SelectItem value="B" text="B 级" /><SelectItem value="C" text="C 级" /></Select>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </Modal>;
}

function lines(value: string): string[] { return value.split(/\n/u).map((item) => item.trim()).filter(Boolean); }
