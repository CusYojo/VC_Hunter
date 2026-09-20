"use client";

import { useId, useState, type ReactNode } from "react";
import { Download, ExternalLink, PanelRightClose, PanelRightOpen, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DocumentContentPreview } from "@/components/document-content-preview";

type Props = { name: string; kind: string; url: string; description?: string; details?: ReactNode; notice?: ReactNode; closeLabel?: string; onClose: () => void; children?: ReactNode };
const action = "inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm text-primary hover:bg-muted focus-visible:outline-2";

export function FileViewerDialog({ name, kind, url, description = "附件原件预览", details, notice, closeLabel = "关闭文件预览", onClose, children }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 768);
  const [info, setInfo] = useState({ truncated: false });
  const sidebarId = useId();
  const downloadUrl = url.startsWith("blob:") ? url : `${url}${url.includes("?") ? "&" : "?"}download=1`;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent showCloseButton={false} className={`h-[98dvh] w-[98vw] max-w-[98vw] grid-cols-[minmax(0,1fr)_2.75rem] gap-0 overflow-hidden rounded-lg p-0 sm:max-w-[98vw] ${sidebarOpen ? "md:grid-cols-[minmax(0,1fr)_15rem]" : ""}`}>
    <aside aria-label="文件信息与操作" className={`z-10 col-start-2 row-start-1 flex min-h-0 flex-col border-l bg-background ${sidebarOpen ? "absolute inset-y-0 right-0 w-[min(17rem,85vw)] shadow-xl md:static md:w-auto md:shadow-none" : ""}`}>
      <div className={`flex shrink-0 ${sidebarOpen ? "items-center justify-between gap-1 px-1" : "flex-col"}`}>
        <button type="button" aria-label={sidebarOpen ? "收起文件信息" : "展开文件信息"} aria-expanded={sidebarOpen} aria-controls={sidebarId} className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-muted" onClick={() => setSidebarOpen(value => !value)}>{sidebarOpen ? <PanelRightClose size={18} aria-hidden="true" /> : <PanelRightOpen size={18} aria-hidden="true" />}</button>
        <button type="button" aria-label={closeLabel} className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-muted" onClick={onClose}><X size={18} aria-hidden="true" /></button>
      </div>
      <div id={sidebarId} hidden={!sidebarOpen} className="min-h-0 overflow-y-auto px-4 pb-4">
        <DialogTitle className="break-all text-base leading-6">{name}</DialogTitle>
        <DialogDescription className="mt-2 text-sm leading-6">{description}</DialogDescription>
        {details && <div className="mt-3 break-words text-sm leading-6 text-muted-foreground">{details}</div>}
        <div className="mt-4 flex flex-col items-start gap-1">
          {(kind === "pdf" || kind === "image") && <a href={url} target="_blank" rel="noopener noreferrer" className={action}><ExternalLink size={16} aria-hidden="true" />新窗口打开</a>}
          <a href={downloadUrl} download={name} aria-label={`下载 ${name}`} className={action}><Download size={16} aria-hidden="true" />下载原文件</a>
        </div>
        {kind === "docx" && <p className="mt-4 text-xs leading-6 text-muted-foreground">Word 文字预览；完整排版请下载原文件查看。</p>}
        {kind === "pdf" && <p className="mt-4 text-xs leading-6 text-muted-foreground">使用阅读器翻页、缩放或打印。无法显示时，可在新窗口打开或下载原文件。</p>}
        {info.truncated && <p className="mt-4 text-sm leading-6 text-amber-800">当前展示部分正文，完整内容请下载查看。</p>}
        {notice}
      </div>
    </aside>
    <section aria-label="文件阅读区域" className="col-start-1 row-start-1 min-h-0 min-w-0 overflow-auto bg-muted/20">{children ?? <DocumentContentPreview url={url} name={name} kind={kind} controls="external" onPreviewInfo={setInfo} />}</section>
  </DialogContent></Dialog>;
}
