"use client";

import { useRef, useState, type FormEvent } from "react";
import type { Department } from "@/organization/contracts";
import { Button } from "@/components/ui/button";
import { fieldClass, OrganizationRequestError, organizationWrite } from "./api";

function isDescendant(item: Department, ancestor: string, departments: Department[]): boolean {
  const visited = new Set<string>();
  let current: Department | undefined = item;
  while (current && !visited.has(current.id)) {
    if (current.id === ancestor) return true;
    visited.add(current.id);
    current = departments.find((department) => department.id === current?.parentId);
  }
  return false;
}

export function DepartmentEditor({ department, departments, onSaved, onCancel, onReload }: { department: Department | null; departments: Department[]; onSaved: (department: Department) => void; onCancel: () => void; onReload: () => void }) {
  const [draft, setDraft] = useState({ name: department?.name ?? "", parentId: department?.parentId ?? "", expectedHeadcount: department?.expectedHeadcount?.toString() ?? "", notes: department?.notes ?? "", sortOrder: department?.sortOrder.toString() ?? "0" });
  const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [conflict, setConflict] = useState(false);
  const pending = useRef(false);
  async function save(event: FormEvent) {
    event.preventDefault(); if (pending.current || conflict) return;
    pending.current = true; setSaving(true); setError("");
    const input = { ...draft, parentId: draft.parentId || null, expectedHeadcount: draft.expectedHeadcount === "" ? null : Number(draft.expectedHeadcount), sortOrder: Number(draft.sortOrder), ...(department ? { expectedVersion: department.version } : {}) };
    try { onSaved(await organizationWrite<Department>(department ? `/api/v1/admin/departments/${encodeURIComponent(department.id)}` : "/api/v1/admin/departments", department ? "PATCH" : "POST", input)); }
    catch (error) { setError(error instanceof Error ? error.message : "保存失败，请稍后重试。"); setConflict(error instanceof OrganizationRequestError && error.status === 409); }
    finally { pending.current = false; setSaving(false); }
  }
  return <form aria-label="编辑部门" className="grid gap-4 rounded-lg border border-primary/30 bg-card p-5" onSubmit={save}>
    <h2 className="text-base font-semibold">{department ? "编辑部门" : "新增部门"}</h2>
    <fieldset disabled={saving} className="grid min-w-0 gap-4 sm:grid-cols-2">
      <label className="grid gap-1.5 text-sm font-medium">部门名称<input className={fieldClass} autoFocus value={draft.name} required maxLength={100} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label className="grid gap-1.5 text-sm font-medium">上级部门<select className={fieldClass} value={draft.parentId} onChange={(event) => setDraft({ ...draft, parentId: event.target.value })}><option value="">无上级部门</option>{departments.filter((item) => !department || !isDescendant(item, department.id, departments)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="grid gap-1.5 text-sm font-medium">预计人数<input className={fieldClass} type="number" min={0} max={10000} step={1} placeholder="未知可留空" value={draft.expectedHeadcount} onChange={(event) => setDraft({ ...draft, expectedHeadcount: event.target.value })} /></label>
      <label className="grid gap-1.5 text-sm font-medium">显示顺序<input className={fieldClass} type="number" min={0} max={100000} step={1} required value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value })} /></label>
      <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">部门备注<textarea className={fieldClass} maxLength={2000} rows={3} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
    </fieldset>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-2"><Button className="min-h-11" type="submit" disabled={saving || conflict}>{saving ? "正在保存…" : "保存部门"}</Button><Button className="min-h-11" type="button" variant="outline" disabled={saving} onClick={onCancel}>取消编辑</Button>{conflict && <Button className="min-h-11" type="button" variant="outline" onClick={onReload}>放弃修改并重新载入</Button>}</div>
  </form>;
}
