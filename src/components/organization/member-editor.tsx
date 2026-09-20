"use client";

import { useRef, useState, type FormEvent } from "react";
import type { Department, Member } from "@/organization/contracts";
import { ORGANIZATION_ROLE_VALUES, type OrganizationRole } from "@/security/roles";
import { Button } from "@/components/ui/button";
import { fieldClass, OrganizationRequestError, organizationWrite } from "./api";

export const roleLabels: Record<OrganizationRole, string> = { org_admin: "组织管理员", investment_manager: "投资经理", researcher: "研究员", compliance_reviewer: "合规审核", viewer: "只读成员" };

export function MemberEditor({ member, departments, currentAccountId, onSaved, onCancel, onReload }: {
  member: Member; departments: Department[]; currentAccountId?: string;
  onSaved: (member: Member) => void; onCancel: () => void; onReload: () => void;
}) {
  const [draft, setDraft] = useState(() => ({ name: member.name, title: member.title, departmentId: member.departmentId, phone: member.phone, email: member.email, wechat: member.wechat, roles: [...member.roles], active: member.active }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const pending = useRef(false);
  const self = Boolean(currentAccountId && member.accountId === currentAccountId);
  const lockPermissions = self || !member.accountId || member.isPlaceholder;
  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending.current || conflict) return;
    if (!draft.name.trim() || (member.accountId && !draft.roles.length)) { setError("请填写姓名，并至少保留一种权限。"); return; }
    pending.current = true; setSaving(true); setError("");
    try {
      const changes = Object.fromEntries(Object.entries(draft).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(member[key as keyof Member])));
      const result = await organizationWrite<Member>(`/api/v1/admin/members/${encodeURIComponent(member.id)}`, "PATCH", { ...changes, expectedVersion: member.version });
      onSaved(result);
    } catch (error) {
      setError(error instanceof Error ? error.message : "保存失败，请稍后重试。");
      setConflict(error instanceof OrganizationRequestError && error.status === 409);
    } finally { pending.current = false; setSaving(false); }
  }
  return <form aria-label="编辑成员" className="grid gap-5 rounded-lg border border-primary/30 bg-card p-5" onSubmit={save}>
    <div><h2 className="text-base font-semibold">编辑成员 · {member.name}</h2><p className="mt-1 text-sm text-muted-foreground">修改会保存到组织档案。联系方式仅管理员可见。</p></div>
    <fieldset disabled={saving} className="grid min-w-0 gap-4 sm:grid-cols-2">
      {([ ["name", "姓名"], ["title", "职务"], ["phone", "手机"], ["email", "邮箱"], ["wechat", "微信"] ] as const).map(([key, label]) => <label key={key} className="grid gap-1.5 text-sm font-medium">{label}<input className={fieldClass} autoFocus={key === "name"} type={key === "email" ? "email" : key === "phone" ? "tel" : "text"} maxLength={key === "email" ? 254 : 100} required={key === "name"} value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /></label>)}
      <label className="grid gap-1.5 text-sm font-medium">所属部门<select className={fieldClass} value={draft.departmentId ?? ""} onChange={(event) => setDraft({ ...draft, departmentId: event.target.value || null })}><option value="">未分组</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
    </fieldset>
    <fieldset disabled={saving || lockPermissions} className="grid gap-2"><legend className="mb-2 text-sm font-semibold">账号权限</legend><div className="flex flex-wrap gap-x-5 gap-y-1">{ORGANIZATION_ROLE_VALUES.map((role) => <label key={role} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" disabled={saving || lockPermissions} checked={draft.roles.includes(role)} onChange={(event) => setDraft({ ...draft, roles: event.target.checked ? [...draft.roles, role] : draft.roles.filter((item) => item !== role) })} />{roleLabels[role]}</label>)}</div></fieldset>
    <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={draft.active} disabled={saving || lockPermissions} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />启用成员</label>
    {self && <p className="text-sm text-muted-foreground">不能在此修改自己的权限或停用自己，请由其他管理员操作。</p>}
    {!member.accountId && <p className="text-sm text-muted-foreground">该档案尚未开户；当前只编辑组织资料，不授予登录权限。</p>}
    {member.sourceNotes && <p className="break-words text-sm text-muted-foreground">资料备注：{member.sourceNotes}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-2"><Button className="min-h-11" type="submit" disabled={saving || conflict}>{saving ? "正在保存…" : "保存成员"}</Button><Button className="min-h-11" type="button" variant="outline" disabled={saving} onClick={onCancel}>取消编辑</Button>{conflict && <Button type="button" variant="outline" className="min-h-11" onClick={onReload}>放弃修改并重新载入</Button>}</div>
  </form>;
}
