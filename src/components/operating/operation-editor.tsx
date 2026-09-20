"use client";
import { useState, type FormEvent } from "react";
import { operationConfigs, type OperationKind, type OperationRecord, type OperationWorkspace } from "@/workbench/business-operation-contracts";
import { AttachmentPicker, findFileMention, insertFileMention, type AttachedProjectFile, type FileMention } from "@/components/attachment-picker";
const fieldClass = "mt-1 min-h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm";
export function OperationEditor({ kind, record, workspace, busy, onSave }: { kind: OperationKind; record: OperationRecord | null; workspace: OperationWorkspace; busy: boolean; onSave: (value: { name: string; status: string; data: OperationRecord["data"] }, files: File[]) => void }) {
  const config = operationConfigs[kind];
  const [name, setName] = useState(record?.name ?? "");
  const [status, setStatus] = useState(record?.status ?? Object.keys(config.statuses)[0]);
  const [data, setData] = useState<OperationRecord["data"]>(record?.data ?? {});
  const [files, setFiles] = useState<File[]>([]);
  const [mention, setMention] = useState<FileMention | null>(null);
  const [projectFiles, setProjectFiles] = useState<AttachedProjectFile[]>(() => ((record?.data.documentIds ?? []) as string[]).map(id => {
    const document = record?.documents?.find(item => item.source === "project" && item.projectDocumentId === id) ?? workspace.documents.find(item => item.id === id);
    const projectId = document?.projectId ?? String(record?.data.projectId ?? "");
    return { id, projectId, projectName: workspace.projects.find(project => project.id === projectId)?.name ?? "原项目", originalName: document?.originalName ?? "已关联资料" };
  }));
  const setField = (key: string, value: string | string[]) => setData(previous => ({ ...previous, [key]: value }));
  function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = Object.fromEntries(config.fields.flatMap((field) => {
      const value = data[field.key];
      if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return [];
      return [[field.key, field.type === "money" || field.type === "year" ? Number(value) : typeof value === "string" ? value.trim() : value]];
    }));
    onSave({ name: name.trim(), status, data: normalized }, files);
  }
  return <form onSubmit={submit} className="space-y-4 p-4"><fieldset disabled={busy} className="space-y-4">
    <label className="block text-sm font-medium">名称<input required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} /></label>
    <label className="block text-sm font-medium">状态<select value={status} onChange={(event) => setStatus(event.target.value)} className={fieldClass}>{Object.entries(config.statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    {config.fields.map((field) => {
      if (field.type === "documents") return null;
      const value = String(data[field.key] ?? "");
      return <label key={field.key} className="block text-sm font-medium">{field.label}{field.type === "fund" || field.type === "project" ? <select className={fieldClass} required={field.required} value={value} onChange={(event) => setField(field.key, event.target.value)}><option value="">请选择</option>{(field.type === "fund" ? workspace.funds : workspace.projects).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : field.type === "textarea" ? <textarea className={`${fieldClass} min-h-24`} maxLength={10000} value={value} onChange={(event) => { setField(field.key, event.target.value); if (field.key === "notes") setMention(findFileMention(event.target.value, event.target.selectionStart, projectFiles.map(file => file.originalName))); }} /> : <input className={fieldClass} type={field.type === "money" || field.type === "year" ? "number" : field.type === "date" ? "date" : "text"} required={field.required || (kind === "payment" && status === "paid" && ["paidOn", "reference"].includes(field.key))} min={field.type === "year" ? 1900 : field.type === "money" ? 0 : undefined} max={field.type === "year" ? 2200 : field.type === "money" ? 1e12 : undefined} step={field.type === "money" ? "0.01" : undefined} maxLength={500} value={value} onChange={(event) => setField(field.key, event.target.value)} />}</label>;
    })}
    <AttachmentPicker files={files} projectFiles={projectFiles} projects={workspace.projects} busy={busy} onFilesChange={setFiles} onProjectFilesChange={selected => { setProjectFiles(selected); setField("documentIds", selected.map(file => file.id)); }} mention={mention} onMentionChange={setMention} onMentionChosen={file => { if (mention) setData(previous => ({ ...previous, notes: insertFileMention(String(previous.notes ?? ""), mention, file) })); }} />
    {record?.documents?.some(document => document.source === "upload") && <div className="rounded-lg border p-3 text-xs text-muted-foreground"><p className="mb-2 font-medium">已保存附件（继续保留）</p>{record.documents.filter(document => document.source === "upload").map(document => <p key={document.id} className="break-words">{document.originalName}</p>)}</div>}
    <button type="submit" className="min-h-11 w-full rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50">{busy ? "正在保存…" : "保存记录"}</button>
  </fieldset></form>;
}
