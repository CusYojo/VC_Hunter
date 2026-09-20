"use client";
import { useState } from "react";
import { Download, FileText } from "lucide-react";
import { FileViewerDialog } from "@/components/file-viewer-dialog";

export function ChatOriginalPreview({ original, hasText }: { original: { name: string; url: string; isPdf: boolean }; hasText: boolean }) {
  const [open, setOpen] = useState(false);
  const linkClass = "inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs text-primary hover:bg-muted";
  return <div className="mb-3 rounded-xl border bg-muted/20 px-3 py-2">
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-2 text-xs"><FileText className="size-4 shrink-0 text-primary" aria-hidden="true" /><span className="break-words">{original.name}</span></span><div className="flex gap-1">{original.isPdf && <button type="button" onClick={() => setOpen(true)} className={linkClass}>查看原文件</button>}<a href={original.url} download={original.name} className={linkClass}><Download className="size-3.5" aria-hidden="true" />下载原文件</a></div></div>
    {!hasText && <p className="text-xs leading-5 text-muted-foreground">可尝试打开或下载原文件，AI 尚未读取正文。</p>}
    <p className="text-xs leading-5 text-muted-foreground">原文件预览保留至离开本页；需要长期保存，可上传到项目知识库。</p>
    {open && <FileViewerDialog name={original.name} kind="pdf" url={original.url} description="PDF 原文件 · 保留至离开本页" closeLabel="Close" onClose={() => setOpen(false)}><iframe title={`原文件预览：${original.name}`} src={`${original.url}#toolbar=1&navpanes=1&view=FitH`} className="h-full min-h-0 w-full border-0 bg-muted" /></FileViewerDialog>}
  </div>;
}
