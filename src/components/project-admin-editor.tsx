"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TRACK_VALUES } from "@/domain/types";
import type { ProjectDetail } from "@/repositories/projects";

const statuses = { new: "新项目", researching: "研究中", contacting: "接触中", dd: "尽调中", ic: "投委会", pass: "暂不跟进", invested: "已投", exited: "已退出" };
const signalTypes: Record<string, string> = { manual: "人工录入", funding: "融资进展", product: "产品进展", partnership: "战略合作", policy: "政策变化" };
const fieldClass = "mt-1 min-h-11 w-full rounded-lg border bg-background px-3 py-2 text-sm";

/** Render this control only after the page has checked the org_admin role. */
export function ProjectAdminEditor({ project, className }: { project?: ProjectDetail; className?: string }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  return <>
    <Button type="button" variant="outline" className={className} onClick={() => setOpen(true)}>{project ? <Pencil aria-hidden="true" /> : <Plus aria-hidden="true" />}{project ? "编辑项目内容" : "新建项目"}</Button>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" showCloseButton={!busy}><DialogHeader><DialogTitle>{project ? "编辑项目内容" : "新建项目"}</DialogTitle><DialogDescription>管理员维护项目内容并保留修改历史。保存后可在项目工作区上传资料、查看原文件和批注。</DialogDescription></DialogHeader>{open && <AdminProjectForm key={project ? `${project.id}:${project.version}` : "new"} project={project} setBusy={setBusy} onSaved={() => setOpen(false)} />}</DialogContent></Dialog>
  </>;
}

function AdminProjectForm({ project, setBusy, onSaved }: { project?: ProjectDetail; setBusy: (value: boolean) => void; onSaved: () => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState({ name: project?.name ?? "", legalName: "", track: project?.track ?? TRACK_VALUES[0], subtrack: project?.subtrack ?? "", executiveSummary: project?.executiveSummary ?? "", technologyStage: project?.technologyStage ?? "", discoveryReason: project?.whyNow ?? "", status: project?.status ?? "new", signalType: project?.signalType ?? "manual", riskFlags: project?.riskFlags?.join("\n") ?? "", openQuestions: project?.openQuestions?.join("\n") ?? "" });
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const pending = useRef(false), retry = useRef<{ body: string; key: string } | null>(null);
  const change = (field: keyof typeof draft, value: string) => setDraft(previous => ({ ...previous, [field]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending.current) return;
    const { legalName, ...content } = draft;
    const body = JSON.stringify({ ...content, name: draft.name.trim(), riskFlags: draft.riskFlags.split("\n").map(value => value.trim()).filter(Boolean), openQuestions: draft.openQuestions.split("\n").map(value => value.trim()).filter(Boolean), ...(project ? { expectedVersion: project.version } : legalName.trim() ? { legalName: legalName.trim() } : {}) });
    if (retry.current?.body !== body) retry.current = { body, key: crypto.randomUUID() };
    pending.current = true; setSaving(true); setBusy(true); setError("");
    try {
      const response = await fetch(`/api/v1/projects${project ? `/${encodeURIComponent(project.id)}` : ""}`, { method: project ? "PATCH" : "POST", headers: { "content-type": "application/json", "idempotency-key": retry.current.key }, body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "保存失败，请重试。");
      onSaved();
      if (!project) router.push(`/projects/${encodeURIComponent(result.data.id)}`);
      router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "保存失败，请重试。"); }
    finally { pending.current = false; setSaving(false); setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-4">
    {error && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
    <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-medium sm:col-span-2">项目名称<input className={fieldClass} required maxLength={200} value={draft.name} onChange={event => change("name", event.target.value)} /></label>
      {!project && <label className="text-sm font-medium sm:col-span-2">公司全称（可选）<input className={fieldClass} maxLength={200} value={draft.legalName} onChange={event => change("legalName", event.target.value)} placeholder="未填写时使用项目名称" /></label>}
      <label className="text-sm font-medium">赛道<select className={fieldClass} value={draft.track} onChange={event => change("track", event.target.value)}>{TRACK_VALUES.map(track => <option key={track}>{track}</option>)}</select></label>
      <label className="text-sm font-medium">细分方向<input className={fieldClass} maxLength={200} value={draft.subtrack} onChange={event => change("subtrack", event.target.value)} /></label>
      <label className="text-sm font-medium">项目状态<select className={fieldClass} value={draft.status} onChange={event => change("status", event.target.value)}>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-sm font-medium">技术阶段<input className={fieldClass} maxLength={200} value={draft.technologyStage} onChange={event => change("technologyStage", event.target.value)} /></label>
      <label className="text-sm font-medium sm:col-span-2">项目简介<textarea className={`${fieldClass} min-h-28`} maxLength={10000} value={draft.executiveSummary} onChange={event => change("executiveSummary", event.target.value)} placeholder="项目背景、技术、产品及融资说明" /></label>
      <label className="text-sm font-medium sm:col-span-2">关注原因<textarea className={`${fieldClass} min-h-20`} maxLength={4000} value={draft.discoveryReason} onChange={event => change("discoveryReason", event.target.value)} /></label>
      <label className="text-sm font-medium sm:col-span-2">信号类型<select className={fieldClass} value={draft.signalType} onChange={event => change("signalType", event.target.value)}>{!signalTypes[draft.signalType] && <option value={draft.signalType}>原信号类型</option>}{Object.entries(signalTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-sm font-medium sm:col-span-2">风险事项（每行一项）<textarea className={`${fieldClass} min-h-20`} maxLength={50000} value={draft.riskFlags} onChange={event => change("riskFlags", event.target.value)} /></label>
      <label className="text-sm font-medium sm:col-span-2">待核验事项（每行一项）<textarea className={`${fieldClass} min-h-20`} maxLength={50000} value={draft.openQuestions} onChange={event => change("openQuestions", event.target.value)} /></label>
      <Button type="submit" disabled={saving} className="min-h-11 sm:col-span-2">{saving ? "正在保存…" : "保存项目"}</Button>
    </fieldset>
  </form>;
}
