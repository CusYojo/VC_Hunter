"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { ActivityParticipantPicker, recordRecentActivityParticipants } from "@/components/activity-participant-picker";
import { Button } from "@/components/ui/button";
import { AttachmentPicker, findFileMention, insertFileMention, type AttachedProjectFile, type FileMention } from "@/components/attachment-picker";
import type { WorkspaceActivity } from "@/workbench/activity-contracts";

export type ActivityMember = { id: string; name: string; departmentId?: string | null; departmentName?: string | null };
type ProjectOption = { id: string; name: string };
const kinds = { task: "待办", meeting: "会议", trip: "行程", approval: "资料审批" };
const fieldClass = "mt-1 block min-h-11 w-full rounded-md border border-input bg-white px-3 py-2 text-sm";
export function localDateTime(value: Date): string {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function isQuarterHour(value: string): boolean {
  const minute = /T\d{2}:(\d{2})/.exec(value)?.[1];
  return minute === undefined || Number(minute) % 15 === 0;
}

function ActivityDateTimeField({ name, label, initialValue, hintId }: { name: "dueAt" | "endAt"; label: string; initialValue: string; hintId: string }) {
  const [value, setValue] = useState(initialValue);
  const [manualSpecialTime, setManualSpecialTime] = useState(false);
  return <label className="text-sm">{label}<input name={name} type="datetime-local" step={manualSpecialTime ? "any" : 900} aria-describedby={hintId} value={value} onChange={event => { const next = event.target.value; setValue(next); setManualSpecialTime(!isQuarterHour(next)); }} className={fieldClass} /></label>;
}

export function ActivityForm({ members, projectOptions, currentUserId, onlyKind, busy, initial, scopeKey, onCancel, onSave }: {
  members: ActivityMember[]; projectOptions: ProjectOption[]; onlyKind?: "approval"; busy: boolean; initial?: WorkspaceActivity; scopeKey: string;
  currentUserId: string;
  onCancel: () => void; onSave: (body: unknown, key: string, files: File[]) => Promise<boolean>;
}) {
  const retry = useRef<{ body: string; files: File[]; key: string } | null>(null);
  const pending = useRef(false);
  const [files, setFiles] = useState<File[]>([]);
  const [projectFiles, setProjectFiles] = useState<AttachedProjectFile[]>([]);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [mention, setMention] = useState<FileMention | null>(null);
  const [kind, setKind] = useState(initial?.kind ?? onlyKind ?? "task");
  const [selected, setSelected] = useState<string[]>(initial?.responses.map(response => response.memberId) ?? []);
  const [openedAt] = useState(() => localDateTime(new Date()));
  const [validation, setValidation] = useState("");
  const timeHintId = useId();
  const selectableMembers = kind === "approval" ? members.filter(member => member.id !== currentUserId) : members;
  const normalizeParticipants = (ids: readonly string[], nextKind = kind) => {
    const allowed = new Set(members.filter(member => nextKind !== "approval" || member.id !== currentUserId).map(member => member.id));
    const valid = [...new Set(ids.filter(id => allowed.has(id)))];
    return valid;
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || busy) return;
    const data = new FormData(event.currentTarget);
    const value = String(data.get("dueAt") ?? "");
    const date = value ? new Date(value) : null;
    const endValue = String(data.get("endAt") ?? "");
    const end = endValue ? new Date(endValue) : null;
    const title = String(data.get("title") ?? "").trim();
    if (!title || !data.get("kind")) { setValidation("请填写事项类型和标题。"); return; }
    if (date && !Number.isFinite(date.getTime())) { setValidation("请填写有效时间，或留空。"); return; }
    if (end && (!date || !Number.isFinite(end.getTime()) || end <= date)) { setValidation("结束时间必须晚于开始时间。"); return; }
    setValidation("");
    const participantIds = normalizeParticipants(selected);
    const body = { kind: data.get("kind"), title, description, dueAt: date?.toISOString() ?? null, endAt: end?.toISOString() ?? null, participantIds, location: data.get("location"), projectId: data.get("projectId") || null,
      ...(kind === "approval" ? { approvalType: data.get("approvalType") ?? "general" } : {}),
      ...(initial ? { expectedVersion: initial.version } : { projectDocumentIds: projectFiles.map(file => file.id) }) };
    const serialized = JSON.stringify(body);
    if (retry.current?.body !== serialized || retry.current.files.length !== files.length || files.some((file, index) => file !== retry.current?.files[index])) retry.current = { body: serialized, files: [...files], key: crypto.randomUUID() };
    pending.current = true;
    try { if (await onSave(body, retry.current.key, files)) recordRecentActivityParticipants(scopeKey, participantIds); } finally { pending.current = false; }
  }
  return <form onSubmit={submit} className="grid gap-4 rounded-lg border border-primary/20 bg-white p-5">
    <h3 className="font-semibold">{initial ? "编辑工作事项" : "新建工作事项"}</h3>
    <p className="text-xs text-muted-foreground">事项类型和标题必填，其余内容可稍后补充。</p>
    <fieldset disabled={busy} className="grid min-w-0 gap-4">
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">事项类型<select name="kind" required value={kind} onChange={event => { const nextKind = event.target.value as WorkspaceActivity["kind"]; setKind(nextKind); setSelected(current => normalizeParticipants(current, nextKind)); }} className={fieldClass}>{Object.entries(kinds).filter(([key]) => !onlyKind || key === onlyKind).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label><label className="text-sm">事项标题<input name="title" required maxLength={200} defaultValue={initial?.title ?? ""} className={fieldClass} /></label></div>
      {kind === "approval" && <label className="text-sm">审批类型<select name="approvalType" defaultValue={initial?.approvalType ?? "general"} className={fieldClass}><option value="general">普通审批</option><option value="reimbursement">报销</option></select></label>}
      <div className="grid gap-4 sm:grid-cols-2"><ActivityDateTimeField name="dueAt" label="截止或开始时间" hintId={timeHintId} initialValue={initial ? initial.dueAt ? localDateTime(new Date(initial.dueAt)) : "" : openedAt} /><ActivityDateTimeField name="endAt" label="结束时间" hintId={timeHintId} initialValue={initial?.endAt ? localDateTime(new Date(initial.endAt)) : ""} /><label className="text-sm">地点或会议链接<input name="location" maxLength={300} defaultValue={initial?.location ?? ""} className={fieldClass} /></label></div>
      <p id={timeHintId} className="-mt-2 text-xs text-muted-foreground">时间选择器按 15 分钟滚动；也可以直接输入任意分钟。</p>
      <label className="text-sm">关联项目<select name="projectId" defaultValue={initial?.projectId ?? ""} className={fieldClass}><option value="">不关联项目</option>{projectOptions.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <ActivityParticipantPicker members={selectableMembers} selected={selected} onChange={setSelected} busy={busy} scopeKey={scopeKey} />
      <label className="text-sm">内容与资料说明<textarea name="description" rows={3} maxLength={4000} value={description} onChange={event => { setDescription(event.target.value); if (!initial) setMention(findFileMention(event.target.value, event.target.selectionStart, projectFiles.map(file => file.originalName))); }} className={fieldClass} /></label>
      {initial ? <p className="text-xs text-muted-foreground">已有附件与批注保留。补充文件可在事项的“批注与回复”中上传。</p> : <AttachmentPicker files={files} projectFiles={projectFiles} projects={projectOptions} busy={busy} onFilesChange={setFiles} onProjectFilesChange={setProjectFiles} mention={mention} onMentionChange={setMention} onMentionChosen={file => setDescription(previous => insertFileMention(previous, mention, file))} />}
      {validation && <p role="alert" className="text-sm text-red-700">{validation}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? "保存中…" : initial ? "保存修改" : "保存到工作空间"}</Button><Button type="button" variant="outline" disabled={busy} onClick={onCancel}>取消</Button></div>
    </fieldset>
  </form>;
}
