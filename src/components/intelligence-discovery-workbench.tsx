"use client";

import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Check, ChevronDown, FileJson, Search, Settings2, ShieldCheck, X } from "lucide-react";
import { Button, InlineNotification, Modal, Select, SelectItem, Tag, TextArea, TextInput } from "@/components/ui/legacy";
import type { IntelligenceCandidateView } from "@/intelligence/repository";
import { buildIntelligenceInvestmentBrief, DiscoveryInvestmentBrief } from "./discovery-investment-brief";

export type IntelligencePlanView = Record<string, unknown> & { id: string; name: string; channel: string; queryFamily: string; tracks: string[]; subtracks: string[]; cities: string[]; preferredDomains: string[]; dateWindowDays: number; connectorType: string; connectorReady?: boolean; enabled: boolean; schedule: { time: string; frequency: string; weekdaysOnly?: boolean; weekday?: number }; version: number };
type PlanView = IntelligencePlanView;
type Notice = { kind: "success" | "error" | "info"; title: string; subtitle?: string };
type PlanDraft = { queryFamily: string; tracks: string; subtracks: string; cities: string; preferredDomains: string; dateWindowDays: string; frequency: string; time: string; weekdaysOnly: boolean; weekday: string };
type ImportPreviewView = {
  importId: string; version: number; total: number; valid: number;
  duplicates: Array<{ index: number; candidateId: string }>;
  errors: Array<{ index: number; message: string }>;
  items: Array<{ index: number; name: string; completeness: string; priority: string; matches: Array<{ name: string; confidence: number; reason: string }> }>;
};

const entityLabels = { company: "公司", person: "人才", technology: "技术" } as const;
const channelLabels: Record<string, string> = { venture_tech: "创投/科技", registry: "工商企业", hiring: "招聘增长", ranking_award: "榜单奖项", manual_codex: "Codex/人工" };
const statusLabels: Record<string, string> = { pending_review: "待审核", promoted: "已入正式库", dismissed: "已拒绝", merged: "已合并" };
const frequencyLabels: Record<string, string> = { daily: "每日", every_two_days: "每两日", weekly: "每周" };

export function IntelligenceDiscoveryWorkbench({ initialCandidates, initialTotal, initialPlans, canAdmin = false, canReview = false, display = "full" }: { initialCandidates: IntelligenceCandidateView[]; initialTotal: number; initialPlans: PlanView[]; canAdmin?: boolean; canReview?: boolean; display?: "full" | "tools" }) {
  const toolsOnly = display === "tools";
  const [candidates, setCandidates] = useState(() => prepareCandidates(initialCandidates));
  const [sourceOffset, setSourceOffset] = useState(initialCandidates.length);
  const [sourceTotal, setSourceTotal] = useState(initialTotal);
  const [plans, setPlans] = useState(initialPlans);
  const [filters, setFilters] = useState({ query: "", entityType: "all", channel: "all", city: "all", track: "all", priority: "all", completeness: "all", status: "pending_review", dateFrom: "", dateTo: "" });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<{ candidate: IntelligenceCandidateView; decision: "promote" | "reject" | "merge" } | null>(null);
  const [reviewReason, setReviewReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [preview, setPreview] = useState<ImportPreviewView | null>(null);
  const [editingPlan, setEditingPlan] = useState<{ plan: PlanView; draft: PlanDraft } | null>(null);

  const options = useMemo(() => ({
    cities: unique(candidates.map((item) => item.city).filter((value): value is string => Boolean(value))),
    tracks: unique(candidates.map((item) => item.track)),
  }), [candidates]);
  const visible = useMemo(() => candidates.filter((item) => {
    const query = filters.query.trim().toLocaleLowerCase("zh-CN");
    return (!query || [item.name, item.discoveryReason, item.investmentSummary, item.subtrack ?? ""].some((value) => value.toLocaleLowerCase("zh-CN").includes(query)))
      && (filters.entityType === "all" || item.entityType === filters.entityType)
      && (filters.channel === "all" || item.channel === filters.channel)
      && (filters.city === "all" || item.city === filters.city)
      && (filters.track === "all" || item.track === filters.track)
      && (filters.priority === "all" || item.priority === filters.priority)
      && (filters.completeness === "all" || item.completeness === filters.completeness)
      && (filters.status === "all" || item.status === filters.status)
      && (!filters.dateFrom || item.eventDate >= filters.dateFrom)
      && (!filters.dateTo || item.eventDate <= filters.dateTo);
  }), [candidates, filters]);

  function changeFilter(key: keyof typeof filters, value: string) { setFilters((current) => ({ ...current, [key]: value })); }

  async function loadMore() {
    setBusy("load-more"); setNotice(null);
    try {
      const response = await fetch(`/api/v1/discovery/items?limit=200&offset=${sourceOffset}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "更多候选加载失败。");
      const page = payload.data.items as IntelligenceCandidateView[];
      setCandidates((current) => mergeCandidatePages(current, prepareCandidates(page)));
      setSourceOffset((current) => current + page.length);
      setSourceTotal(payload.data.total);
    } catch (error) { setNotice({ kind: "error", title: "更多候选加载失败", subtitle: error instanceof Error ? error.message : "请稍后重试。" }); }
    finally { setBusy(null); }
  }

  async function uploadBundle(file: File | undefined) {
    if (!file) return;
    setBusy("preview"); setPreview(null); setNotice(null);
    try {
      if (file.size > 16 * 1024 * 1024) throw new Error("数据包不能超过 16 MB。");
      const body = await readFileText(file);
      const response = await fetch("/api/v1/discovery/imports/preview", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "数据包预检失败。");
      setPreview(payload.data);
      setNotice({ kind: "info", title: `预检完成：${payload.data.valid} 条可导入`, subtitle: `${payload.data.duplicates.length} 条重复，${payload.data.errors.length} 条错误。确认后仅写入待审队列。` });
    } catch (error) { setNotice({ kind: "error", title: "数据包预检失败", subtitle: error instanceof Error ? error.message : "请检查 JSON 文件。" }); }
    finally { setBusy(null); }
  }

  async function commitBundle() {
    if (!preview) return;
    setBusy("commit"); setNotice(null);
    try {
      const response = await fetch(`/api/v1/discovery/imports/${preview.importId}/commit`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ expectedVersion: preview.version }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "确认导入失败。");
      setPreview(null);
      setNotice({ kind: "success", title: `${payload.data.inserted} 条已进入待审队列`, subtitle: "尚未写入正式项目、人才或技术库；刷新页面后即可逐条审核。" });
    } catch (error) { setNotice({ kind: "error", title: "确认导入失败", subtitle: error instanceof Error ? error.message : "请稍后重试。" }); }
    finally { setBusy(null); }
  }

  async function submitReview() {
    if (!reviewing || reviewReason.trim().length < 2) return;
    setBusy(reviewing.candidate.id); setNotice(null);
    try {
      const response = await fetch(`/api/v1/discovery/items/${reviewing.candidate.id}/review`, { method: "PATCH", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ decision: reviewing.decision, expectedVersion: reviewing.candidate.version, reason: reviewReason.trim(), ...(reviewing.decision === "merge" ? { matchedEntityType: reviewing.candidate.matchedEntityType, matchedEntityId: reviewing.candidate.matchedEntityId } : {}) }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "审核失败。");
      setCandidates((current) => current.map((item) => item.id === payload.data.id ? { ...item, ...payload.data } : item));
      setReviewing(null); setReviewReason("");
      setNotice({ kind: "success", title: reviewing.decision === "promote" ? "已入正式库" : reviewing.decision === "merge" ? "已合并到已有实体" : "已拒绝该候选", subtitle: reviewing.decision === "reject" ? "原始证据和审核记录仍可追溯。" : "新增事件、证据、字段断言和补充任务已一并保留。" });
    } catch (error) { setNotice({ kind: "error", title: "审核失败", subtitle: error instanceof Error ? error.message : "请刷新后重试。" }); }
    finally { setBusy(null); }
  }

  async function togglePlan(plan: PlanView) {
    setBusy(`plan:${plan.id}`); setNotice(null);
    try {
      const response = await fetch("/api/v1/discovery/plans", { method: "PATCH", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ id: plan.id, enabled: !plan.enabled, expectedVersion: plan.version }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "计划保存失败。");
      setPlans((current) => current.map((item) => item.id === plan.id ? payload.data : item));
      setNotice({ kind: "success", title: payload.data.enabled ? "监测计划已启用" : "监测计划已暂停", subtitle: plan.name });
    } catch (error) { setNotice({ kind: "error", title: "计划保存失败", subtitle: error instanceof Error ? error.message : "请稍后重试。" }); }
    finally { setBusy(null); }
  }

  async function savePlan() {
    if (!editingPlan) return;
    setBusy(`plan:${editingPlan.plan.id}`); setNotice(null);
    const { plan, draft } = editingPlan;
    const schedule = { frequency: draft.frequency, time: draft.time, weekdaysOnly: draft.weekdaysOnly, ...(draft.frequency === "weekly" ? { weekday: Number(draft.weekday) } : {}) };
    try {
      const response = await fetch("/api/v1/discovery/plans", { method: "PATCH", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ id: plan.id, queryFamily: draft.queryFamily.trim(), tracks: splitList(draft.tracks), subtracks: splitList(draft.subtracks), cities: splitList(draft.cities), preferredDomains: splitList(draft.preferredDomains), dateWindowDays: Number(draft.dateWindowDays), schedule, expectedVersion: plan.version }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "计划保存失败。");
      setPlans((current) => current.map((item) => item.id === plan.id ? payload.data : item));
      setEditingPlan(null);
      setNotice({ kind: "success", title: "监测计划已更新", subtitle: plan.name });
    } catch (error) { setNotice({ kind: "error", title: "计划保存失败", subtitle: error instanceof Error ? error.message : "请稍后重试。" }); }
    finally { setBusy(null); }
  }

  function openPlanEditor(plan: PlanView) {
    setEditingPlan({ plan, draft: { queryFamily: plan.queryFamily, tracks: plan.tracks.join("，"), subtracks: plan.subtracks.join("，"), cities: plan.cities.join("，"), preferredDomains: plan.preferredDomains.join("，"), dateWindowDays: String(plan.dateWindowDays), frequency: plan.schedule.frequency, time: plan.schedule.time, weekdaysOnly: Boolean(plan.schedule.weekdaysOnly), weekday: String(plan.schedule.weekday ?? 0) } });
  }

  return <div className="grid min-w-0 gap-5 pt-1">
    {notice && <InlineNotification kind={notice.kind} title={notice.title} subtitle={notice.subtitle} onCloseButtonClick={() => setNotice(null)} />}

    <section className="rounded-xl border bg-card p-4 sm:p-5" aria-labelledby="featured-projects-title">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl"><div className="flex items-center gap-2"><ShieldCheck className="size-5 text-primary" aria-hidden="true" /><h2 id="featured-projects-title" className="text-xl font-semibold">{toolsOnly ? "数据导入与监测" : "重点新项目"}</h2></div><p className="mt-2 text-sm leading-6 text-muted-foreground">{toolsOnly ? "全面项目资料会按事件日期自动进入下方原有项目卡片：当日放入当天，近七日放入近一周，更早资料保留在全部项目。" : "聚合创投报道、工商、招聘与榜单等公开线索，先呈现最值得投资经理判断的产品、团队和机构信息；确认后才进入正式项目库。"}</p></div>
        {canAdmin && <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border bg-background px-3 text-sm font-semibold text-primary hover:bg-primary/[0.05] focus-within:ring-2 focus-within:ring-ring"><FileJson className="size-4" aria-hidden="true" />上传 Codex 数据包<input className="sr-only" type="file" accept="application/json,.json" aria-label="上传 Codex 数据包" disabled={busy !== null} onChange={(event) => { void uploadBundle(event.target.files?.[0]); event.target.value = ""; }} /></label>
          {preview && <Button onClick={() => void commitBundle()} disabled={busy !== null || preview.valid === 0}>确认写入待审队列</Button>}
        </div>}
      </div>
      {preview && <ImportPreviewDetails preview={preview} />}
      {!toolsOnly && <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="当前结果" value={visible.length} />
        <Metric label="已载入项目" value={candidates.length} />
        <Metric label="A/B 级" value={candidates.filter((item) => item.priority !== "C" && item.status === "pending_review").length} />
        <Metric label="待补字段" value={candidates.reduce((total, item) => total + item.missingFields.length, 0)} />
      </div>}
    </section>

    {!toolsOnly && <section className="rounded-xl border bg-card p-4" aria-label="项目筛选">
      <div className="flex items-center gap-2 text-sm font-semibold"><Settings2 className="size-4 text-primary" aria-hidden="true" />筛选与检索</div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <div className="xl:col-span-2"><TextInput id="intelligence-query" labelText="关键词" placeholder="名称、摘要、子赛道" value={filters.query} onChange={(event) => changeFilter("query", event.target.value)} /></div>
        <FilterSelect id="entity-type" label="主体类型" value={filters.entityType} options={[["all", "全部主体"], ["company", "公司"], ["person", "人才"], ["technology", "技术"]]} onChange={(value) => changeFilter("entityType", value)} />
        <FilterSelect id="channel" label="来源渠道" value={filters.channel} options={[["all", "全部渠道"], ...Object.entries(channelLabels)]} onChange={(value) => changeFilter("channel", value)} />
        <FilterSelect id="city" label="城市" value={filters.city} options={[["all", "全部城市"], ...options.cities.map((value) => [value, value] as [string, string])]} onChange={(value) => changeFilter("city", value)} />
        <FilterSelect id="track" label="赛道" value={filters.track} options={[["all", "全部赛道"], ...options.tracks.map((value) => [value, value] as [string, string])]} onChange={(value) => changeFilter("track", value)} />
        <FilterSelect id="priority" label="优先级" value={filters.priority} options={[["all", "全部优先级"], ["A", "A 级"], ["B", "B 级"], ["C", "C 级"]]} onChange={(value) => changeFilter("priority", value)} />
        <FilterSelect id="completeness" label="完整度" value={filters.completeness} options={[["all", "全部完整度"], ["L0", "L0 线索"], ["L1", "L1 可审核"], ["L2", "L2 可跟进"]]} onChange={(value) => changeFilter("completeness", value)} />
        <FilterSelect id="status" label="审核状态" value={filters.status} options={[["all", "全部状态"], ["pending_review", "待审核"], ["promoted", "已入库"], ["dismissed", "已拒绝"], ["merged", "已合并"]]} onChange={(value) => changeFilter("status", value)} />
        <TextInput id="date-from" type="date" labelText="开始日期" value={filters.dateFrom} onChange={(event) => changeFilter("dateFrom", event.target.value)} />
        <TextInput id="date-to" type="date" labelText="结束日期" value={filters.dateTo} onChange={(event) => changeFilter("dateTo", event.target.value)} />
      </div>
    </section>}

    {!toolsOnly && (visible.length === 0 ? <section className="grid min-h-48 place-items-center rounded-xl border border-dashed bg-card p-6 text-center"><div><Search className="mx-auto size-6 text-muted-foreground" aria-hidden="true" /><h3 className="mt-3 font-semibold">没有符合条件的候选</h3><p className="mt-1 text-sm text-muted-foreground">可调整筛选条件，或导入经过授权的 Codex 数据包。</p></div></section> : <section className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3" aria-live="polite">
      {visible.map((candidate) => {
        const isExpanded = expanded === candidate.id;
        return <article id={`intelligence-${candidate.id}`} key={candidate.id} className="min-w-0 scroll-mt-24 rounded-xl border bg-card p-4 transition-colors hover:border-primary/35">
          <header className="flex items-start justify-between gap-3"><div className="flex flex-wrap gap-2"><Tag type="blue">{candidate.subtrack || candidate.track}</Tag><Tag type={candidate.priority === "A" ? "red" : candidate.priority === "B" ? "blue" : "gray"}>{candidate.priority} 级</Tag><Tag type="outline">{entityLabels[candidate.entityType]}</Tag>{candidate.candidateKind === "entity_update" && <Tag type="purple">已有实体更新</Tag>}</div><time className="shrink-0 text-xs text-muted-foreground">{candidate.eventDate}</time></header>
          <h3 className="mt-3 text-lg font-semibold tracking-tight">{candidate.name}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{candidate.track}{candidate.subtrack ? ` / ${candidate.subtrack}` : ""}{candidate.city ? ` · ${candidate.city}` : ""} · {channelLabels[candidate.channel] ?? candidate.channel}</p>
          <DiscoveryInvestmentBrief name={candidate.name} brief={buildIntelligenceInvestmentBrief(candidate)} />
          {candidate.matchedEntityId && <p className="mt-3 text-xs text-violet-700">匹配建议：{candidate.matchReason}（{Math.round((candidate.matchConfidence ?? 0) * 100)}%），需人工确认</p>}
          {candidate.missingFields.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{candidate.missingFields.slice(0, 4).map((field) => <Tag key={field} type="warm-gray">待补：{field}</Tag>)}</div>}
          <button type="button" aria-expanded={isExpanded} aria-label={`查看${candidate.name}证据与缺口`} onClick={() => setExpanded(isExpanded ? null : candidate.id)} className="mt-3 flex min-h-11 w-full items-center justify-between rounded-lg px-2 text-sm font-semibold text-primary hover:bg-primary/[0.05]">证据、评分与待核问题<ChevronDown className={`size-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} aria-hidden="true" /></button>
          {isExpanded && <CandidateEvidence candidate={candidate} />}
          <footer className="mt-3 flex min-h-11 flex-wrap items-center justify-between gap-2 border-t pt-3"><Tag type={candidate.status === "promoted" ? "green" : candidate.status === "pending_review" ? "warm-gray" : "gray"}>{statusLabels[candidate.status]}</Tag>{candidate.status === "pending_review" && canReview && <div className="flex flex-wrap gap-2"><Button kind="danger--tertiary" size="sm" renderIcon={X} aria-label={`暂不跟进${candidate.name}`} onClick={() => { setReviewing({ candidate, decision: "reject" }); setReviewReason(""); }}>暂不跟进</Button>{candidate.matchedEntityId && <Button kind="secondary" size="sm" aria-label={`合并${candidate.name}到已有实体`} onClick={() => { setReviewing({ candidate, decision: "merge" }); setReviewReason(""); }}>合并更新</Button>}<Button size="sm" renderIcon={Check} aria-label={`入库${candidate.name}`} onClick={() => { setReviewing({ candidate, decision: "promote" }); setReviewReason(""); }}>入库</Button></div>}</footer>
        </article>;
      })}
    </section>)}
    {!toolsOnly && sourceOffset < sourceTotal && <div className="flex justify-center"><Button kind="secondary" disabled={busy !== null} onClick={() => void loadMore()}>加载更多项目</Button></div>}

    <section className="rounded-xl border bg-card p-4" aria-labelledby="discovery-plan-title"><div className="flex items-center gap-2"><Settings2 className="size-4 text-primary" aria-hidden="true" /><h3 id="discovery-plan-title" className="font-semibold">四类监测计划</h3></div><p className="mt-1 text-xs leading-5 text-muted-foreground">工商与招聘连接器在正式 API 授权前保持关闭；公开搜索与 RSS 可按计划运行。</p><div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{plans.map((plan) => { const waitingForLicense = plan.connectorType === "licensed_api" && plan.connectorReady !== true; return <div key={plan.id} className="rounded-lg border p-3"><div className="flex items-start justify-between gap-2"><strong className="text-sm">{plan.name}</strong><Tag type={plan.enabled ? "green" : "gray"}>{plan.enabled ? "启用" : "关闭"}</Tag></div><p className="mt-2 text-xs leading-5 text-muted-foreground">{plan.queryFamily}</p><p className="mt-2 text-xs">{frequencyLabels[plan.schedule.frequency] ?? plan.schedule.frequency} {plan.schedule.time} · {waitingForLicense ? "待授权 API" : "信源已就绪"}</p>{canAdmin && <div className="mt-3 grid grid-cols-2 gap-2"><Button kind="ghost" size="sm" aria-label={`配置${plan.name}`} disabled={busy !== null} onClick={() => openPlanEditor(plan)}>配置</Button><Button kind="secondary" size="sm" disabled={busy !== null || waitingForLicense} onClick={() => void togglePlan(plan)}>{waitingForLicense ? "待采购授权" : plan.enabled ? "暂停" : "启用"}</Button></div>}</div>; })}</div></section>

    <Modal open={Boolean(reviewing)} modalHeading={reviewing?.decision === "promote" ? `审核入库：${reviewing.candidate.name}` : reviewing?.decision === "merge" ? `合并更新：${reviewing.candidate.name}` : `拒绝候选：${reviewing?.candidate.name ?? ""}`} primaryButtonText={reviewing?.decision === "promote" ? "确认入库" : reviewing?.decision === "merge" ? "确认合并" : "确认拒绝"} secondaryButtonText="取消" primaryButtonDisabled={reviewReason.trim().length < 2 || busy !== null} onRequestClose={() => { if (!busy) { setReviewing(null); setReviewReason(""); } }} onRequestSubmit={() => void submitReview()}><p className="text-sm leading-6 text-muted-foreground">请确认来源、实体匹配和关键待核问题。入库或合并后会保留完整证据链，并把新增信号追加到正式实体。</p><TextArea id="intelligence-review-reason" labelText="审核意见" value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} maxLength={2_000} /></Modal>
    <Modal open={Boolean(editingPlan)} modalHeading={editingPlan ? `配置：${editingPlan.plan.name}` : "配置监测计划"} primaryButtonText="保存计划" secondaryButtonText="取消" primaryButtonDisabled={!editingPlan || editingPlan.draft.queryFamily.trim().length < 2 || splitList(editingPlan.draft.tracks).length === 0 || busy !== null} onRequestClose={() => { if (!busy) setEditingPlan(null); }} onRequestSubmit={() => void savePlan()}>
      {editingPlan && <div className="grid gap-3 sm:grid-cols-2"><div className="sm:col-span-2"><TextArea id="plan-query-family" labelText="查询主题" value={editingPlan.draft.queryFamily} onChange={(event) => setPlanDraft(setEditingPlan, "queryFamily", event.target.value)} /></div><TextInput id="plan-tracks" labelText="赛道" value={editingPlan.draft.tracks} onChange={(event) => setPlanDraft(setEditingPlan, "tracks", event.target.value)} /><TextInput id="plan-subtracks" labelText="子赛道" value={editingPlan.draft.subtracks} onChange={(event) => setPlanDraft(setEditingPlan, "subtracks", event.target.value)} /><TextArea id="plan-cities" labelText="重点城市" value={editingPlan.draft.cities} onChange={(event) => setPlanDraft(setEditingPlan, "cities", event.target.value)} /><TextArea id="plan-domains" labelText="优先域名" value={editingPlan.draft.preferredDomains} onChange={(event) => setPlanDraft(setEditingPlan, "preferredDomains", event.target.value)} /><TextInput id="plan-window" type="number" min={1} max={365} labelText="日期窗口（天）" value={editingPlan.draft.dateWindowDays} onChange={(event) => setPlanDraft(setEditingPlan, "dateWindowDays", event.target.value)} /><TextInput id="plan-time" type="time" labelText="运行时间" value={editingPlan.draft.time} onChange={(event) => setPlanDraft(setEditingPlan, "time", event.target.value)} /><Select id="plan-frequency" labelText="运行频率" value={editingPlan.draft.frequency} onChange={(event) => setPlanDraft(setEditingPlan, "frequency", event.target.value)}><SelectItem value="daily" text="每日" /><SelectItem value="every_two_days" text="每两日" /><SelectItem value="weekly" text="每周" /></Select><label className="flex min-h-11 items-center gap-2 self-end text-sm"><input type="checkbox" checked={editingPlan.draft.weekdaysOnly} onChange={(event) => setPlanDraft(setEditingPlan, "weekdaysOnly", event.target.checked)} />仅工作日运行</label>{editingPlan.draft.frequency === "weekly" && <Select id="plan-weekday" labelText="每周运行日" value={editingPlan.draft.weekday} onChange={(event) => setPlanDraft(setEditingPlan, "weekday", event.target.value)}>{[[0,"周日"],[1,"周一"],[2,"周二"],[3,"周三"],[4,"周四"],[5,"周五"],[6,"周六"]].map(([value,label]) => <SelectItem key={value} value={String(value)} text={String(label)} />)}</Select>}</div>}
    </Modal>
  </div>;
}

function CandidateEvidence({ candidate }: { candidate: IntelligenceCandidateView }) {
  const evidence = candidate.evidence ?? [];
  return <div className="mt-2 grid gap-3 rounded-lg bg-muted/35 p-3 text-sm">
    <div className="grid grid-cols-5 gap-1 text-center">{Object.entries(candidate.scores).map(([key, value]) => <div key={key} className="rounded-md bg-background p-2"><div className="text-xs text-muted-foreground">{{ technology: "技术", team: "团队", commercial: "商业", signal: "信号", evidence: "证据" }[key]}</div><strong>{value}/5</strong></div>)}</div>
    {evidence.length > 0 ? <ul className="grid gap-2">{evidence.map((source) => <li key={String(source.id ?? source.ref)} className="rounded-md border bg-background p-2"><a href={String(source.url)} target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">{String(source.title)}</a><p className="mt-1 text-xs leading-5 text-muted-foreground">{String(source.excerpt)} · 来源等级 {String(source.authority)}</p></li>)}</ul> : <p className="text-xs text-muted-foreground">来源详情待刷新或补充。</p>}
    {candidate.openQuestions.length > 0 && <div><strong>关键待核问题</strong><ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">{candidate.openQuestions.map((question) => <li key={question}>{question}</li>)}</ul></div>}
    {candidate.missingFields.length > 0 && <div className="flex flex-wrap gap-2">{candidate.missingFields.map((field) => <Tag key={field} type="warm-gray">待补：{field}</Tag>)}</div>}
  </div>;
}

function ImportPreviewDetails({ preview }: { preview: ImportPreviewView }) {
  const matches = preview.items.flatMap((item) => item.matches.map((match) => ({ ...match, itemName: item.name })));
  return <section className="mt-4 rounded-lg border bg-muted/25 p-3" aria-label="数据包预检差异">
    <div className="flex flex-wrap gap-2 text-xs"><Tag type="green">可导入 {preview.valid}</Tag><Tag type={preview.errors.length ? "red" : "gray"}>错误 {preview.errors.length}</Tag><Tag type={preview.duplicates.length ? "warm-gray" : "gray"}>重复 {preview.duplicates.length}</Tag></div>
    <div className="mt-3 grid gap-3 lg:grid-cols-3">
      <div><strong className="text-sm">错误记录</strong>{preview.errors.length ? <ul className="mt-1 space-y-1 text-xs text-destructive">{preview.errors.map((error) => <li key={`${error.index}:${error.message}`}>第 {error.index + 1} 条：{error.message}</li>)}</ul> : <p className="mt-1 text-xs text-muted-foreground">无字段错误</p>}</div>
      <div><strong className="text-sm">重复记录</strong>{preview.duplicates.length ? <ul className="mt-1 space-y-1 text-xs text-muted-foreground">{preview.duplicates.map((duplicate) => <li key={`${duplicate.index}:${duplicate.candidateId}`}>第 {duplicate.index + 1} 条：已存在 {duplicate.candidateId}</li>)}</ul> : <p className="mt-1 text-xs text-muted-foreground">未发现内容级重复</p>}</div>
      <div><strong className="text-sm">疑似实体匹配</strong>{matches.length ? <ul className="mt-1 space-y-1 text-xs text-muted-foreground">{matches.map((match, index) => <li key={`${match.itemName}:${match.name}:${index}`}>{match.itemName} → {match.name}（{Math.round(match.confidence * 100)}%）：{match.reason}</li>)}</ul> : <p className="mt-1 text-xs text-muted-foreground">未发现高置信匹配</p>}</div>
    </div>
  </section>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-lg border bg-muted/25 p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-xl font-semibold tabular-nums">{value}</div></div>; }
function FilterSelect({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }) { return <Select id={id} labelText={label} value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([optionValue, text]) => <SelectItem key={optionValue} value={optionValue} text={text} />)}</Select>; }
function unique(values: string[]): string[] { return [...new Set(values)].sort((left, right) => left.localeCompare(right, "zh-CN")); }
function prepareCandidates(items: IntelligenceCandidateView[]): IntelligenceCandidateView[] {
  return mergeCandidatePages([], items.filter((item) => !item.legacyProjectCandidateId));
}
function mergeCandidatePages(current: IntelligenceCandidateView[], incoming: IntelligenceCandidateView[]): IntelligenceCandidateView[] {
  const ids = new Set(current.map((item) => item.id));
  const fingerprints = new Set(current.map(candidateFingerprint));
  return incoming.reduce((result, item) => {
    const fingerprint = candidateFingerprint(item);
    if (ids.has(item.id) || fingerprints.has(fingerprint)) return result;
    ids.add(item.id); fingerprints.add(fingerprint);
    return [...result, item];
  }, [...current]);
}
function candidateFingerprint(item: IntelligenceCandidateView): string {
  const summary = item.investmentSummary || item.discoveryReason;
  return [item.entityType, item.name, item.signalType, item.eventDate, summary].map((value) => value.normalize("NFKC").replace(/\s+/gu, "").toLocaleLowerCase("zh-CN")).join("|");
}
function splitList(value: string): string[] { return unique(value.split(/[,，\n]/u).map((item) => item.trim()).filter(Boolean)); }
function setPlanDraft(setter: Dispatch<SetStateAction<{ plan: PlanView; draft: PlanDraft } | null>>, key: keyof PlanDraft, value: string | boolean): void { setter((current) => current ? { ...current, draft: { ...current.draft, [key]: value } } : current); }
function readFileText(file: File): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error("无法读取数据包。")); reader.onload = () => resolve(String(reader.result ?? "")); reader.readAsText(file); }); }
