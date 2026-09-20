"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Save } from "lucide-react";
import type { InvestorDetail } from "@/repositories/investor-directory";
import { investorUpdateSchema } from "@/workbench/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { INSTITUTION_LABELS, INVESTOR_PRIORITY_LABELS, INVESTOR_STATUS_LABELS, publicSourceUrl } from "./investor-fields";

function formValues(investor: InvestorDetail) {
  return { name: investor.name, englishName: investor.englishName || "", headquarters: investor.headquarters || "",
    institutionType: investor.institutionType as string, priority: String(investor.priority), status: investor.status as string,
    stageFocus: investor.stageFocus.join("、"), subtracks: investor.subtracks.join("、"), investmentStyle: investor.investmentStyle || "",
    thesis: investor.thesis || "", notes: investor.notes, fundText: investor.fundSize?.text || "",
    sourceRefs: investor.sourceRefs.join("\n"), keyPeople: investor.keyPeople.map((person) => `${person.name}${person.title ? ` | ${person.title}` : ""}`).join("\n"),
  };
}
type FormValues = ReturnType<typeof formValues>;
const fields: { key: keyof FormValues; label: string; max: number; multiline?: boolean; help?: string }[] = [
  { key: "name", label: "机构名称", max: 120 }, { key: "englishName", label: "英文名称", max: 120 },
  { key: "headquarters", label: "主要地区", max: 80 }, { key: "fundText", label: "公开管理规模 / 体系规模", max: 200, help: "保留披露口径；修改后不推算金额或币种。" },
  { key: "stageFocus", label: "投资阶段", max: 300, help: "多个阶段用顿号分隔。" }, { key: "subtracks", label: "细分方向", max: 1800, help: "多个方向用顿号分隔。" },
  { key: "investmentStyle", label: "投资风格", max: 500, multiline: true }, { key: "thesis", label: "投资逻辑", max: 2000, multiline: true },
  { key: "keyPeople", label: "核心成员与合伙人", max: 4800, multiline: true, help: "每行一人，格式：姓名 | 职务。保留未修改成员的关注赛道。" },
  { key: "sourceRefs", label: "来源链接", max: 30000, multiline: true, help: "每行一条完整的 http / https 链接，不用斜杠拆分。" },
  { key: "notes", label: "备注", max: 4000, multiline: true },
];
const splitItems = (value: string) => value.split(/[、，,\n]/).map((item) => item.trim()).filter(Boolean);

function changedFields(values: FormValues, investor: InvestorDetail): Record<string, unknown> {
  const previous = formValues(investor);
  return Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== previous[key as keyof FormValues]).map(([key, value]) => {
    if (key === "priority") return [key, Number(value)];
    if (key === "stageFocus" || key === "subtracks") return [key, splitItems(value)];
    if (key === "fundText") return ["fundSize", value.trim() ? { amount: null, currency: null, text: value.trim(), source: investor.fundSize?.source ?? null } : null];
    if (key === "sourceRefs") {
      const sources = value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
      if (sources.some((source) => !publicSourceUrl(source))) throw new Error("来源链接必须是完整的 http / https 地址，每行一条。");
      return [key, sources];
    }
    if (key === "keyPeople") return [key, value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).map((item) => {
      const [name, ...title] = item.split("|").map((part) => part.trim());
      const existing = investor.keyPeople.find((person) => person.name === name);
      return { ...(existing ?? {}), name, title: title.join(" | ") || null };
    })];
    return [key, ["englishName", "headquarters", "investmentStyle", "thesis"].includes(key) ? value.trim() || null : value.trim()];
  }));
}

export function InvestorProfileEditor({ investor }: { investor: InvestorDetail }) {
  const router = useRouter();
  const [current, setCurrent] = useState(investor);
  const [values, setValues] = useState(() => formValues(investor));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const change = (key: keyof FormValues, value: string) => setValues((previous) => ({ ...previous, [key]: value }));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSaved(false);
    try {
      const patch = changedFields(values, current);
      if (!Object.keys(patch).length) { setError("尚未修改档案。"); return; }
      const parsed = investorUpdateSchema.safeParse({ ...patch, expectedVersion: current.version });
      if (!parsed.success) { setError(`请检查表单：${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("；")}`); return; }
      setBusy(true);
      const response = await fetch(`/api/v1/investors/${encodeURIComponent(current.id)}`, { method: "PATCH", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(parsed.data) });
      const payload = await response.json();
      if (response.status === 409) throw new Error("档案已被他人更新，请刷新页面后核对再保存。本次输入已保留。");
      if (!response.ok) throw new Error(payload.error?.message ?? "保存失败，请稍后重试。");
      if (!payload.data || typeof payload.data.version !== "number") throw new Error("保存响应异常，请刷新页面核对。");
      setCurrent(payload.data); setValues(formValues(payload.data)); setEditing(false); setSaved(true); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败，请稍后重试。"); }
    finally { setBusy(false); }
  }

  return <div className="rounded-lg border border-border bg-card p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">维护机构档案、公开信息和跟进备注，不会自动新建项目或启动监控。</p><Button variant="outline" className="min-h-11" aria-expanded={editing} aria-controls="institution-edit-form" disabled={busy} onClick={() => { setEditing((value) => !value); setError(""); setSaved(false); }}><Pencil className="size-4" aria-hidden="true" />{editing ? "收起编辑" : "编辑机构档案"}</Button></div>
    {saved && <p role="status" className="mt-3 text-sm text-primary">机构档案已保存。</p>}
    {editing && <form id="institution-edit-form" className="mt-5 border-t border-border pt-5" onSubmit={save}>
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-4 text-sm font-medium">编辑机构档案 · v{current.version}</legend>
        {fields.map((field) => <div key={field.key} className={`grid content-start gap-1.5 ${field.key === "notes" ? "sm:col-span-2" : ""}`}><label htmlFor={`institution-${field.key}`} className="text-sm font-medium">{field.label}</label>{field.multiline ? <Textarea id={`institution-${field.key}`} rows={3} maxLength={field.max} value={values[field.key]} onChange={(event) => change(field.key, event.target.value)} aria-describedby={field.help ? `institution-${field.key}-hint` : undefined} /> : <Input className="min-h-11" id={`institution-${field.key}`} maxLength={field.max} required={field.key === "name"} value={values[field.key]} onChange={(event) => change(field.key, event.target.value)} aria-describedby={field.help ? `institution-${field.key}-hint` : undefined} />}{field.help && <p id={`institution-${field.key}-hint`} className="text-xs leading-5 text-muted-foreground">{field.help}</p>}</div>)}
        {([{ key: "institutionType", label: "机构类型", options: INSTITUTION_LABELS }, { key: "priority", label: "活跃优先级", options: INVESTOR_PRIORITY_LABELS }, { key: "status", label: "档案状态", options: INVESTOR_STATUS_LABELS }] as const).map((field) => <div key={field.key} className="grid gap-1.5"><label htmlFor={`institution-${field.key}`} className="text-sm font-medium">{field.label}</label><select id={`institution-${field.key}`} className="min-h-11 rounded-lg border border-input bg-card px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring" value={values[field.key]} onChange={(event) => change(field.key, event.target.value)}>{Object.entries(field.options).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>)}
      </fieldset>
      {error && <p role="alert" className="mt-4 rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      <div className="mt-5 flex flex-wrap gap-2"><Button className="min-h-11" type="submit" disabled={busy}><Save className="size-4" aria-hidden="true" />{busy ? "保存中…" : "保存档案"}</Button><Button variant="outline" className="min-h-11" type="button" disabled={busy} onClick={() => { setValues(formValues(current)); setEditing(false); setError(""); }}>取消修改</Button></div>
    </form>}
  </div>;
}
