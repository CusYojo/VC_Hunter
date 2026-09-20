"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/legacy";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TRACKS } from "@/domain/projects";
import type { CandidateView } from "@/workbench/candidate-details";

export function ManualCandidateUpload({ file, onClose, onSaved }: { file: File; onClose: () => void; onSaved: (candidate: CandidateView) => void }) {
  const [companyName,setCompanyName] = useState(file.name.replace(/\.[^.]+$/, ""));
  const [track,setTrack] = useState<string>(TRACKS[0]);
  const [summary,setSummary] = useState("");
  const [investorNames,setInvestorNames] = useState("");
  const [sourceText,setSourceText] = useState("");
  const [busy,setBusy] = useState<"extract"|"save"|null>("extract");
  const [error,setError] = useState<string|null>(null);
  const retry = useRef<{ body: string; key: string }|null>(null);
  useEffect(() => {
    const controller = new AbortController(); const form = new FormData(); form.set("file",file);
    void fetch("/api/v1/ai/extract",{ method:"POST",body:form,signal:controller.signal }).then(async response => {
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message ?? "正文提取失败，可手动填写摘要后保存原件。");
      if (!controller.signal.aborted) { setSourceText(payload.data.text); setSummary(payload.data.text.slice(0,1000)); }
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "正文提取失败，可手动填写摘要。"); }).finally(() => { if (!controller.signal.aborted) setBusy(null); });
    return () => controller.abort();
  },[file]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (busy) return; setBusy("save"); setError(null);
    const body = JSON.stringify({ companyName,track,summary,investorNames,sourceText });
    if (retry.current?.body !== body) retry.current = { body,key:crypto.randomUUID() };
    const form = new FormData(); form.set("file",file); form.set("data",body);
    try {
      const response = await fetch("/api/v1/candidates",{ method:"POST",headers:{ "idempotency-key":retry.current.key },body:form });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message ?? "资料保存失败，请重试。");
      onSaved(payload.data);
    } catch (error) { setError(error instanceof Error ? error.message : "资料保存失败，请重试。"); }
    finally { setBusy(null); }
  }
  return <Sheet open onOpenChange={(open) => { if (!open && busy !== "save") onClose(); }}><SheetContent showCloseButton={false} className="overflow-y-auto p-5 data-[side=right]:sm:max-w-xl"><SheetHeader><SheetTitle>确认导入线索</SheetTitle><SheetDescription>本地提取正文，核对后保存线索及原始文件。不会调用外部 AI 或发送资料。</SheetDescription></SheetHeader>
    <p className="break-all text-sm">{file.name} · {(file.size/1024).toFixed(1)} KB</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {busy === "extract" && <p role="status">正在本地提取正文…</p>}
    <form onSubmit={save} className="grid gap-4">
      <label className="grid gap-1 text-sm">项目名称<input required maxLength={200} className="rounded border p-2" value={companyName} onChange={event=>setCompanyName(event.target.value)} /></label>
      <label className="grid gap-1 text-sm">线索赛道<select className="rounded border p-2" value={track} onChange={event=>setTrack(event.target.value)}>{TRACKS.map(track=><option key={track}>{track}</option>)}</select></label>
      <label className="grid gap-1 text-sm">线索摘要<textarea required maxLength={8000} rows={6} className="rounded border p-2" value={summary} onChange={event=>setSummary(event.target.value)} /></label>
      <label className="grid gap-1 text-sm">已投机构（选填）<input maxLength={1000} className="rounded border p-2" placeholder="多个机构用顿号分隔" value={investorNames} onChange={event=>setInvestorNames(event.target.value)} /></label>
      {sourceText && <details><summary className="cursor-pointer text-sm">查看提取正文</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs">{sourceText}</pre></details>}
      <div className="flex gap-2"><Button type="submit" disabled={busy!==null || !summary.trim() || !companyName.trim()}>{busy === "save" ? "正在保存" : "确认线索并保存"}</Button><Button type="button" kind="secondary" disabled={busy === "save"} onClick={onClose}>取消导入</Button></div>
    </form>
  </SheetContent></Sheet>;
}
