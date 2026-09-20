"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleAlert,
  Clock3,
  FileText,
  Paperclip,
  Plus,
  UserRound,
} from "lucide-react";
import { CommentDeleteButton } from "@/components/comment-delete-button";
import { Button, InlineNotification, Select, SelectItem, Tag, TextArea, TextInput } from "@/components/ui/legacy";
import { recentFirstMembers, recordRecentActivityParticipants } from "@/components/activity-participant-picker";
import { dealStageIdForValue, deriveCurrentDealStage } from "@/workbench/deal-stages";

interface TeamMemberLite { id: string; name: string; departmentId?: string | null; departmentName?: string | null }
interface StageDef { id: string; label: string; suggestedMilestones: string[] }
interface AttachmentView { id: string; milestoneId: string; title: string; uri: string | null; documentId: string | null; note: string; createdBy: string; createdAt: string }
interface CommentView { id: string; projectId: string; milestoneId: string | null; authorId: string; authorName: string; body: string; mentions: Array<{ id: string; name: string }>; createdAt: string; deletedAt?: string | null; canDelete?: boolean }
export interface MilestoneView {
  id: string; projectId: string; stage: string; stageLabel: string; title: string; kind: string; status: MilestoneStatus;
  plannedAt: string | null; occurredAt: string | null; ownerId: string | null; ownerName: string | null; conclusion: string;
  sortOrder: number; version: number; createdBy: string; createdAt: string; updatedAt: string;
  attachments: AttachmentView[]; comments: CommentView[];
  projectProgress?: { status: string; dealStage: string; dealStageLabel: string; version: number };
}
type MilestoneStatus = "planned" | "in_progress" | "done" | "blocked" | "cancelled";
type StageVisualState = "done" | "current" | "upcoming";

const STATUS_LABEL: Record<MilestoneStatus, string> = { planned: "计划中", in_progress: "进行中", done: "已完成", blocked: "受阻", cancelled: "已取消" };
const STATUS_TAG: Record<MilestoneStatus, "gray" | "blue" | "green" | "red"> = { planned: "gray", in_progress: "blue", done: "green", blocked: "red", cancelled: "gray" };
const STATUS_ORDER: MilestoneStatus[] = ["planned", "in_progress", "done", "blocked", "cancelled"];
const PROJECT_STAGE: Record<string, string> = { new: "contact", researching: "initiation", contacting: "contact", dd: "dd", ic: "ic", invested: "closing", exited: "post" };

const idem = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export function ProjectTimeline({ projectId, projectVersion = 1, projectStatus = "new", projectStage, stages, team, initialMilestones, recentScopeKey }: { projectId: string; projectVersion?: number; projectStatus?: string; projectStage?: string; stages: StageDef[]; team: TeamMemberLite[]; initialMilestones: MilestoneView[]; recentScopeKey?: string }) {
  const router = useRouter();
  const [milestones, setMilestones] = useState(initialMilestones);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; title: string; subtitle: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [addingStage, setAddingStage] = useState<string | null>(null);
  const [documentProjectVersion, setDocumentProjectVersion] = useState(projectVersion);
  const orderedTeam = recentFirstMembers(team, recentScopeKey);
  const fallbackStageId = PROJECT_STAGE[projectStatus] ?? projectStatus;
  const persistedStageId = dealStageIdForValue(projectStage) ?? deriveCurrentDealStage(initialMilestones, fallbackStageId);
  const [currentStageOverride, setCurrentStageOverride] = useState<string | null>(null);
  const currentStageId = currentStageOverride ?? persistedStageId;

  const orderedStages = useMemo(() => {
    const known = stages.map((stage) => stage.id);
    const custom = Array.from(new Set(milestones.map((item) => item.stage))).filter((id) => !known.includes(id));
    return [...known, ...custom].map((stageId) => ({
      def: stages.find((stage) => stage.id === stageId) ?? { id: stageId, label: stageId, suggestedMilestones: [] },
      items: milestones.filter((item) => item.stage === stageId).sort((left, right) => left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt)),
    }));
  }, [milestones, stages]);

  const locatedStageIndex = orderedStages.findIndex(({ def }) => def.id === currentStageId);
  const currentStageIndex = projectStatus === "pass" ? -1 : Math.max(0, locatedStageIndex);
  const replaceMilestone = (next: MilestoneView) => setMilestones((current) => current.map((item) => (item.id === next.id ? next : item)));

  async function createMilestone(stage: string, input: { title: string; ownerId: string | null; plannedAt: string | null }) {
    setBusy(true); setNotice(null);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/milestones`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idem() }, body: JSON.stringify({ stage, title: input.title, ownerId: input.ownerId, plannedAt: input.plannedAt }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "创建节点失败。");
      const created = payload.data as MilestoneView;
      setMilestones((current) => [...current, created]);
      const syncedStage = created.projectProgress?.dealStage;
      if (syncedStage) setCurrentStageOverride(syncedStage);
      if (recentScopeKey && input.ownerId) recordRecentActivityParticipants(recentScopeKey, [input.ownerId]);
      setAddingStage(null);
      setNotice({ kind: "success", title: "已新增推进节点", subtitle: `${payload.data.stageLabel} · ${payload.data.title}` });
      router.refresh();
    } catch (error) { setNotice({ kind: "error", title: "操作失败", subtitle: error instanceof Error ? error.message : "请重试。" }); }
    finally { setBusy(false); }
  }

  async function patchMilestone(milestone: MilestoneView, patch: Record<string, unknown>) {
    setBusy(true); setNotice(null);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/milestones/${milestone.id}`, { method: "PATCH", headers: { "content-type": "application/json", "idempotency-key": idem() }, body: JSON.stringify({ expectedVersion: milestone.version, ...patch }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "更新节点失败。");
      const updated = payload.data as MilestoneView;
      replaceMilestone(updated);
      const syncedStage = updated.projectProgress?.dealStage;
      if (syncedStage) setCurrentStageOverride(syncedStage);
      if (recentScopeKey && typeof patch.ownerId === "string" && patch.ownerId) recordRecentActivityParticipants(recentScopeKey, [patch.ownerId]);
      router.refresh();
    } catch (error) { setNotice({ kind: "error", title: "更新失败", subtitle: error instanceof Error ? error.message : "请刷新后重试。" }); }
    finally { setBusy(false); }
  }

  async function addComment(milestone: MilestoneView, body: string) {
    setBusy(true); setNotice(null);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/comments`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idem() }, body: JSON.stringify({ body, milestoneId: milestone.id }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "批注失败。");
      replaceMilestone({ ...milestone, comments: [...milestone.comments, payload.data as CommentView] });
      const mentioned = (payload.data.mentions as Array<{ name: string }>).map((item) => item.name);
      setNotice({ kind: "success", title: "批注已保存", subtitle: mentioned.length ? `已提醒：${mentioned.join("、")}` : "批注已进入项目时间线" });
    } catch (error) { setNotice({ kind: "error", title: "批注失败", subtitle: error instanceof Error ? error.message : "请重试。" }); }
    finally { setBusy(false); }
  }

  async function addAttachment(milestone: MilestoneView, input: { title: string; uri: string }) {
    setBusy(true); setNotice(null);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/milestones/${milestone.id}/attachments`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idem() }, body: JSON.stringify({ title: input.title, uri: input.uri }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "添加附件失败。");
      replaceMilestone({ ...milestone, attachments: [...milestone.attachments, payload.data as AttachmentView] });
    } catch (error) { setNotice({ kind: "error", title: "添加附件失败", subtitle: error instanceof Error ? error.message : "请重试。" }); }
    finally { setBusy(false); }
  }

  async function uploadAttachment(milestone: MilestoneView, input: { title: string; file: File }) {
    setBusy(true); setNotice(null);
    try {
      const form = new FormData();
      form.set("expectedVersion", String(documentProjectVersion));
      form.set("title", input.title);
      form.set("file", input.file);
      const response = await fetch(`/api/v1/projects/${projectId}/milestones/${milestone.id}/attachments`, { method: "POST", headers: { "idempotency-key": idem() }, body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "上传附件失败。");
      const created = payload.data as AttachmentView & { projectVersion?: number };
      replaceMilestone({ ...milestone, attachments: [...milestone.attachments, created] });
      if (created.projectVersion) setDocumentProjectVersion(created.projectVersion);
      setNotice({ kind: "success", title: "资料已上传并附加", subtitle: created.title });
      router.refresh();
    } catch (error) { setNotice({ kind: "error", title: "上传附件失败", subtitle: error instanceof Error ? error.message : "请重试。" }); }
    finally { setBusy(false); }
  }

  return (
    <section className="grid gap-5" aria-labelledby="deal-flow-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><h2 id="deal-flow-title" className="text-xl font-semibold tracking-tight">项目推进流程</h2><p className="mt-1 text-sm text-muted-foreground">上方查看阶段，下方在对应节点沉淀资料、结论、审批和批注。</p></div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground" aria-label="流程状态图例"><Legend tone="bg-sky-600" label="已完成" /><Legend tone="bg-primary shadow-[0_0_0_4px_rgba(159,45,53,0.16)]" label="当前阶段" /><Legend tone="bg-muted-foreground/35" label="未开始" /></div>
      </div>
      {notice && <InlineNotification kind={notice.kind} lowContrast title={notice.title} subtitle={notice.subtitle} onCloseButtonClick={() => setNotice(null)} />}

      {projectStatus === "pass" && <div className="rounded-lg border border-border bg-muted/45 px-4 py-3 text-sm"><strong>项目已结束跟进</strong><span className="ml-2 text-muted-foreground">流程节点保留为历史记录，不计作已完成投资流程。</span></div>}

      <div className="overflow-x-auto rounded-xl border border-border bg-card p-4 pb-5 sm:p-5" aria-label="项目阶段及各阶段推进记录">
        <div style={{ minWidth: `${Math.max(orderedStages.length, 1) * 16}rem` }}>
          <ol aria-label="VC 项目流程" className="grid list-none p-0" style={{ gridTemplateColumns: `repeat(${orderedStages.length}, minmax(16rem, 1fr))` }}>
            {orderedStages.map(({ def, items }, index) => {
              const visualState: StageVisualState = index < currentStageIndex ? "done" : index === currentStageIndex ? "current" : "upcoming";
              return <StageNode key={def.id} label={def.label} index={index} total={orderedStages.length} state={visualState} completed={items.filter((item) => item.status === "done").length} count={items.length} />;
            })}
          </ol>

          <div className="mt-5 grid gap-3" style={{ gridTemplateColumns: `repeat(${orderedStages.length}, minmax(16rem, 1fr))` }}>
          {orderedStages.map(({ def, items }, index) => {
            const visualState: StageVisualState = index < currentStageIndex ? "done" : index === currentStageIndex ? "current" : "upcoming";
            return (
              <section key={def.id} className={`flex min-h-60 flex-col rounded-xl border p-3.5 ${visualState === "current" ? "border-primary/35 bg-primary/[0.035]" : "border-border bg-card"}`} aria-labelledby={`stage-${def.id}`}>
                <header className="flex items-center justify-between gap-3 border-b border-border pb-3">
                  <div><h3 id={`stage-${def.id}`} className="font-semibold">{def.label}</h3><p className="mt-0.5 text-xs text-muted-foreground">{stageStateLabel(visualState)}</p></div>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">{items.filter((item) => item.status === "done").length}/{items.length}</span>
                </header>
                <div className="grid gap-3 py-3">
                  {items.length > 0 ? items.map((milestone) => (
                    <MilestoneCard key={milestone.id} milestone={milestone} team={orderedTeam} busy={busy}
                      onStatus={(status) => patchMilestone(milestone, { status })}
                      onOwner={(ownerId) => patchMilestone(milestone, { ownerId: ownerId || null })}
                      onConclusion={(conclusion) => patchMilestone(milestone, { conclusion })}
                      onComment={(body) => addComment(milestone, body)}
                      onDeleteComment={comment => setMilestones(current => current.map(item => item.id === milestone.id ? { ...item, comments: item.comments.map(existing => existing.id === comment.id ? comment : existing) } : item))}
                      onBusy={setBusy}
                      onAttachment={(input) => addAttachment(milestone, input)}
                      onFileAttachment={(input) => uploadAttachment(milestone, input)}
                    />
                  )) : <SuggestedMilestones items={def.suggestedMilestones} />}
                </div>
                <div className="mt-auto">
                  {addingStage === def.id ? <AddMilestoneForm stage={def} team={orderedTeam} busy={busy} onCancel={() => setAddingStage(null)} onSubmit={(input) => createMilestone(def.id, input)} /> : <Button kind="ghost" size="sm" renderIcon={Plus} disabled={busy} onClick={() => setAddingStage(def.id)}>添加节点</Button>}
                </div>
              </section>
            );
          })}
          </div>
        </div>
      </div>
    </section>
  );
}

function StageNode({ label, index, total, state, completed, count }: { label: string; index: number; total: number; state: StageVisualState; completed: number; count: number }) {
  const tone = state === "done" ? "border-sky-600 bg-sky-600 text-white" : state === "current" ? "border-primary bg-primary text-white shadow-[0_0_0_5px_rgba(159,45,53,0.16),0_0_18px_rgba(159,45,53,0.28)]" : "border-muted-foreground/35 bg-card text-muted-foreground";
  return (
    <li aria-current={state === "current" ? "step" : undefined} className="relative flex flex-col items-center px-2 text-center">
      {index > 0 && <span className={`absolute left-0 top-[15px] h-0.5 w-1/2 ${state === "upcoming" ? "bg-border" : "bg-sky-600"}`} aria-hidden="true" />}
      {index < total - 1 && <span className={`absolute right-0 top-[15px] h-0.5 w-1/2 ${state === "done" ? "bg-sky-600" : "bg-border"}`} aria-hidden="true" />}
      <span className={`relative z-10 grid size-8 place-items-center rounded-full border-2 ${tone}`} aria-hidden="true">{state === "done" ? <Check className="size-4" /> : <span className="size-2 rounded-full bg-current" />}</span>
      <strong className={`mt-2 text-sm ${state === "current" ? "text-primary" : "text-foreground"}`}>{label}</strong>
      <span className="mt-1 text-[11px] text-muted-foreground">{stageStateLabel(state)}{count > 0 ? ` · ${completed}/${count}` : ""}</span>
    </li>
  );
}

function SuggestedMilestones({ items }: { items: string[] }) {
  return <div className="grid gap-2">{items.slice(0, 4).map((item) => <div key={item} className="flex min-h-11 items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground"><Circle className="size-3 shrink-0" aria-hidden="true" />{item}</div>)}</div>;
}

function MilestoneCard({ milestone, team, busy, onStatus, onOwner, onConclusion, onComment, onAttachment, onFileAttachment, onDeleteComment, onBusy }: {
  milestone: MilestoneView; team: TeamMemberLite[]; busy: boolean;
  onStatus: (status: MilestoneStatus) => void; onOwner: (ownerId: string) => void; onConclusion: (conclusion: string) => void;
  onDeleteComment: (comment: CommentView) => void; onBusy: (busy: boolean) => void;
  onComment: (body: string) => void; onAttachment: (input: { title: string; uri: string }) => void; onFileAttachment: (input: { title: string; file: File }) => void;
}) {
  const [conclusion, setConclusion] = useState(milestone.conclusion);
  const [comment, setComment] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [attachTitle, setAttachTitle] = useState("");
  const [attachUri, setAttachUri] = useState("");
  const [attachFile, setAttachFile] = useState<File | null>(null);
  const [ownerQuery, setOwnerQuery] = useState("");
  const visibleTeam = team.filter(member => `${member.name} ${member.departmentName ?? ""}`.toLocaleLowerCase("zh-CN").includes(ownerQuery.trim().toLocaleLowerCase("zh-CN")));
  const marker = milestone.status === "done" ? <CheckCircle2 className="size-4 text-sky-700" aria-hidden="true" /> : milestone.status === "blocked" ? <CircleAlert className="size-4 text-red-700" aria-hidden="true" /> : <Clock3 className="size-4 text-primary" aria-hidden="true" />;

  return (
    <article aria-labelledby={`milestone-${milestone.id}`} className={`rounded-lg border bg-card p-3 ${milestone.status === "in_progress" ? "border-primary/35" : "border-border"}`}>
      <header className="flex items-start justify-between gap-2"><div className="flex min-w-0 items-center gap-2">{marker}<h4 id={`milestone-${milestone.id}`} className="text-sm font-semibold">{milestone.title}</h4></div><Tag size="sm" type={STATUS_TAG[milestone.status]}>{STATUS_LABEL[milestone.status]}</Tag></header>
      <div className="mt-2 grid gap-1 text-[11px] text-muted-foreground">
        {(milestone.ownerName || milestone.ownerId) && <span className="flex items-center gap-1.5"><UserRound className="size-3" aria-hidden="true" />{milestone.ownerName ?? milestone.ownerId}</span>}
        {(milestone.plannedAt || milestone.occurredAt) && <span className="flex items-center gap-1.5"><Clock3 className="size-3" aria-hidden="true" />{milestone.occurredAt ? `完成 ${formatDate(milestone.occurredAt)}` : `计划 ${formatDate(milestone.plannedAt!)}`}</span>}
      </div>
      {milestone.conclusion && <p className="mt-3 rounded-md bg-muted/55 px-2.5 py-2 text-xs leading-5">{milestone.conclusion}</p>}
      {(milestone.attachments.length > 0 || milestone.comments.length > 0) && <div className="mt-3 grid gap-2 border-t border-border pt-3">
        {milestone.attachments.map((item) => <div key={item.id} className="flex items-center gap-2 text-xs"><FileText className="size-3.5 shrink-0 text-sky-700" aria-hidden="true" />{item.uri ? <a href={item.uri} target="_blank" rel="noreferrer" className="truncate font-medium text-primary hover:underline">{item.title}</a> : item.documentId ? <a href={`/api/v1/projects/${encodeURIComponent(milestone.projectId)}/documents/${encodeURIComponent(item.documentId)}/content?download=1`} aria-label={`下载推进节点资料：${item.title}`} className="truncate font-medium text-primary hover:underline">{item.title}</a> : <span className="truncate font-medium">{item.title}</span>}</div>)}
        {milestone.comments.map((item) => <div key={item.id} className="flex min-w-0 gap-2 border-b border-border/60 py-2 last:border-0"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary" aria-hidden="true">{item.authorName.slice(0, 1)}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"><strong>{item.authorName}</strong><time className="text-[11px] text-muted-foreground" dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></div><p className={`mt-1 whitespace-pre-wrap break-words text-[15px] leading-6 ${item.deletedAt ? "italic text-muted-foreground" : ""}`}>{item.deletedAt ? "该评论已删除" : renderBody(item.body)}</p>{item.canDelete && !item.deletedAt && <CommentDeleteButton<CommentView> url={`/api/v1/projects/${encodeURIComponent(item.projectId)}/comments/${encodeURIComponent(item.id)}`} disabled={busy} onBusy={onBusy} onDeleted={onDeleteComment} />}</div></div>)}
      </div>}
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className="mt-3 flex min-h-11 w-full cursor-pointer items-center justify-between rounded-md px-2 text-xs font-medium text-primary transition-colors hover:bg-primary/[0.05]">更新节点<ChevronDown className={`size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" /></button>

      {expanded && <div className="mt-2 grid gap-3 border-t border-border pt-3">
        <div className="grid grid-cols-2 gap-2">
          <Select id={`status-${milestone.id}`} labelText="状态" size="sm" value={milestone.status} disabled={busy} onChange={(event) => onStatus(event.target.value as MilestoneStatus)}>{STATUS_ORDER.map((status) => <SelectItem key={status} value={status} text={STATUS_LABEL[status]} />)}</Select>
          <div className="grid gap-1"><label htmlFor={`owner-search-${milestone.id}`} className="text-sm font-medium">搜索负责人</label><input id={`owner-search-${milestone.id}`} type="search" aria-label="搜索节点负责人" placeholder="姓名或部门" value={ownerQuery} disabled={busy} onChange={event => setOwnerQuery(event.target.value)} className="h-9 rounded-lg border bg-white px-3 text-sm" /><Select id={`owner-${milestone.id}`} labelText="负责人" size="sm" value={milestone.ownerId ?? ""} disabled={busy} onChange={(event) => onOwner(event.target.value)}><SelectItem value="" text="未指派" />{visibleTeam.map((member) => <SelectItem key={member.id} value={member.id} text={member.name} />)}</Select></div>
        </div>
        <TextArea id={`conclusion-${milestone.id}`} labelText="节点结论" rows={2} value={conclusion} disabled={busy} placeholder="记录本节点结论" onChange={(event) => setConclusion(event.target.value)} />
        {conclusion !== milestone.conclusion && <Button size="sm" kind="tertiary" disabled={busy} onClick={() => onConclusion(conclusion)}>保存结论</Button>}
        <div>
          <Button kind="ghost" size="sm" renderIcon={Paperclip} disabled={busy} onClick={() => setAttaching((value) => !value)}>添加资料</Button>
          {attaching && <div className="mt-2 grid gap-3 rounded-lg border border-border bg-muted/20 p-3">
            <label htmlFor={`att-file-${milestone.id}`} className="grid gap-1 text-sm font-medium">上传本地文件<input id={`att-file-${milestone.id}`} type="file" accept=".pdf,.docx,.txt,.md,.markdown" disabled={busy} onChange={(event) => { const file = event.target.files?.[0] ?? null; setAttachFile(file); if (file && !attachTitle.trim()) setAttachTitle(file.name); }} className="block min-h-11 w-full rounded-lg border bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm" /></label>
            <TextInput id={`att-title-${milestone.id}`} labelText="资料名称" size="sm" placeholder="例如：NDA 定稿" value={attachTitle} onChange={(event) => setAttachTitle(event.target.value)} />
            <Button size="sm" disabled={busy || !attachFile || !attachTitle.trim()} onClick={() => { if (!attachFile) return; onFileAttachment({ title: attachTitle.trim(), file: attachFile }); setAttachTitle(""); setAttachUri(""); setAttachFile(null); setAttaching(false); }}>上传并附加</Button>
            <div className="border-t border-border pt-3"><TextInput id={`att-uri-${milestone.id}`} labelText="或添加资料链接" size="sm" placeholder="https://" value={attachUri} onChange={(event) => setAttachUri(event.target.value)} /><Button className="mt-2" size="sm" kind="tertiary" disabled={busy || !attachTitle.trim() || !attachUri.trim()} onClick={() => { onAttachment({ title: attachTitle.trim(), uri: attachUri.trim() }); setAttachTitle(""); setAttachUri(""); setAttachFile(null); setAttaching(false); }}>保存链接</Button></div>
            <p className="text-xs text-muted-foreground">支持 PDF、DOCX、TXT、Markdown，单文件不超过 20 MB。</p>
          </div>}
        </div>
        <div><TextArea id={`comment-${milestone.id}`} labelText="批注" rows={2} value={comment} disabled={busy} placeholder="写下批注，输入 @成员名 提醒对方" onChange={(event) => setComment(event.target.value)} /><div className="mt-2 flex flex-wrap gap-1">{visibleTeam.map((member) => <button key={member.id} type="button" className="min-h-11 cursor-pointer rounded-md border px-2 text-xs text-muted-foreground hover:bg-muted" onClick={() => setComment((value) => `${value}${value && !value.endsWith(" ") ? " " : ""}@${member.name} `)}>@{member.name}</button>)}</div><Button className="mt-2" size="sm" disabled={busy || comment.trim().length === 0} onClick={() => { onComment(comment.trim()); setComment(""); }}>发送批注</Button></div>
      </div>}
    </article>
  );
}

function AddMilestoneForm({ stage, team, busy, onCancel, onSubmit }: { stage: StageDef; team: TeamMemberLite[]; busy: boolean; onCancel: () => void; onSubmit: (input: { title: string; ownerId: string | null; plannedAt: string | null }) => void }) {
  const [title, setTitle] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [plannedAt, setPlannedAt] = useState("");
  const [ownerQuery, setOwnerQuery] = useState("");
  const visibleTeam = team.filter(member => `${member.name} ${member.departmentName ?? ""}`.toLocaleLowerCase("zh-CN").includes(ownerQuery.trim().toLocaleLowerCase("zh-CN")));
  return <div className="grid gap-2 rounded-lg border border-primary/20 bg-card p-3">{stage.suggestedMilestones.length > 0 && <div className="flex flex-wrap gap-1">{stage.suggestedMilestones.map((name) => <button key={name} type="button" className="min-h-11 cursor-pointer rounded-md bg-muted px-2 text-xs hover:bg-secondary" onClick={() => setTitle(name)}>{name}</button>)}</div>}<TextInput id={`new-title-${stage.id}`} labelText="节点名称" size="sm" placeholder="例如：NDA 签署" value={title} onChange={(event) => setTitle(event.target.value)} /><label htmlFor={`new-owner-search-${stage.id}`} className="text-sm font-medium">搜索负责人<input id={`new-owner-search-${stage.id}`} type="search" aria-label="搜索新节点负责人" placeholder="姓名或部门" value={ownerQuery} onChange={event => setOwnerQuery(event.target.value)} className="mt-1 h-9 w-full rounded-lg border bg-white px-3 text-sm font-normal" /></label><Select id={`new-owner-${stage.id}`} labelText="负责人" size="sm" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}><SelectItem value="" text="未指派" />{visibleTeam.map((member) => <SelectItem key={member.id} value={member.id} text={member.name} />)}</Select><TextInput id={`new-date-${stage.id}`} labelText="计划日期" size="sm" type="date" value={plannedAt} onChange={(event) => setPlannedAt(event.target.value)} /><div className="flex justify-end gap-2"><Button size="sm" kind="ghost" onClick={onCancel}>取消</Button><Button size="sm" disabled={busy || title.trim().length === 0} onClick={() => onSubmit({ title: title.trim(), ownerId: ownerId || null, plannedAt: plannedAt || null })}>添加</Button></div></div>;
}

function Legend({ tone, label }: { tone: string; label: string }) { return <span className="inline-flex items-center gap-1.5"><i className={`size-2.5 rounded-full ${tone}`} aria-hidden="true" />{label}</span>; }
function stageStateLabel(state: StageVisualState) { return state === "done" ? "已完成" : state === "current" ? "当前阶段" : "未开始"; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", timeZone: "Asia/Shanghai" }).format(date); }
function renderBody(body: string) { return body.split(/(@[^\s@]+)/g).map((part, index) => part.startsWith("@") ? <mark key={index} className="rounded bg-primary/10 px-0.5 text-primary">{part}</mark> : <span key={index}>{part}</span>); }
