"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";

type PreviewProps = { url: string; name: string; kind: string; controls?: "sidebar" | "external"; onPreviewInfo?: (info: { truncated: boolean }) => void };

function subscribeWidth(listener: () => void) {
  const media = window.matchMedia?.("(min-width: 768px)");
  media?.addEventListener("change", listener);
  window.addEventListener("resize", listener);
  return () => { media?.removeEventListener("change", listener); window.removeEventListener("resize", listener); };
}
function desktopWidth() { return window.matchMedia?.("(min-width: 768px)").matches ?? window.innerWidth >= 768; }

export function DocumentContentPreview(props: PreviewProps) {
  // A new file gets a fresh state before paint, so an old PDF cannot appear
  // under the new filename while the next authenticated request is pending.
  return <DocumentPreviewContent key={JSON.stringify([props.url, props.kind])} {...props} />;
}

function DocumentPreviewContent({ url, name, kind, controls = "sidebar", onPreviewInfo }: PreviewProps) {
  const [preview, setPreview] = useState<{ text?: string; blobUrl?: string; truncated?: boolean }>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [manualSidebar, setManualSidebar] = useState<boolean | null>(null);
  const desktop = useSyncExternalStore(subscribeWidth, desktopWidth, () => false);
  const sidebarOpen = manualSidebar ?? desktop;
  const sidebarId = useId();
  const truncated = Boolean(preview.truncated);
  useEffect(() => { onPreviewInfo?.({ truncated }); }, [onPreviewInfo, truncated]);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    async function load() {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error("资料暂时无法预览，请重试或下载原文件。");
        if (kind === "pdf" || kind === "image") {
          const blob = await response.blob();
          if (controller.signal.aborted) return;
          if (kind === "image" && !["image/png", "image/jpeg", "image/webp"].includes(blob.type)) throw new Error("图片格式无效，请下载后核对。");
          objectUrl = URL.createObjectURL(new Blob([blob], { type: kind === "pdf" ? "application/pdf" : blob.type }));
          setPreview({ blobUrl: objectUrl });
        } else {
          const result = await response.json();
          if (!controller.signal.aborted) setPreview(result.data);
        }
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "加载资料失败。");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url, kind]);
  if (loading) return <p role="status" className="p-5 text-sm text-muted-foreground">正在加载资料…</p>;
  if (error) return <p role="alert" className="p-5 text-sm text-destructive">{error}</p>;
  return <div className="relative flex h-full min-h-0 min-w-0 overflow-hidden">
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
    {preview.blobUrl && kind === "image" ? <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-2">
      {/* Authenticated raster blob; image optimization cannot fetch this private object URL. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={preview.blobUrl} alt={name} className="max-h-full max-w-full object-contain" />
    </div> : preview.blobUrl ? <iframe title={`${name} 预览`} src={`${preview.blobUrl}#toolbar=1&navpanes=0&view=FitH`} className="min-h-0 w-full flex-1 border-0" /> : <pre className="m-0 flex-1 whitespace-pre-wrap break-words p-4 font-sans text-base leading-7">{preview.text || "未提取到可预览文字，请下载原文件查看。"}</pre>}
    </div>
    {controls === "sidebar" && <aside aria-label="文件预览工具" className={`${sidebarOpen ? "absolute inset-y-0 right-0 z-10 w-[min(16rem,100%)] shadow-lg md:relative md:inset-auto md:shadow-none" : "w-12"} flex shrink-0 flex-col border-l bg-background`}>
      <button type="button" className="flex min-h-11 w-12 shrink-0 items-center justify-center self-end rounded-md hover:bg-muted focus-visible:outline-2" aria-label={sidebarOpen ? "收起预览工具" : "展开预览工具"} aria-expanded={sidebarOpen} aria-controls={sidebarId} onClick={() => setManualSidebar(!sidebarOpen)}>{sidebarOpen ? <PanelRightClose className="size-5" aria-hidden="true" /> : <PanelRightOpen className="size-5" aria-hidden="true" />}</button>
      <div id={sidebarId} hidden={!sidebarOpen} className="min-h-0 overflow-y-auto px-3 pb-4">
        <p className="break-all text-base font-semibold leading-6">{name}</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{kind === "image" ? "照片预览" : kind === "pdf" ? "PDF 原文件预览，无需文字识别" : kind === "docx" ? "Word 文字预览；完整排版请下载原文件查看。" : "文件正文预览"}</p>
        {preview.truncated && <p className="mt-2 text-sm leading-6 text-muted-foreground">当前展示部分正文，完整内容请下载查看。</p>}
        {preview.blobUrl && <div className="mt-3 grid gap-1"><a href={preview.blobUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2">打开原文件</a><a href={preview.blobUrl} download={name} className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2">下载原文件</a></div>}
      </div>
    </aside>}
  </div>;
}
