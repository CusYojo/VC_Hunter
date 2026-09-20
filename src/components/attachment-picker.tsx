"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { AtSign, FileText, LoaderCircle, Paperclip, Search, X } from "lucide-react";
import type { ProjectFileOption } from "@/workbench/activity-contracts";

export type AttachedProjectFile = Pick<ProjectFileOption, "id" | "projectId" | "projectName" | "originalName">;
export type FileMention = { query: string; start: number; end: number };
export function findFileMention(text: string, cursor: number, resolvedNames: readonly string[] = []): FileMention | null {
  const match = /(?:^|[^A-Za-z0-9])@([^\n@]{0,120})$/u.exec(text.slice(0, cursor));
  if (!match || resolvedNames.some(name => name.length > 0 && (match[1] === name || match[1].startsWith(`${name} `)))) return null;
  return { query: match[1], start: match.index + match[0].indexOf("@"), end: cursor };
}
export function insertFileMention(text: string, mention: FileMention | null, file: AttachedProjectFile) {
  if (!mention || text[mention.start] !== "@") return text;
  return `${text.slice(0, mention.start)}@${file.originalName} ${text.slice(mention.end)}`;
}
const maxBytes = 20 * 1024 * 1024;
const control = "inline-flex min-h-11 items-center gap-2 rounded-lg border bg-background px-3 text-sm hover:bg-muted disabled:opacity-50";

export function AttachmentPicker({ files, projectFiles, projects, busy, onFilesChange, onProjectFilesChange, mention, onMentionChange, onMentionChosen, compact = false, allowImages = false, extraControls }: {
  compact?: boolean; allowImages?: boolean; extraControls?: ReactNode;
  files: File[]; projectFiles: AttachedProjectFile[]; projects: { id: string; name: string }[]; busy: boolean;
  onFilesChange: (files: File[]) => void; onProjectFilesChange: (files: AttachedProjectFile[]) => void;
  mention?: FileMention | null; onMentionChange?: (mention: FileMention | null) => void; onMentionChosen?: (file: AttachedProjectFile) => void;
}) {
  const inputId = useId();
  const [opened, setOpened] = useState(false);
  const [search, setSearch] = useState("");
  const [project, setProject] = useState("");
  const [result, setResult] = useState<{ key: string; items: ProjectFileOption[]; hasMore: boolean; error: string } | null>(null);
  const [fileError, setFileError] = useState("");
  const open = opened || Boolean(mention);
  const query = (mention?.query ?? search).replace(/^@\s*/, "");
  const requestKey = JSON.stringify([query, project]);
  const loading = open && result?.key !== requestKey;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: query }); if (project) params.set("projectId", project);
        const response = await fetch(`/api/v1/project-files?${params}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message || "项目库文件暂时无法加载，请重试。");
        if (!controller.signal.aborted) setResult({ key: requestKey, items: payload.data.items, hasMore: payload.data.hasMore, error: "" });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ key: requestKey, items: [], hasMore: false, error: error instanceof Error ? error.message : "项目库文件暂时无法加载。" });
      }
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, query, project, requestKey]);
  function addFiles(next: File[]) {
    const combined = [...files, ...next];
    if (combined.length > 10) { setFileError("每次最多附上 10 个本地文件。"); return; }
    if (combined.some(file => !(allowImages ? /\.(pdf|docx|txt|md|markdown|png|jpe?g|webp)$/i : /\.(pdf|docx|txt|md|markdown)$/i).test(file.name))) { setFileError(allowImages ? "支持文档及 PNG、JPEG、WebP 照片。" : "支持 PDF、DOCX、TXT 和 Markdown 文件。"); return; }
    if (combined.some(file => file.size === 0)) { setFileError("文件不能为空。"); return; }
    if (combined.reduce((sum, file) => sum + file.size, 0) > maxBytes) { setFileError("本次上传的文件总大小不能超过 20 MB。"); return; }
    setFileError(""); onFilesChange(combined);
  }
  function choose(file: ProjectFileOption) {
    if (!projectFiles.some(item => item.id === file.id)) {
      if (projectFiles.length >= 20) { setFileError("最多引用 20 份项目库文件。"); return; }
      onProjectFilesChange([...projectFiles, file]);
    }
    onMentionChosen?.(file); onMentionChange?.(null); setOpened(false); setSearch(""); setFileError("");
  }
  return <section aria-label="文件附件" className={compact ? "min-w-0 space-y-2" : "min-w-0 space-y-3 rounded-xl border bg-muted/20 p-3 sm:p-4"}>
    <div className="flex flex-wrap items-center justify-between gap-2">{!compact && <h4 className="flex items-center gap-2 text-sm font-medium"><Paperclip className="size-4 text-primary" aria-hidden="true" />附件<span className="text-xs font-normal text-muted-foreground">{files.length + projectFiles.length} 份</span></h4>}<div className="flex flex-wrap gap-2"><label htmlFor={inputId} className={`${control} relative cursor-pointer focus-within:ring-2 focus-within:ring-ring`}><Paperclip className="size-4" aria-hidden="true" />{compact ? "附附件" : "附上文件"}<input id={inputId} aria-label="附上文件" type="file" multiple accept={allowImages ? ".pdf,.docx,.txt,.md,.markdown,.png,.jpg,.jpeg,.webp" : ".pdf,.docx,.txt,.md,.markdown"} disabled={busy} className="absolute inset-0 w-full cursor-pointer opacity-0" onChange={event => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} /></label><button type="button" disabled={busy} className={control} aria-expanded={open} onClick={() => { onMentionChange?.(null); setOpened(!open); }}><AtSign className="size-4" aria-hidden="true" />{compact ? "@知识库" : "@ 项目库文件"}</button>{extraControls}</div></div>
    {!compact && <p className="text-xs leading-5 text-muted-foreground">上传 PDF、DOCX、TXT、Markdown，最多 10 个、合计 20 MB；也可在说明中输入 @ 引用项目库文件。</p>}
    {fileError && <p role="alert" className="text-sm text-destructive">{fileError}</p>}
    {(files.length > 0 || projectFiles.length > 0) && <ul aria-label="已选附件" className={compact ? "flex flex-wrap gap-2" : "grid gap-2"}>
      {files.map((file, index) => <li key={`${file.name}-${index}`} className="flex min-w-0 items-center gap-2 rounded-lg border bg-card py-1 pl-3"><FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><div className="min-w-0 flex-1"><p className="break-words text-sm">{file.name}</p>{!compact && <p className="text-xs text-muted-foreground">本地文件 · 随表单保存</p>}</div><button type="button" className="grid size-11 shrink-0 place-items-center rounded-lg hover:bg-muted" disabled={busy} aria-label={`移除 ${file.name}`} onClick={() => { onFilesChange(files.filter((_, i) => i !== index)); setFileError(""); }}><X className="size-4" aria-hidden="true" /></button></li>)}
      {projectFiles.map(file => <li key={file.id} className="flex min-w-0 items-center gap-2 rounded-lg border border-primary/20 bg-card py-1 pl-3"><AtSign className="size-4 shrink-0 text-primary" aria-hidden="true" /><div className="min-w-0 flex-1"><p className="break-words text-sm">{file.originalName}</p><p className="break-words text-xs text-muted-foreground">项目库引用 · {file.projectName}</p></div><button type="button" disabled={busy} className="grid size-11 shrink-0 place-items-center rounded-lg hover:bg-muted" aria-label={`移除 ${file.originalName}`} onClick={() => onProjectFilesChange(projectFiles.filter(item => item.id !== file.id))}><X className="size-4" aria-hidden="true" /></button></li>)}
    </ul>}
    {open && <div className="space-y-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap gap-2"><label className="relative min-w-0 flex-1"><Search className="absolute top-3.5 left-3 size-4 text-muted-foreground" aria-hidden="true" /><input aria-label="搜索项目库文件" disabled={busy} maxLength={120} value={mention?.query ?? search} onChange={event => { if (mention) onMentionChange?.({ ...mention, query: event.target.value }); else setSearch(event.target.value); }} placeholder="@ 输入文件名或项目名" className="min-h-11 w-full rounded-lg border bg-background pr-3 pl-9 text-sm" /></label><select aria-label="筛选项目" disabled={busy} value={project} onChange={event => setProject(event.target.value)} className="min-h-11 max-w-full rounded-lg border bg-background px-2 text-sm"><option value="">全部项目</option>{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" className="grid size-11 place-items-center rounded-lg hover:bg-muted" aria-label="关闭项目文件选择" onClick={() => { setOpened(false); onMentionChange?.(null); }}><X className="size-4" aria-hidden="true" /></button></div>
      {loading ? <p role="status" className="flex items-center gap-2 py-3 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />正在搜索项目库…</p> : result?.error ? <div><p role="alert" className="text-sm text-destructive">{result.error}</p><button type="button" className="min-h-11 text-sm text-primary" onClick={() => { setOpened(false); onMentionChange?.(null); }}>关闭后重新选择</button></div> : <div role="group" aria-label="项目库搜索结果" className="max-h-60 space-y-1 overflow-y-auto">{result?.items.length ? result.items.map(file => <button key={file.id} type="button" disabled={busy} onClick={() => choose(file)} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-muted disabled:opacity-50"><FileText className="size-4 shrink-0 text-primary" aria-hidden="true" /><span className="min-w-0 flex-1"><span className="block break-words text-sm">{file.originalName}</span><span className="block break-words text-xs text-muted-foreground">{file.projectName}</span></span>{projectFiles.some(item => item.id === file.id) && <span className="text-xs text-primary">已选择</span>}</button>) : <p className="py-3 text-sm text-muted-foreground">没有找到匹配文件，请更换关键词或先上传至项目知识库。</p>}{result?.hasMore && <p className="p-2 text-xs text-muted-foreground">仅显示前 100 份，请输入更具体的文件名或筛选项目。</p>}</div>}
    </div>}
  </section>;
}
