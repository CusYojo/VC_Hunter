"use client";

import { useCallback, useId, useState } from "react";
import { Download, FileStack, MessageSquareText, PanelRightClose, PanelRightOpen, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { DocumentContentPreview } from "@/components/document-content-preview";
import { DocumentAnnotations } from "@/components/document-annotations";
import type { ProjectDocumentView, DocumentReviewStatus } from "@/workbench/project-document-contracts";

const control = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50";
const reviewLabels = { pending: "待审核", approved: "已通过", changes_requested: "需修改" };
const processingLabel = (status: string) => ({ queued: "排队中", running: "处理中", processing: "处理中", succeeded: "已完成", failed: "失败", skipped: "未执行" })[status] ?? status;
const formatBytes = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function ProjectDocuments({ projectId, documents }: { projectId: string; documents: ProjectDocumentView[] }) {
  const [selected, setSelected] = useState<ProjectDocumentView | null>(null);
  const [discussionOpen, setDiscussionOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [previewInfo, setPreviewInfo] = useState({ truncated: false });
  const sidebarId = useId();
  const [busy, setBusy] = useState(false);
  const [reviews, setReviews] = useState<Record<string, DocumentReviewStatus>>({});
  const contentUrl = (id: string) => `/api/v1/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(id)}/content`;
  const selectedId = selected?.id;
  const updateStatus = useCallback((status: DocumentReviewStatus) => {
    if (selectedId) setReviews((previous) => previous[selectedId] === status ? previous : { ...previous, [selectedId]: status });
  }, [selectedId]);
  function open(document: ProjectDocumentView, discussion: boolean) {
    setSelected(document); setDiscussionOpen(discussion); setPreviewInfo({ truncated: false });
    setSidebarOpen(discussion || (window.matchMedia?.("(min-width: 768px)").matches ?? window.innerWidth >= 768));
  }
  return <>
    <div className="panel-heading"><div className="flex items-center gap-2"><FileStack className="size-5 text-primary" aria-hidden="true" /><h2>项目资料与审批状态</h2></div><span>{documents.length} 份</span></div>
    {documents.length === 0 ? <div className="empty-state"><strong>还没有项目资料</strong><p>使用页面右上角“上传资料”，支持 PDF、DOCX、TXT 与 Markdown。</p></div> : <div className="space-y-3">{documents.map((document) => <article key={document.id} className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
      <div className="min-w-0 flex-[1_1_16rem]"><div className="flex items-start gap-2"><span className="shrink-0 rounded border px-2 py-0.5 text-xs text-muted-foreground">{document.kind.toUpperCase()}</span><strong className="break-all text-sm">{document.originalName}</strong></div><p className="mt-2 text-xs text-muted-foreground">{formatBytes(document.byteLength)} · 原件本地保存</p><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>解析：{processingLabel(document.parseStatus)}</span><span>分析：{processingLabel(document.analysisStatus)}</span><span className="font-medium text-foreground">审核：{reviewLabels[reviews[document.id] ?? document.reviewStatus ?? "pending"]}</span></div></div>
      <div className="flex flex-wrap gap-2"><button type="button" className={control} aria-label={`在线打开 ${document.originalName}`} onClick={() => open(document, false)}>在线打开</button><a className={control} aria-label={`下载 ${document.originalName}`} href={`${contentUrl(document.id)}?download=1`}><Download aria-hidden="true" className="size-4" />下载</a><button type="button" className={`${control} border-primary/25 text-primary`} aria-label={`审核 / 批注 ${document.originalName}`} onClick={() => open(document, true)}><MessageSquareText aria-hidden="true" className="size-4" />审核 / 批注</button></div>
    </article>)}</div>}
    <Sheet open={selected !== null} onOpenChange={(open) => { if (!open && !busy) setSelected(null); }}>
      <SheetContent showCloseButton={false} className="gap-0 overflow-hidden data-[side=right]:h-dvh data-[side=right]:w-full data-[side=right]:sm:max-w-[calc(100vw-1rem)]">
        {selected && <><SheetTitle className="sr-only">{selected.originalName}</SheetTitle><SheetDescription className="sr-only">项目资料预览，可在侧栏下载和审核。</SheetDescription>
          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden bg-muted/20"><DocumentContentPreview key={selected.id} url={contentUrl(selected.id)} name={selected.originalName} kind={selected.kind} controls="external" onPreviewInfo={setPreviewInfo} /></div>
            <aside aria-label="文件信息与审核" className={`${sidebarOpen ? "absolute inset-y-0 right-0 z-10 w-[min(23rem,calc(100vw-3rem))] shadow-xl md:relative md:inset-auto md:shadow-none" : "w-12"} flex min-h-0 shrink-0 flex-col border-l bg-background`}>
              <div className={`flex shrink-0 ${sidebarOpen ? "items-center justify-end gap-1" : "flex-col"} p-1`}>
                <button type="button" aria-label={sidebarOpen ? "收起文件侧栏" : "展开文件侧栏"} aria-expanded={sidebarOpen} aria-controls={sidebarId} className="flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-muted focus-visible:outline-2 disabled:opacity-50" disabled={busy} onClick={() => setSidebarOpen(value => !value)}>{sidebarOpen ? <PanelRightClose aria-hidden="true" className="size-5" /> : <PanelRightOpen aria-hidden="true" className="size-5" />}</button>
                <button type="button" aria-label="关闭资料面板" className="flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-muted focus-visible:outline-2 disabled:opacity-50" disabled={busy} onClick={() => setSelected(null)}><X aria-hidden="true" className="size-5" /></button>
              </div>
              <div id={sidebarId} hidden={!sidebarOpen} className={sidebarOpen ? "flex min-h-0 flex-1 flex-col overflow-y-auto" : "hidden"}>
                <div className="shrink-0 border-b px-4 pb-4"><h3 className="break-all text-base font-semibold leading-6">{selected.originalName}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">项目资料 · {formatBytes(selected.byteLength)}</p>
                  {selected.kind === "docx" && <p className="mt-2 text-sm leading-6 text-muted-foreground">Word 文字预览；完整排版请下载原文件查看。</p>}
                  {previewInfo.truncated && <p className="mt-2 text-sm leading-6 text-muted-foreground">当前展示部分正文，完整内容请下载查看。</p>}
                  <div className="mt-3 flex flex-wrap gap-2">{selected.kind === "pdf" && <a href={contentUrl(selected.id)} target="_blank" rel="noopener noreferrer" className={control}>打开原文件</a>}<a href={`${contentUrl(selected.id)}?download=1`} className={control}><Download className="size-4" aria-hidden="true" />下载原文件</a><button type="button" className={control} disabled={busy} aria-expanded={discussionOpen} onClick={() => setDiscussionOpen(value => !value)}>{discussionOpen ? "收起审核 / 批注" : "展开审核 / 批注"}</button></div>
                </div>
                <div hidden={!discussionOpen} className={discussionOpen ? "flex min-h-80 min-w-0 flex-1 flex-col" : "hidden"}><DocumentAnnotations key={selected.id} url={`/api/v1/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(selected.id)}/annotations`} onStatus={updateStatus} onBusy={setBusy} /></div>
              </div>
            </aside>
          </div>
        </>}
      </SheetContent>
    </Sheet>
  </>;
}
