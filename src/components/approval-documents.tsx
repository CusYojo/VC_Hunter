"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Download, Eye, FileText, Upload } from "lucide-react";
import { FileViewerDialog } from "@/components/file-viewer-dialog";
import { Button } from "@/components/ui/button";
import type { WorkspaceActivity } from "@/workbench/activity-contracts";

type Document = NonNullable<WorkspaceActivity["documents"]>[number];
const accept = ".pdf,.docx,.txt,.md,.markdown";
const maxBytes = 20 * 1024 * 1024;
function documentUrl(activityId: string, documentId: string) {
  return `/api/v1/activity/${encodeURIComponent(activityId)}/documents/${encodeURIComponent(documentId)}`;
}
function fileSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.ceil(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ApprovalDocuments({ item, actorId, busy, onBusyChange, onUpdated }: {
  item: WorkspaceActivity; actorId: string; busy: boolean; onBusyChange: (busy: boolean) => void; onUpdated: (item: WorkspaceActivity) => void;
}) {
  const [preview, setPreview] = useState<Document | null>(null);
  const documents = item.documents ?? [];
  const label = item.kind === "approval" ? "审批资料" : "事项附件";
  const canUpload = (item.status ?? "active") === "active" && item.createdBy === actorId && !item.responses.every(response => response.action === "declined") && item.responses.every(response => item.kind === "approval" ? response.action === "pending" : !["done", "approved", "returned"].includes(response.action));
  return <section aria-label={label} className="min-w-0 border-t pt-3">
    <h4 className="flex items-center gap-2 text-base font-semibold"><FileText className="size-4 text-primary" aria-hidden="true" />{label}<span className="text-sm font-normal text-muted-foreground">{documents.length} 份</span></h4>
    {documents.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">尚未上传{label}。</p> : <ul className="mt-1 divide-y divide-border">
      {documents.map((document) => <li key={document.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2">
        <div className="min-w-0 flex-1 basis-40"><p className="break-all text-base font-medium leading-6">{document.originalName}</p><p className="mt-0.5 break-words text-sm leading-5 text-muted-foreground">{document.source === "project" ? `项目库引用 · ${document.projectName ?? ""} · ` : ""}{fileSize(document.byteLength)} · {new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(document.createdAt))}</p></div>
        <div className="flex shrink-0 items-center gap-1"><Button variant="ghost" className="min-h-11 px-2 text-sm" aria-label={`预览 ${document.originalName}`} aria-pressed={preview?.id === document.id} onClick={() => setPreview(document)}><Eye aria-hidden="true" />预览</Button>
        <a className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm text-primary hover:underline focus-visible:outline-2" href={`${documentUrl(item.id, document.id)}?download=1`} aria-label={`下载 ${document.originalName}`} download><Download className="size-4" aria-hidden="true" />下载</a></div>
      </li>)}
    </ul>}
    {canUpload && <DocumentUpload item={item} busy={busy} onBusyChange={onBusyChange} onUpdated={onUpdated} />}
    {preview && <DocumentPreview key={preview.id} activityId={item.id} document={preview} onClose={() => setPreview(null)} />}
  </section>;
}

function DocumentUpload({ item, busy, onBusyChange, onUpdated }: { item: WorkspaceActivity; busy: boolean; onBusyChange: (busy: boolean) => void; onUpdated: (item: WorkspaceActivity) => void }) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const retryKey = useRef("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || uploading || busy) return;
    setError(""); setFeedback("");
    if (!/\.(pdf|docx|txt|md|markdown)$/i.test(file.name)) { setError("仅支持 PDF、DOCX、TXT 和 Markdown 文件。"); return; }
    if (file.size === 0 || file.size > maxBytes) { setError(file.size === 0 ? "文件不能为空。" : "单文件不能超过 20 MB。"); return; }
    setUploading(true); onBusyChange(true);
    try {
      const form = new FormData();
      form.set("file", file); form.set("expectedVersion", String(item.version));
      if (!retryKey.current) retryKey.current = crypto.randomUUID();
      const response = await fetch(`/api/v1/activity/${encodeURIComponent(item.id)}/documents`, { method: "POST", headers: { "idempotency-key": retryKey.current }, body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "上传失败，请稍后重试。");
      onUpdated(payload.data);
      setFile(null); retryKey.current = "";
      if (input.current) input.current.value = "";
      setFeedback(item.kind === "approval" ? "资料已上传，审核人可以在线预览。" : "资料已上传，相关人员可以在线预览。");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "上传失败，请检查网络后重试。"); }
    finally { setUploading(false); onBusyChange(false); }
  }

  return <form onSubmit={upload} aria-busy={uploading} className="mt-2 grid gap-1.5 border-t pt-2">
    <label htmlFor={inputId} className="text-base font-medium">上传{item.kind === "approval" ? "审批资料" : "事项附件"}</label>
    <p id={`${inputId}-help`} className="text-sm leading-5 text-muted-foreground">支持 PDF、Word（DOCX）、TXT、Markdown，单文件不超过 20 MB。可逐份上传，资料仅供本事项相关人员查看。</p>
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
      <input ref={input} id={inputId} type="file" accept={accept} aria-describedby={`${inputId}-help`} disabled={busy || uploading} className="min-h-11 min-w-0 flex-1 rounded-md border bg-background p-2 text-sm file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-muted file:px-3 file:py-1" onChange={(event) => { setFile(event.target.files?.[0] ?? null); retryKey.current = ""; setError(""); setFeedback(""); }} />
      <Button type="submit" className="min-h-11" disabled={!file || busy || uploading}><Upload aria-hidden="true" />{uploading ? "正在上传…" : "上传资料"}</Button>
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {feedback && <p role="status" className="text-sm text-emerald-800">{feedback}</p>}
  </form>;
}

function DocumentPreview({ activityId, document, onClose }: { activityId: string; document: Document; onClose: () => void }) {
  const [content, setContent] = useState<{ text?: string; url?: string; truncated?: boolean }>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    async function load() {
      try {
        const response = await fetch(documentUrl(activityId, document.id), { signal: controller.signal });
        if (!response.ok) {
          const payload = await response.json();
          throw new Error(payload.error?.message ?? "暂时无法预览，请下载原文件。");
        }
        if (document.kind === "pdf") {
          const blob = await response.blob();
          if (controller.signal.aborted) return;
          objectUrl = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
          setContent({ url: objectUrl });
        } else {
          const payload = await response.json();
          if (!controller.signal.aborted) setContent({ text: payload.data.text, truncated: payload.data.truncated });
        }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "暂时无法预览，请下载原文件。");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [activityId, document.id, document.kind]);

  return <FileViewerDialog name={document.originalName} kind={document.kind} url={documentUrl(activityId, document.id)} onClose={onClose} closeLabel="关闭预览" description="事项附件 · 仅相关人员可查看" details={<>{fileSize(document.byteLength)}{document.source === "project" ? ` · 项目库引用 · ${document.projectName ?? ""}` : ""}</>} notice={content.truncated && <p className="mt-4 text-sm leading-6 text-muted-foreground">正文较长，当前仅显示部分内容。请下载原文件查看全文。</p>}>
    <div aria-busy={loading} className="flex h-full min-h-0 flex-col">
      {loading ? <p role="status" className="p-3 text-sm text-muted-foreground">正在加载预览…</p> : error ? <p role="alert" className="p-3 text-sm text-red-700">{error}</p> : content.url ? <iframe title={`PDF 预览：${document.originalName}`} src={content.url} className="h-full min-h-0 w-full flex-1 border-0" /> : <pre className="m-0 min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words p-4 font-sans text-base leading-7">{content.text || "文件未提取到可读正文，请下载原文件查看。"}</pre>}
    </div>
  </FileViewerDialog>;
}
