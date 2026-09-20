"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { TRACKS } from "@/domain/projects";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CandidateView } from "@/workbench/candidate-details";

export function CandidateAdminEditor({ candidate, onUpdated }: { candidate: CandidateView; onUpdated: (candidate: CandidateView) => void }) {
  const [open, setOpen] = useState(false);
  if (candidate.status === "promoted") return candidate.projectId ? <Link className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm text-primary hover:underline" href={`/projects/${candidate.projectId}`}><Pencil className="size-4" aria-hidden="true" />在正式项目中编辑</Link> : null;
  return <><Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => setOpen(true)}><Pencil aria-hidden="true" />编辑项目信息</Button>{open && <Editor candidate={candidate} onUpdated={onUpdated} onClose={() => setOpen(false)} />}</>;
}
function Editor({ candidate, onUpdated, onClose }: { candidate: CandidateView; onUpdated: (candidate: CandidateView) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const pending = useRef(false); const retry = useRef<{ body: string; key: string } | null>(null);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending.current) return;
    const form = new FormData(event.currentTarget);
    const body = JSON.stringify({ expectedVersion: candidate.version, companyName: String(form.get("companyName")), track: String(form.get("track")), summary: String(form.get("summary")), investorNames: String(form.get("investorNames")).split(/[、,，;；\n]/).map(value => value.trim()).filter(Boolean), eventDate: form.get("eventDate") || null, round: String(form.get("round")).trim() || null, amountText: String(form.get("amountText")).trim() || null });
    if (retry.current?.body !== body) retry.current = { body, key: crypto.randomUUID() };
    pending.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/v1/candidates/${encodeURIComponent(candidate.id)}`, { method: "PATCH", headers: { "content-type": "application/json", "idempotency-key": retry.current.key }, body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "保存失败，请稍后重试。");
      onUpdated(payload.data); onClose();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "保存失败，请检查网络。"); }
    finally { pending.current = false; setBusy(false); }
  }
  const field = "mt-1 min-h-11 w-full rounded-lg border bg-background px-3 py-2 text-sm";
  return <Dialog open onOpenChange={value => { if (!value && !busy) onClose(); }}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl" showCloseButton={!busy}>
    <DialogHeader><DialogTitle>编辑项目 · {candidate.companyName}</DialogTitle><DialogDescription>更新待查看项目的基础信息；原始资料会继续保留。</DialogDescription></DialogHeader>
    <form onSubmit={save} className="space-y-4"><fieldset disabled={busy} className="grid min-w-0 gap-3">
      <label className="text-sm">项目名称<input name="companyName" className={field} required maxLength={200} defaultValue={candidate.companyName} /></label>
      <label className="text-sm">项目赛道<select name="track" className={field} defaultValue={TRACKS.includes(candidate.track as never) ? candidate.track : "待分类"}>{[...TRACKS,"待分类"].map(track => <option key={track} value={track}>{track}</option>)}</select></label>
      <label className="text-sm">项目摘要<textarea name="summary" className={field} required rows={5} maxLength={8000} defaultValue={candidate.summary} /></label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">融资日期<input name="eventDate" type="date" className={field} defaultValue={candidate.eventDate ?? ""} /></label><label className="text-sm">融资轮次<input name="round" className={field} maxLength={120} defaultValue={candidate.round ?? ""} /></label></div>
      <label className="text-sm">融资金额<input name="amountText" className={field} maxLength={200} defaultValue={candidate.amountText ?? ""} placeholder="如：数千万元；未披露可留空" /></label>
      <label className="text-sm">投资方<textarea name="investorNames" className={field} rows={2} maxLength={20000} defaultValue={candidate.investorNames.join("、")} placeholder="多个机构用顿号、逗号或换行分隔" /></label>
      <p className="text-xs text-muted-foreground">新增项目资料可在入库后上传至项目知识库。</p>
    </fieldset>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={onClose}>取消</Button><Button type="submit" disabled={busy}>{busy ? "保存中…" : "保存项目内容"}</Button></DialogFooter></form>
  </DialogContent></Dialog>;
}
