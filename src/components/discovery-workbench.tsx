"use client";

import { filterCandidateQueue, shanghaiDate } from "@/workbench/candidate-queue-contracts";
import { CandidateAdminEditor } from "./candidate-admin-editor";
import { CandidateOrderButtons, candidateDay, queueCompare } from "./candidate-queue-view";
import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  Bot,
  Check,
  ChevronDown,
  CircleX,
  ArrowDown,
  ArrowUp,
  FileUp,
  Search,
} from "lucide-react";
import { Button, InlineNotification, Select, SelectItem, Tag, TextInput } from "@/components/ui/legacy";
import { TRACKS } from "@/domain/projects";
import type { CandidateView } from "@/workbench/candidate-details";
import { discoveryEventIdentity } from "@/workbench/discovery-identity";
import { ManualCandidateUpload } from "./manual-candidate-upload";
import { CandidateDiscoveryDetails } from "./candidate-discovery-details";
import { CandidateIntakeDialog, type CandidateIntakeOptions } from "./candidate-intake-dialog";
import { recordRecentActivityParticipants } from "./activity-participant-picker";
import { buildLegacyInvestmentBrief, DiscoveryInvestmentBrief } from "./discovery-investment-brief";
import type { IntelligenceCandidateView } from "@/intelligence/repository";
import { IntelligenceProjectCard } from "./intelligence-project-card";

interface DiscoveryJobView { id: string; status: string; query: { query: string }; createdAt: string; provider?: { id: string }; workflow?: { version: string } }
interface TeamMemberLite { id: string; name: string; departmentId?: string | null; departmentName?: string | null }

export function DiscoveryWorkbench({ jobs, candidates, intelligenceCandidates = [], team = [], currentUser = "当前用户", searchMode = "local-index", canAdmin = false, canReview = false, recentScopeKey, intelligenceTools }: { canAdmin?: boolean; canReview?: boolean; searchMode?: "local-index" | "deepseek-web-search" | "exa"; jobs: DiscoveryJobView[]; candidates: CandidateView[]; intelligenceCandidates?: IntelligenceCandidateView[]; team?: TeamMemberLite[]; currentUser?: string; recentScopeKey?: string; intelligenceTools?: ReactNode }) {
  const [manualFile,setManualFile] = useState<File|null>(null);
  const [query, setQuery] = useState("");
  const [track, setTrack] = useState("all");
  const [candidateState, setCandidateState] = useState(candidates);
  const [intelligenceState, setIntelligenceState] = useState(() => prepareIntelligenceCandidates(intelligenceCandidates));
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error" | "info"; title: string; subtitle: string } | null>(null);
  const [period, setPeriod] = useState<"today" | "week">("today");
  const [filterQuery, setFilterQuery] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(12);
  const [expandedCandidate, setExpandedCandidate] = useState<string | null>(null);
  const [intakeId, setIntakeId] = useState<string | null>(null);
  const reviewRetry = useRef<{ payload: string; key: string } | null>(null);
  function updateCandidate(candidate: CandidateView) { setCandidateState(previous => previous.map(row => row.id === candidate.id ? candidate : row)); }
  const intake = candidateState.find((candidate) => candidate.id === intakeId) ?? null;
  const ordered = useMemo(() => candidateState.toSorted(queueCompare), [candidateState]);
  const legacyVisible = filterCandidateQueue(ordered, { period, q: filterQuery, ...(filterDate ? { date: filterDate } : {}), ...(track !== "all" ? { track } : {}) }).filter(item => item.status !== "dismissed" && !item.archivedAt);
  const intelligenceVisible = useMemo(() => filterIntelligenceTimeline(intelligenceState, { period, query: filterQuery, date: filterDate, track }, new Date()), [filterDate, filterQuery, intelligenceState, period, track]);
  const visible = useMemo(() => mergeDiscoveryTimeline(legacyVisible, intelligenceVisible), [intelligenceVisible, legacyVisible]);
  const orderRetry = useRef<{ body: string; key: string } | null>(null);
  async function moveCandidate(candidate: CandidateView, direction: -1 | 1) {
    if (busy) return;
    const group = ordered.filter(row => candidateDay(row.createdAt) === candidateDay(candidate.createdAt) && (row.status === "dismissed") === (candidate.status === "dismissed"));
    const index = group.findIndex(row => row.id === candidate.id), target = index + direction;
    if (target < 0 || target >= group.length) return;
    const body = JSON.stringify({ move: { id: candidate.id, expectedVersion: candidate.version, direction: direction === -1 ? "up" : "down" } });
    if (orderRetry.current?.body !== body) orderRetry.current = { body, key: crypto.randomUUID() };
    setBusy("order"); setNotice(null);
    try {
      const response = await fetch("/api/v1/candidates/order", { method: "PATCH", headers: { "content-type": "application/json", "idempotency-key": orderRetry.current.key }, body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "排序保存失败，请刷新后重试。");
      setCandidateState(previous => previous.map(row => { const updated = payload.data.items.find((item: CandidateView) => item.id === row.id); return updated ? { ...row, version: updated.version, queueRank: updated.queueRank } : row; }));
      orderRetry.current = null;
      setNotice({ kind: "success", title: "排序已保存", subtitle: "团队成员刷新后可看到相同顺序。" });
    } catch (error) { setNotice({ kind: "error", title: "排序失败", subtitle: error instanceof Error ? error.message : "请稍后重试。" }); }
    finally { setBusy(null); }
  }
  function moveIntelligenceCandidate(candidate: IntelligenceCandidateView, direction: -1 | 1) {
    setIntelligenceState((current) => moveIntelligenceRow(current, candidate, direction));
    setNotice({ kind: "info", title: "本地预览顺序已调整", subtitle: "当前仅用于本地前端确认，正式保存方式待你确认后再接入。" });
  }

  async function createSearch(event: React.FormEvent) {
    event.preventDefault();
    if (query.trim().length < 3) return;
    setBusy("search"); setNotice(null);
    try {
      const response = await fetch("/api/v1/discovery/jobs", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ query: query.trim(), tracks: track === "all" ? [] : [track], institutions: [], resultLimit: 20 }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "搜索任务创建失败。");
      setNotice({ kind: "success", title: "搜索任务已入队", subtitle: payload.data?.provider?.id === "local-index" || (!payload.data?.provider && searchMode === "local-index") ? "后台将检索本站已收录的公开信源，并使用你的模型筛选；没有匹配信源时会返回空结果。" : "后台将联网检索公开信源，并使用你的模型筛选候选项目。" });
      setQuery("");
    } catch (error) { setNotice({ kind: "error", title: "搜索任务创建失败", subtitle: error instanceof Error ? error.message : "请稍后重试。" }); }
    finally { setBusy(null); }
  }

  async function review(candidate: CandidateView, decision: "promote" | "reject", options: CandidateIntakeOptions = {}) {
    setBusy(candidate.id); setNotice(null);
    try {
      const body = { decision, expectedVersion: candidate.version, ...(decision === "promote" ? options : {}), reason: decision === "promote" ? "确认进入项目管理" : "投资经理人工排除" };
      const fingerprint = JSON.stringify({ candidateId: candidate.id, ...body });
      if (reviewRetry.current?.payload !== fingerprint) reviewRetry.current = { payload: fingerprint, key: crypto.randomUUID() };
      const response = await fetch(`/api/v1/candidates/${candidate.id}/review`, { method: "PATCH", headers: { "content-type": "application/json", "idempotency-key": reviewRetry.current.key }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "候选复核失败。");

      setCandidateState((current) => current.map((item) => item.id === candidate.id ? { ...item, status: payload.data.status, version: payload.data.version, projectId: payload.data.projectId, track: options.track || item.track } : item));

      reviewRetry.current = null;
      setIntakeId(null);
      if (decision === "promote" && recentScopeKey) {
        const savedNames = options.assignees ?? (options.assignee ? [options.assignee] : []);
        recordRecentActivityParticipants(recentScopeKey, team.filter(member => savedNames.includes(member.name)).map(member => member.id));
      }

      setNotice({
        kind: "success",
        title: decision === "promote" ? (options.assignees?.length || options.assignee) ? `项目已入库，负责人：${options.assignees?.join("、") ?? options.assignee}` : "候选已正式入库" : "已设为暂不跟进",
        subtitle: decision === "promote" ? "项目已进入项目管理，仍会保留在发现列表中。" : "可在更多功能 → 全部项目中查找，原始资料和处理记录均已保留。",
      });
    } catch (error) { setNotice({ kind: "error", title: "操作失败", subtitle: error instanceof Error ? error.message : "请刷新后重试。" }); }
    finally { setBusy(null); }
  }

  function receiveManualFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 20*1024*1024 || !/\.(pdf|docx|txt|md)$/i.test(file.name)) { setNotice({ kind:"error",title:"文件不受支持",subtitle:"请选择20 MB以内的PDF、DOCX、TXT或Markdown。" }); return; }
    setManualFile(file);
  }

  return (
    <div className="grid min-w-0 gap-5 pt-5">
      {manualFile && <ManualCandidateUpload key={`${manualFile.name}:${manualFile.lastModified}`} file={manualFile} onClose={()=>setManualFile(null)} onSaved={candidate=>{ setCandidateState(current=>[candidate,...current.filter(item=>item.id!==candidate.id)]);setManualFile(null);setNotice({kind:"success",title:"线索与原件已保存",subtitle:"可在项目详情中下载原文件，待人工审核后入库。"}); }} />}
      {notice && <InlineNotification kind={notice.kind} lowContrast title={notice.title} subtitle={notice.subtitle} onCloseButtonClick={() => setNotice(null)} />}

      <section id="manual-discovery" className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,0.45fr)]" aria-labelledby="discovery-tools-title">
        <div>
          <div className="flex items-center gap-2"><Bot className="size-4 text-primary" aria-hidden="true" /><h2 id="discovery-tools-title" className="font-semibold">补充发现条件</h2></div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">{searchMode === "local-index" ? "当前范围：本站已收录的公开信源，不代表全网搜索。AI 使用你在设置中选择的 API 和模型筛选真实资料。" : searchMode === "exa" ? "优先使用 Exa 联网；服务不可用时检索本站已收录信源，任务记录会标明实际范围。筛选使用你的 API 和模型。" : "当前范围：使用你自己的 DeepSeek API 联网搜索并筛选公开信源。"}</p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">优先搜索投中网、36氪北京时间当天首次发布的投融资新闻，无法核实发布日期时跳过，不用旧新闻补足数量。</p>
          <form onSubmit={createSearch} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
            <TextInput id="discovery-query" labelText="搜索主题" placeholder="例如：国内半导体设备新融资" value={query} onChange={(event) => setQuery(event.target.value)} required minLength={3} />
            <Select id="discovery-track" labelText="赛道" value={track} onChange={(event) => setTrack(event.target.value)}><SelectItem value="all" text="全部赛道" />{TRACKS.map((item) => <SelectItem key={item} value={item} text={item} />)}</Select>
            <Button type="submit" renderIcon={Search} disabled={busy !== null || query.trim().length < 3}>{busy === "search" ? "正在入队" : "让 AI 搜索"}</Button>
          </form>
        </div>
        <div className="flex flex-col justify-between gap-4 rounded-lg border border-dashed border-border bg-muted/35 p-4">
          <div><div className="flex items-center gap-2 text-sm font-semibold"><FileUp className="size-4 text-primary" aria-hidden="true" />人工上传线索</div><p className="mt-2 text-xs leading-5 text-muted-foreground">上传 PDF、Word 或文本，本地提取正文，核对后保存候选线索和原始文件。</p></div>
          <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-primary transition-colors hover:bg-primary/[0.05] focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
            <FileUp className="size-4" aria-hidden="true" />选择文件
            <input className="sr-only" type="file" accept=".pdf,.docx,.txt,.md" aria-label="人工上传项目线索" onChange={(event) => { receiveManualFile(event.target.files?.[0]); event.target.value=""; }} />
          </label>
        </div>
      </section>

      {jobs.length > 0 && <section className="rounded-lg border p-3 text-xs"><div className="flex items-center justify-between"><strong>最近发现任务</strong><button type="button" className="text-primary underline" onClick={()=>window.location.reload()}>刷新任务状态</button></div><ul className="mt-2 grid gap-2">{jobs.slice(0,5).map(job=><li key={job.id}>{job.query.query} · {{queued:"排队中",running:"运行中",succeeded:"已完成",failed:"失败"}[job.status] ?? job.status} · {job.provider?.id === "local-index" ? "本站已收录信源检索" : job.provider?.id === "exa" ? "Exa 联网搜索" : job.provider?.id === "deepseek-web-search" ? "DeepSeek 联网搜索" : "等待确定检索范围"}</li>)}</ul></section>}
      {intelligenceTools}
      <section className="min-w-0" aria-label="待查看项目列表">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div><h2 id="candidate-title" className="text-xl font-semibold">待查看项目</h2><p className="mt-1 text-sm text-muted-foreground">AI 只收录北京时间当天首次发布的新闻；旧新闻或日期无法核实的内容不进入当天列表。人工上传按收录日期显示，历史内容可在全部项目查看。</p></div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground"><span>{visible.filter((item) => item.candidate.status === "pending_review").length} 项待处理</span><span>{jobs.filter((job) => ["queued", "running"].includes(job.status)).length} 个任务运行中</span></div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div role="group" aria-label="查看项目时间范围" className="flex flex-wrap rounded-lg border bg-muted/30 p-1">{([["today", "当天"], ["week", "近一周"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={period === value} onClick={() => { setPeriod(value); setFilterDate(""); setExpandedCandidate(null); setVisibleLimit(12); }} className={`min-h-11 rounded-md px-4 text-sm ${period === value ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{label}</button>)}</div>
          <Link href="/all-projects" className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-primary hover:underline">全部项目</Link>
          <input aria-label="筛选项目关键词" placeholder="搜索公司、简介、行业或投资方" value={filterQuery} onChange={event => { setFilterQuery(event.target.value); setVisibleLimit(12); }} maxLength={200} className="min-h-11 min-w-0 flex-1 rounded-lg border bg-card px-3 text-sm" />
          <label className="flex items-center gap-2 text-sm text-muted-foreground">收录日期<input type="date" aria-label="按日期查看项目" value={filterDate} onChange={event => { setFilterDate(event.target.value); setVisibleLimit(12); }} className="min-h-11 rounded-lg border bg-card px-3 text-foreground" /></label>
          {filterDate && <button type="button" className="min-h-11 text-sm text-primary" onClick={() => setFilterDate("")}>清除日期</button>}
          <span className="text-xs text-muted-foreground">{visible.length} 个项目</span>
        </div>
        {visible.length === 0 ? (
          <div className="mt-4 grid min-h-48 place-items-center rounded-xl border border-dashed bg-card p-6 text-center"><div><Search className="mx-auto size-7 text-muted-foreground" aria-hidden="true" /><h3 className="mt-3 font-semibold">暂时没有新项目</h3><p className="mt-1 text-sm text-muted-foreground">仅展示符合日期要求的新闻与人工上传线索；没有当天新闻时保持为空。</p></div></div>
        ) : (
          <>
            <div className="mt-4 grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visible.slice(0, visibleLimit).map((item) => {
                if (item.kind === "intelligence") return <IntelligenceProjectCard key={`intelligence:${item.candidate.id}`} candidate={item.candidate} canAdmin={canAdmin} canReview={canReview} orderControls={canAdmin ? <IntelligenceOrderButtons candidate={item.candidate} rows={intelligenceState} onMove={moveIntelligenceCandidate} /> : undefined} onUpdated={(updated) => setIntelligenceState((current) => current.map((candidate) => candidate.id === updated.id ? updated : candidate))} />;
                const candidate = item.candidate;
                const expanded = expandedCandidate === candidate.id;
                return (
                  <article id={`candidate-${candidate.id}`} className={`flex min-w-0 scroll-mt-24 flex-col rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/35 ${expanded ? "md:col-span-2 xl:col-span-3" : ""}`} key={candidate.id}>
                    <header className="flex items-start justify-between gap-3">
                      <h3 className="min-w-0 text-lg font-semibold tracking-tight">{candidate.companyName}</h3>
                      <div className="flex shrink-0 flex-wrap justify-end gap-1.5"><Tag type="gray" size="sm">{candidate.origin === "manual_screenshot" || candidate.confidence === null ? "人工线索" : `AI ${Math.round(candidate.confidence * 100)}%`}</Tag><Tag type={candidate.status === "promoted" ? "green" : candidate.status === "pending_review" ? "warm-gray" : "gray"} size="sm">{candidate.status === "promoted" ? "已入库" : candidate.status === "pending_review" ? "待审核" : "暂不跟进"}</Tag></div>
                    </header>
                    <DiscoveryInvestmentBrief name={candidate.companyName} brief={buildLegacyInvestmentBrief(candidate)} />

                    <button type="button" aria-label="查看项目详情" aria-expanded={expanded} onClick={() => setExpandedCandidate(expanded ? null : candidate.id)} className="mt-2 flex min-h-11 cursor-pointer items-center justify-between rounded-lg px-2 text-left text-sm font-medium text-primary transition-colors hover:bg-primary/[0.05]">
                      {expanded ? "收起详细信息" : "展开详细信息"}<ChevronDown className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
                    </button>
                    {expanded && <>
                      <CandidateDiscoveryDetails candidate={candidate} />
                      {canAdmin && <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><CandidateOrderButtons candidate={candidate} rows={ordered} busy={busy !== null} onMove={moveCandidate} /><CandidateAdminEditor candidate={candidate} onUpdated={updateCandidate} /></div>}
                      <footer className="pt-2">
                        {candidate.status === "pending_review" ? (
                          <div className="grid grid-cols-2 gap-2">
                            <Button kind="danger--tertiary" size="sm" className="min-h-11" renderIcon={CircleX} disabled={busy !== null} onClick={() => review(candidate, "reject")}>暂不跟进</Button>
                            <Button size="sm" className="min-h-11" renderIcon={Check} disabled={busy !== null} onClick={() => { setNotice(null); setIntakeId(candidate.id); }}>入库</Button>
                          </div>
                        ) : candidate.projectId ? <div className="flex min-h-11 justify-end"><a className="text-sm font-semibold text-primary" href={`/projects/${candidate.projectId}`}>打开项目</a></div> : null}
                      </footer>
                    </>}
                  </article>
                );
              })}
            </div>
            {visibleLimit < visible.length && <div className="flex justify-center py-5"><Button kind="secondary" onClick={() => setVisibleLimit((current) => current + 12)}>加载更多（已显示 {visibleLimit}/{visible.length}）</Button></div>}
          </>
        )}
      </section>
      {intake && <CandidateIntakeDialog key={intake.id} candidate={intake} team={team} currentUser={currentUser} recentScopeKey={recentScopeKey} busy={busy !== null} error={notice?.kind === "error" ? notice.subtitle : undefined} onCancel={() => setIntakeId(null)} onConfirm={(options) => review(intake, "promote", options)} />}
    </div>
  );
}

type DiscoveryTimelineItem = { kind: "legacy"; candidate: CandidateView; day: string; order: number } | { kind: "intelligence"; candidate: IntelligenceCandidateView; day: string; order: number };
function filterIntelligenceTimeline(rows: readonly IntelligenceCandidateView[], filters: { period: "today" | "week"; query: string; date: string; track: string }, now: Date): IntelligenceCandidateView[] {
  const today = shanghaiDate(now);
  const weekStart = shanghaiDate(new Date(now.getTime() - 6 * 86_400_000));
  const query = filters.query.trim().toLocaleLowerCase("zh-CN");
  return rows.filter((candidate) => {
    if (candidate.status === "dismissed" || candidate.eventDate > today || candidate.eventDate < weekStart) return false;
    if (filters.date ? candidate.eventDate !== filters.date : filters.period === "today" ? candidate.eventDate !== today : false) return false;
    if (filters.track !== "all" && candidate.track !== filters.track) return false;
    return !query || [candidate.name, candidate.track, candidate.subtrack ?? "", candidate.city ?? "", candidate.discoveryReason, candidate.investmentSummary, ...candidate.investmentHighlights, ...intelligenceInvestors(candidate)].join(" ").toLocaleLowerCase("zh-CN").includes(query);
  }).toSorted((left, right) => right.eventDate.localeCompare(left.eventDate));
}
function mergeDiscoveryTimeline(legacy: readonly CandidateView[], intelligence: readonly IntelligenceCandidateView[]): DiscoveryTimelineItem[] {
  const intelligenceKeys = new Set(intelligence.map((candidate) => discoveryEventIdentity(candidate.name, candidate.eventDate, candidate.signalType)));
  const legacyItems: DiscoveryTimelineItem[] = legacy.flatMap((candidate, order) => {
    const day = candidate.eventDate || shanghaiDate(candidate.lead.publishedAt || candidate.createdAt);
    return intelligenceKeys.has(discoveryEventIdentity(candidate.companyName, day, candidate.signalType)) ? [] : [{ kind: "legacy" as const, candidate, day, order }];
  });
  const intelligenceItems: DiscoveryTimelineItem[] = intelligence.map((candidate, order) => ({ kind: "intelligence", candidate, day: candidate.eventDate, order }));
  return [...legacyItems, ...intelligenceItems].toSorted((left, right) => right.day.localeCompare(left.day) || left.order - right.order || left.kind.localeCompare(right.kind));
}
function prepareIntelligenceCandidates(rows: readonly IntelligenceCandidateView[]): IntelligenceCandidateView[] {
  const selected = new Map<string, { candidate: IntelligenceCandidateView; firstIndex: number }>();
  rows.forEach((candidate, index) => {
    if (candidate.legacyProjectCandidateId) return;
    const key = discoveryEventIdentity(candidate.name, candidate.eventDate, candidate.signalType);
    const current = selected.get(key);
    if (!current) selected.set(key, { candidate, firstIndex: index });
    else if (intelligenceCandidateQuality(candidate) > intelligenceCandidateQuality(current.candidate)) selected.set(key, { candidate, firstIndex: current.firstIndex });
  });
  return [...selected.values()].toSorted((left, right) => left.firstIndex - right.firstIndex).map(({ candidate }) => candidate);
}
function intelligenceInvestors(candidate: IntelligenceCandidateView): string[] {
  const company = candidate.details.company && typeof candidate.details.company === "object" && !Array.isArray(candidate.details.company) ? candidate.details.company as Record<string, unknown> : {};
  const history = Array.isArray(company.fundingHistory) ? company.fundingHistory : [];
  const latest = history.at(-1);
  return latest && typeof latest === "object" && !Array.isArray(latest) && Array.isArray((latest as Record<string, unknown>).investors) ? (latest as Record<string, unknown>).investors as string[] : [];
}
function intelligenceCandidateQuality(candidate: IntelligenceCandidateView): number {
  const completeness = { L0: 0, L1: 1, L2: 2 }[candidate.completeness];
  const supportingRecords = (candidate.evidence?.length ?? 0) + (candidate.assertions?.length ?? 0) + (candidate.relationships?.length ?? 0) + (candidate.contacts?.length ?? 0);
  const freshness = Number.isFinite(Date.parse(candidate.updatedAt)) ? Date.parse(candidate.updatedAt) / 1e13 : 0;
  return completeness * 10_000 + supportingRecords * 100 + freshness;
}
function moveIntelligenceRow(rows: readonly IntelligenceCandidateView[], candidate: IntelligenceCandidateView, direction: -1 | 1): IntelligenceCandidateView[] {
  const group = rows.filter((row) => row.eventDate === candidate.eventDate && row.status !== "dismissed");
  const index = group.findIndex((row) => row.id === candidate.id), target = index + direction;
  if (index < 0 || target < 0 || target >= group.length) return [...rows];
  const left = rows.findIndex((row) => row.id === group[index].id), right = rows.findIndex((row) => row.id === group[target].id);
  const next = [...rows];
  [next[left], next[right]] = [next[right], next[left]];
  return next;
}
function IntelligenceOrderButtons({ candidate, rows, onMove }: { candidate: IntelligenceCandidateView; rows: readonly IntelligenceCandidateView[]; onMove: (candidate: IntelligenceCandidateView, direction: -1 | 1) => void }) {
  const group = rows.filter((row) => row.eventDate === candidate.eventDate && row.status !== "dismissed");
  const index = group.findIndex((row) => row.id === candidate.id);
  return <div className="flex gap-1"><button type="button" aria-label={`上移 ${candidate.name}`} disabled={index <= 0} onClick={() => onMove(candidate, -1)} className="grid size-11 place-items-center rounded-lg border hover:bg-muted disabled:opacity-30"><ArrowUp className="size-4" aria-hidden="true" /></button><button type="button" aria-label={`下移 ${candidate.name}`} disabled={index < 0 || index === group.length - 1} onClick={() => onMove(candidate, 1)} className="grid size-11 place-items-center rounded-lg border hover:bg-muted disabled:opacity-30"><ArrowDown className="size-4" aria-hidden="true" /></button></div>;
}
