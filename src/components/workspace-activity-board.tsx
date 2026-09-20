"use client";

import { Suspense, useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Archive, CalendarDays, CheckCircle2, CheckSquare2, ChevronDown, CircleAlert, CircleX, Eye, Plus, Stamp, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ActivityCalendar } from "@/components/activity-calendar";
import { ActivityForm, type ActivityMember } from "@/components/activity-form";
import { ApprovalDocuments } from "@/components/approval-documents";
import { ActivityDiscussion } from "@/components/activity-discussion";
import type { WorkspaceActivity } from "@/workbench/activity-contracts";

type Member = ActivityMember;
type ProjectOption = { id: string; name: string };
const kinds = { task: "待办", meeting: "会议", trip: "行程", approval: "资料审批" };
const actions: Record<string, string> = { pending: "待回应", accepted: "已接受", declined: "已拒绝", change_requested: "建议调整", done: "已完成", approved: "已批准", returned: "已退回", created: "发起", document_uploaded: "上传资料", document_linked: "引用项目资料", edited: "编辑事项", withdrawn: "撤回申请", completed: "完成任务", archived: "自动归档", approval_withdrawn: "撤回申请", approval_completed: "完成任务", approval_archived: "自动归档", task_archived: "归档待办", task_deleted: "删除待办" };
const fieldClass = "mt-1 block min-h-11 w-full rounded-md border border-input bg-white px-3 py-2 text-sm";
type HistoryScope = "current" | "archived" | "withdrawn";
const statusLabels = { active: "进行中", completed: "任务已完成", archived: "已归档", withdrawn: "已撤回" };
const activityStatus = (item: WorkspaceActivity) => item.status ?? "active";
const matchesScope = (item: WorkspaceActivity, scope: HistoryScope) => scope === "current" ? ["active", "completed"].includes(activityStatus(item)) : activityStatus(item) === scope;
const shanghaiDay = (value: string | Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
function approvalVisualStatus(item: WorkspaceActivity, actorId: string) {
  const status = activityStatus(item);
  if (status === "archived") return { label: "已归档", Icon: Archive, className: "border-slate-300 bg-slate-50 text-slate-700" };
  if (status === "completed") return { label: "已完成待归档", Icon: CheckCircle2, className: "border-emerald-300 bg-emerald-50 text-emerald-800" };
  if (status === "withdrawn") return { label: "已撤回", Icon: Undo2, className: "border-slate-300 bg-slate-50 text-slate-700" };
  const mine = item.responses.find(response => response.memberId === actorId);
  if (item.createdBy === actorId) {
    const ready = item.responses.length > 0 && item.responses.every(response => response.action === "approved");
    return ready
      ? { label: "待完成", Icon: CheckCircle2, className: "border-emerald-300 bg-emerald-50 text-emerald-800" }
      : { label: "处理中", Icon: Stamp, className: "border-blue-300 bg-blue-50 text-blue-800" };
  }
  if (mine?.action === "approved") return { label: "已批准", Icon: CheckCircle2, className: "border-emerald-300 bg-emerald-50 text-emerald-800" };
  if (mine?.action === "returned") return { label: "已退回", Icon: CircleX, className: "border-red-300 bg-red-50 text-red-800" };
  if (mine?.action === "pending" && !mine.viewedAt && shanghaiDay(mine.assignedAt ?? item.createdAt) === shanghaiDay(new Date())) return { label: "当日未查看", Icon: Eye, className: "border-amber-300 bg-amber-50 text-amber-900" };
  return { label: "未处理", Icon: CircleAlert, className: "border-blue-300 bg-blue-50 text-blue-800" };
}
function hasDraft(root: HTMLElement | null) {
  if (!root) return false;
  if (root.querySelector("form:focus-within,fieldset:disabled,[aria-busy=true],button[aria-label^='移除 ']")) return true;
  return [...root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea,input:not([type]),input[type=text],input[type=file]")].some(input => input.value.trim().length > 0);
}

type BoardProps = {
  initial: WorkspaceActivity[]; members: Member[]; projectOptions: ProjectOption[]; currentUserId: string; recentScopeKey?: string; compact?: boolean; onlyKind?: "approval"; mode?: "all" | "tasks" | "calendar";
};
export function WorkspaceActivityBoard(props: BoardProps) {
  return <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">正在加载事项…</p>}><ActivityBoard {...props} /></Suspense>;
}
function ActivityBoard({ initial, members, projectOptions, currentUserId, recentScopeKey = currentUserId, compact = false, onlyKind, mode = "all" }: BoardProps) {
  const [items, setItems] = useState(initial);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<WorkspaceActivity | null>(null);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<HistoryScope>("current");
  const board = useRef<HTMLElement>(null);
  const refreshing = useRef(0);
  const refreshRevision = useRef(0);
  const router = useRouter();
  const linkedActivity = useSearchParams()?.get("activity");
  const saving = useRef(false);
  const viewing = useRef(new Set<string>());
  const memberName = (id: string) => id === "system" ? "系统" : members.find((member) => member.id === id)?.name ?? id;
  const projectName = (id: string) => projectOptions.find((project) => project.id === id)?.name ?? "关联项目";
  const relevant = items.filter(item => !item.deletedAt && (!onlyKind || item.kind === onlyKind) && (matchesScope(item, scope) || item.id === linkedActivity)).toSorted((a, b) => Number(activityStatus(a) === "completed") - Number(activityStatus(b) === "completed") || (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  const groups = onlyKind ? [{ label: "待我审批 / 我发起的审批", icon: Stamp, rows: relevant }] : mode === "calendar" ? [] : [
    { label: "我的待办与审批", icon: CheckSquare2, rows: relevant.filter((item) => ["task", "approval"].includes(item.kind)) },
    ...(mode === "tasks" ? [] : [{ label: compact ? "今日日程" : "会议与行程", icon: CalendarDays, rows: relevant.filter((item) => ["meeting", "trip"].includes(item.kind) && (!compact || item.dueAt && new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(item.dueAt)) === today)) }]),
  ];

  function updateItem(item: WorkspaceActivity) {
    setItems((previous) => [item, ...previous.filter((existing) => existing.id !== item.id)].sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999")));
    router.refresh();
  }

  const reload = useCallback(async (automatic = false, signal?: AbortSignal, selectedScope = scope) => {
    if ((automatic && refreshing.current) || saving.current) return;
    const revision = ++refreshRevision.current;
    refreshing.current = revision;
    if (!automatic) { setBusy(true); setError(""); setFeedback(""); }
    try {
      const response = await fetch(`/api/v1/activity?status=${selectedScope}`, { signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "刷新失败，请稍后重试。");
      if (signal?.aborted || revision !== refreshRevision.current || automatic && hasDraft(board.current)) return;
      let rows = payload.data as WorkspaceActivity[];
      if (linkedActivity && !rows.some(item => item.id === linkedActivity)) {
        const linkedResponse = await fetch(`/api/v1/activity?activity=${encodeURIComponent(linkedActivity)}`, { signal });
        const linkedPayload = await linkedResponse.json();
        if (!linkedResponse.ok) throw new Error(linkedPayload.error?.message ?? "无法读取指定事项。");
        rows = [...rows, ...linkedPayload.data];
      }
      if (signal?.aborted || revision !== refreshRevision.current || automatic && hasDraft(board.current)) return;
      setItems(rows);
      if (!automatic) setFeedback("已刷新事项及审批资料。");
    } catch (failure) { if (!signal?.aborted) setError(failure instanceof Error ? failure.message : "刷新失败，请检查网络。"); }
    finally { if (refreshing.current === revision) refreshing.current = 0; if (!automatic && revision === refreshRevision.current) setBusy(false); }
  }, [scope, linkedActivity]);

  useEffect(() => {
    if (!linkedActivity || initial.some(item => item.id === linkedActivity)) return;
    const controller = new AbortController();
    const revision = refreshRevision.current;
    void (async () => {
      try {
        const response = await fetch(`/api/v1/activity?activity=${encodeURIComponent(linkedActivity)}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message ?? "无法读取指定事项。");
        if (!controller.signal.aborted && revision === refreshRevision.current) setItems(previous => [...previous.filter(item => !payload.data.some((row: WorkspaceActivity) => row.id === item.id)), ...payload.data]);
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "无法读取指定事项。"); }
    })();
    return () => controller.abort();
  }, [linkedActivity, initial]);

  useEffect(() => {
    if (creating || editing || busy) return;
    const controller = new AbortController();
    const refresh = () => { if (document.visibilityState !== "hidden" && !hasDraft(board.current)) void reload(true, controller.signal); };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);document.addEventListener("visibilitychange", refresh);
    return () => { controller.abort();window.clearInterval(timer);window.removeEventListener("focus", refresh);document.removeEventListener("visibilitychange", refresh); };
  }, [creating, editing, busy, reload]);

  async function save(url: string, method: string, body: unknown, key?: string, files: File[] = []) {
    if (saving.current) return false;
    saving.current = true;
    refreshRevision.current += 1;
    setBusy(true); setError(""); setFeedback("");
    try {
      const form = new FormData();
      form.set("payload", JSON.stringify(body)); files.forEach(file => form.append("files", file));
      const response = await fetch(url, { method, headers: { ...(!files.length ? { "content-type": "application/json" } : {}), ...(key ? { "idempotency-key": key } : {}) }, body: files.length ? form : JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "保存失败，请稍后重试。");
      const item = payload.data as WorkspaceActivity;
      updateItem(item);
      setFeedback("已保存到工作空间，相关人员可查看最新状态。");
      return true;
    } catch (failure) { setError(failure instanceof Error ? failure.message : "网络连接失败。"); return false; }
    finally { saving.current = false; setBusy(false); }
  }

  async function markViewed(item: WorkspaceActivity) {
    const mine = item.responses.find(response => response.memberId === currentUserId);
    if (item.kind !== "approval" || item.createdBy === currentUserId || activityStatus(item) !== "active" || !mine || mine.viewedAt || viewing.current.has(item.id)) return;
    viewing.current.add(item.id);
    try {
      const response = await fetch(`/api/v1/activity/${item.id}/view`, { method: "POST" });
      const payload = await response.json();
      if (response.ok) updateItem(payload.data as WorkspaceActivity);
    } catch { /* Keep the explicit unviewed label until a later successful view update. */ }
    finally { viewing.current.delete(item.id); }
  }

  return <section ref={board} className="grid gap-4" aria-label="工作空间事项">
    <div className="flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">个人事项 · 服务器同步</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || creating || Boolean(editing)} onClick={() => void reload()}>刷新事项</Button><Button variant="outline" disabled={busy} onClick={() => { setEditing(null); setCreating(value => !value); }}><Plus aria-hidden="true" />新建事项</Button></div></div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="事项状态筛选">{([{ id: "current", label: "当前" }, { id: "archived", label: "已归档" }, { id: "withdrawn", label: "已撤回" }] as const).map(filter => <Button key={filter.id} variant={scope === filter.id ? "default" : "outline"} size="sm" aria-pressed={scope === filter.id} disabled={busy || creating || Boolean(editing)} onClick={() => { setScope(filter.id); void reload(false, undefined, filter.id); }}>{filter.label}</Button>)}</div>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {feedback && <p role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{feedback}</p>}
    {creating && <ActivityForm scopeKey={recentScopeKey} currentUserId={currentUserId} members={members} projectOptions={projectOptions} onlyKind={onlyKind} busy={busy} onCancel={() => setCreating(false)} onSave={async (body, key, files) => { const success = await save("/api/v1/activity", "POST", body, key, files); if (success) setCreating(false); return success; }} />}
    {editing && <ActivityForm scopeKey={recentScopeKey} currentUserId={currentUserId} key={editing.id} initial={editing} members={members} projectOptions={projectOptions} busy={busy} onCancel={() => setEditing(null)} onSave={async (body, key) => { const success = await save(`/api/v1/activity/${editing.id}/edit`, "PATCH", body, key); if (success) setEditing(null); return success; }} />}
    {!onlyKind && mode !== "tasks" && <ActivityCalendar items={relevant} currentUserId={currentUserId} onEdit={item => { setCreating(false); setEditing(item); }} />}
    {groups.length > 0 && <div className={`grid gap-5 ${onlyKind || mode === "tasks" ? "" : "xl:grid-cols-2"}`}>{groups.map(({ label, icon: Icon, rows }) => <section key={label} className="min-w-0">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><Icon className="size-5 text-primary" aria-hidden="true" />{label}<span className="ml-auto text-sm font-normal text-muted-foreground">{rows.length} 项</span></h2>
      {rows.length === 0 ? <div className="rounded-lg border border-dashed border-border bg-white p-6"><p className="text-sm font-medium">暂无相关事项</p><p className="mt-1 text-sm text-muted-foreground">新建任务、会议邀请或资料审批后，会在这里同步。</p></div> : <div className="grid gap-3">{rows.filter((item, index) => index < (compact ? 4 : 100) || item.id === linkedActivity).map((item) => <ActivityCard key={`${item.id}:${item.id === linkedActivity}`} defaultExpanded={item.id === linkedActivity} item={item} actorId={currentUserId} members={members} recentScopeKey={recentScopeKey} memberName={memberName} projectName={projectName} projectOptions={projectOptions} busy={busy} onBusyChange={setBusy} onUpdated={updateItem} onView={() => markViewed(item)} onEdit={() => { setCreating(false); setEditing(item); }} onRespond={(action, note) => save(`/api/v1/activity/${item.id}`, "PATCH", { action, note, expectedVersion: item.version })} onLifecycle={(action, archiveNow = false) => save(`/api/v1/activity/${item.id}/lifecycle`, "POST", { action, expectedVersion: item.version, ...(action === "complete" && archiveNow ? { archiveNow: true } : {}) })} />)}</div>}
      {compact && rows.length > 4 && <Link className="mt-3 inline-block text-sm text-primary" href="/work">查看全部事项</Link>}
    </section>)}</div>}
  </section>;
}

function ActivityCard({ item, actorId, members, recentScopeKey, memberName, projectName, projectOptions, busy, onBusyChange, onUpdated, onView, onEdit, onRespond, defaultExpanded, onLifecycle }: {
  item: WorkspaceActivity; actorId: string; members: Member[]; recentScopeKey: string; memberName: (id: string) => string; projectName: (id: string) => string; projectOptions: ProjectOption[]; busy: boolean; onBusyChange: (busy: boolean) => void; onUpdated: (item: WorkspaceActivity) => void; onEdit: () => void; onRespond: (action: string, note: string) => Promise<boolean>;
  defaultExpanded: boolean;
  onView: () => void;
  onLifecycle: (action: "withdraw" | "complete" | "archive" | "delete", archiveNow?: boolean) => Promise<boolean>;
}) {
  const [note, setNote] = useState("");
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [archiveNow, setArchiveNow] = useState(false);
  const viewRequested = useRef(false);
  const detailsId = useId();
  const mine = item.responses.find((response) => response.memberId === actorId);
  const active = activityStatus(item) === "active";
  const canRespond = active && mine && !["approved", "returned", "done"].includes(mine.action);
  const lifecycleOwner = active && item.kind === "approval" && item.createdBy === actorId;
  const allApproved = item.responses.length > 0 && item.responses.every(response => response.action === "approved");
  const canWithdraw = lifecycleOwner && !allApproved;
  const canComplete = lifecycleOwner && allApproved;
  const canManageTask = item.kind === "task" && item.createdBy === actorId && !item.deletedAt;
  const canArchiveTask = canManageTask && active;
  const canDeleteTask = canManageTask && ["active", "archived"].includes(activityStatus(item));
  const options = item.kind === "approval" ? ["approved", "returned"] : item.kind === "task" ? ["accepted", "declined", "change_requested", "done"] : ["accepted", "declined", "change_requested"];
  const participants = [...new Set([item.createdBy, ...item.responses.map(response => response.memberId)])].map(id => { const member = members.find(item => item.id === id); return { id, name: memberName(id), departmentId: member?.departmentId, departmentName: member?.departmentName }; });
  const visualStatus = item.kind === "approval" ? approvalVisualStatus(item, actorId) : null;
  useEffect(() => { if (defaultExpanded && !viewRequested.current) { viewRequested.current = true; onView(); } }, [defaultExpanded, onView]);
  return <article data-activity-id={item.id} className="min-w-0 overflow-hidden rounded-lg border border-border bg-white">
    <button type="button" aria-label={`事项概览：${item.title}`} aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(value => { const next = !value; if (next) onView(); return next; })} className="grid w-full min-w-0 cursor-pointer gap-2 p-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:p-4">
      <span className="flex flex-wrap items-center gap-2"><Badge variant="secondary" className="text-sm">{item.kind === "approval" && item.approvalType === "reimbursement" ? "报销" : kinds[item.kind]}</Badge>{visualStatus && <Badge data-testid="approval-visual-status" variant="outline" className={`gap-1 ${visualStatus.className}`}><visualStatus.Icon className="size-3.5" aria-hidden="true" />{visualStatus.label}</Badge>}{!visualStatus && !active && <Badge variant="outline">{statusLabels[activityStatus(item)]}</Badge>}<span className="text-sm text-muted-foreground">{item.dueAt ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(item.dueAt)) : "未设置时间"}</span><ChevronDown className={`ml-auto size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" /></span>
      <span className="break-words text-base font-semibold leading-6">{item.title}</span>
      {item.description && <span className={`whitespace-pre-wrap break-words text-[15px] leading-6 text-muted-foreground ${expanded ? "" : "line-clamp-2"}`}>{item.description}</span>}
      <span className="text-sm text-muted-foreground">发起人：{memberName(item.createdBy)}</span>
      {activityStatus(item) === "completed" && <span className="text-sm text-muted-foreground">次日自动归档{item.archiveAt ? ` · ${new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(item.archiveAt))}` : ""}</span>}
    </button>
    {expanded && <div id={detailsId} role="region" aria-label={`${item.title}详细内容`} className="grid min-w-0 gap-3 border-t p-3 sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">{mine && <span className="text-sm text-primary">{actions[mine.action] ?? mine.action}</span>}<div className="flex flex-wrap gap-2">{active && item.createdBy === actorId && <Button size="sm" variant="outline" disabled={busy} onClick={onEdit}>编辑事项</Button>}{canArchiveTask && <Button size="sm" variant="outline" aria-label={`归档待办：${item.title}`} disabled={busy} onClick={() => void onLifecycle("archive")}><Archive aria-hidden="true" />归档</Button>}{canDeleteTask && <Button size="sm" variant="outline" aria-label={`删除待办：${item.title}`} disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 aria-hidden="true" />删除</Button>}</div></div>
    {(canWithdraw || canComplete) && <div className="flex flex-wrap items-center gap-3">{canWithdraw && <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmWithdraw(true)}>撤回申请</Button>}{canComplete && <><label className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={archiveNow} disabled={busy} onChange={event => setArchiveNow(event.target.checked)} />完成后立即归档</label><Button size="sm" disabled={busy} onClick={() => void onLifecycle("complete", archiveNow)}>任务已完成</Button></>}</div>}
    {canWithdraw && confirmWithdraw && <div role="group" aria-label="撤回确认" className="rounded-md border bg-muted/30 p-3 text-sm"><p>确认撤回这份申请？原件、批注和处理记录仍会保留。</p><div className="mt-2 flex gap-2"><Button size="sm" disabled={busy} onClick={async () => { if (await onLifecycle("withdraw")) setConfirmWithdraw(false); }}>确认撤回</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmWithdraw(false)}>取消撤回</Button></div></div>}
    {canDeleteTask && confirmDelete && <div role="group" aria-label="删除待办确认" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900"><p>删除后将从所有待办列表隐藏，但审计记录仍会保留。</p><div className="mt-2 flex gap-2"><Button size="sm" disabled={busy} onClick={async () => { if (await onLifecycle("delete")) setConfirmDelete(false); }}>确认删除待办</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmDelete(false)}>取消</Button></div></div>}
    {item.updatedAt && item.updatedAt !== item.createdAt && <p className="text-sm text-muted-foreground">最后编辑：{new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(item.updatedAt))}</p>}
    <p className="text-sm leading-5 text-muted-foreground">接收人：{item.responses.map((response) => memberName(response.memberId)).join("、") || "未指定"}{item.location && <><br />地点：{item.location}</>}</p>
    {item.projectId && <Link className="text-sm text-primary hover:underline" href={`/projects/${item.projectId}`}>{projectName(item.projectId)}</Link>}
    {item.responses.filter((response) => response.action !== "pending").map((response) => <p key={response.memberId} className="rounded-md bg-muted p-2 text-sm">{memberName(response.memberId)} · {actions[response.action]}{response.note ? `：${response.note}` : ""}</p>)}
    <ApprovalDocuments item={item} actorId={actorId} busy={busy} onBusyChange={onBusyChange} onUpdated={onUpdated} />
    <ActivityDiscussion activityId={item.id} memberName={memberName} members={participants} projectOptions={projectOptions} recentScopeKey={recentScopeKey} />
    {canRespond && <div className="grid gap-2 border-t pt-3"><label className="text-xs text-muted-foreground">处理意见（调整 / 退回时必填）<input value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} className={fieldClass} /></label><div className="flex flex-wrap gap-2">{options.map((action) => <Button key={action} variant={action === "accepted" || action === "approved" ? "default" : "outline"} size="sm" disabled={busy || (["change_requested", "returned"].includes(action) && !note.trim())} onClick={() => onRespond(action, note)}>{actions[action].replace(/^已/, "")}</Button>)}</div></div>}
    {item.audit.length > 1 && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer py-1">处理记录（{item.audit.length}）</summary><ul className="mt-2 grid gap-2">{item.audit.map((entry, index) => <li key={index}>{memberName(entry.actorId)} · {actions[entry.action] ?? entry.action} · {entry.action === "edited" ? "已更新事项内容，接收人需重新回应" : entry.action === "approval_withdrawn" ? "申请已撤回，原件与批注保留" : entry.action === "approval_completed" ? "任务已完成，次日自动归档" : entry.action === "approval_archived" ? "已按上海时间次日零点归档" : entry.note || "无补充意见"}</li>)}</ul></details>}
    </div>}
  </article>;
}
