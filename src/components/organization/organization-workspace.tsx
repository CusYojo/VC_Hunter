"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Search, UsersRound } from "lucide-react";
import type { Department, Directory, Member, PublicDirectory, PublicMember } from "@/organization/contracts";
import { Button } from "@/components/ui/button";
import { fieldClass, organizationRequest } from "./api";
import { MemberEditor, roleLabels } from "./member-editor";
import { DepartmentEditor } from "./department-editor";

type OrganizationData = PublicDirectory | Directory;
function DepartmentTree({ departments, selected, onSelect, parentId = null, path = [] }: { departments: Department[]; selected: string; onSelect: (id: string) => void; parentId?: string | null; path?: string[] }) {
  return <ul className={parentId ? "ml-3 border-l border-border pl-2" : "grid gap-1"}>
    {departments.filter((department) => department.parentId === parentId && !path.includes(department.id)).map((department) => <li key={department.id}>
      <button type="button" aria-pressed={selected === department.id} onClick={() => onSelect(department.id)} className={`flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${selected === department.id ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"}`}><Building2 className="size-4 shrink-0" aria-hidden="true" /><span className="break-words">{department.name}</span></button>
      <DepartmentTree departments={departments} selected={selected} onSelect={onSelect} parentId={department.id} path={[...path, department.id]} />
    </li>)}
  </ul>;
}

function MemberCard({ member, mode, onEdit, editing }: { member: PublicMember | Member; mode: "public" | "admin"; onEdit: (member: Member) => void; editing: boolean }) {
  const adminMember = mode === "admin" && "accountId" in member ? member : null;
  return <article className="min-w-0 rounded-lg border border-border bg-background/50 p-4">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words text-sm font-semibold">{member.name}</h3><p className="mt-1 break-words text-sm text-muted-foreground">{member.title || "职务待补充"}</p></div>{adminMember && <Button type="button" variant="outline" className="min-h-11" disabled={editing} aria-label={`编辑${member.name}`} onClick={() => onEdit(adminMember)}>编辑</Button>}</div>
    <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">{member.isPlaceholder ? <span className="rounded border border-border px-2 py-1">占位 · 未开户</span> : !member.active ? <span className="rounded border border-border px-2 py-1">已停用</span> : null}{adminMember && !member.isPlaceholder && <span className="rounded border border-border px-2 py-1">{adminMember.accountId ? `账号：${adminMember.username || "已关联"}` : "未开户"}</span>}</div>
    {adminMember && <dl className="mt-3 grid grid-cols-[3rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-sm"><dt className="text-muted-foreground">手机</dt><dd className="break-all">{adminMember.phone || "未填写"}</dd><dt className="text-muted-foreground">邮箱</dt><dd className="break-all">{adminMember.email || "未填写"}</dd><dt className="text-muted-foreground">微信</dt><dd className="break-all">{adminMember.wechat || "未填写"}</dd><dt className="text-muted-foreground">权限</dt><dd className="break-words">{adminMember.accountId ? adminMember.roles.map((role) => roleLabels[role]).join("、") : "未开户，未授予登录权限"}</dd></dl>}
  </article>;
}

export function OrganizationWorkspace({ mode, currentAccountId }: { mode: "public" | "admin"; currentAccountId?: string }) {
  const [data, setData] = useState<OrganizationData | null>(null);
  const [query, setQuery] = useState(""); const [departmentId, setDepartmentId] = useState("");
  const [error, setError] = useState(""); const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState("");
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [editingDepartment, setEditingDepartment] = useState<Department | null | undefined>(undefined);
  const editing = Boolean(editingMember) || editingDepartment !== undefined;
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    organizationRequest<OrganizationData>(mode === "admin" ? "/api/v1/admin/organization" : "/api/v1/organization", { signal: controller.signal })
      .then((directory) => { if (active) { setData(directory); setError(""); } })
      .catch((error) => { if (active) setError(error instanceof Error ? error.message : "加载失败，请稍后重试。"); });
    return () => { active = false; controller.abort(); };
  }, [mode, reload]);
  function refresh() { setData(null); setError(""); setEditingMember(null); setEditingDepartment(undefined); setNotice(""); setReload((value) => value + 1); }
  function editMember(member: Member) { setEditingDepartment(undefined); setEditingMember(member); setNotice(""); }
  function editDepartment(department: Department | null) { setEditingMember(null); setEditingDepartment(department); setNotice(""); }
  function saveMember(member: Member) { setData((current) => current ? { ...current, members: current.members.map((item) => item.id === member.id ? member : item) } : current); setEditingMember(null); setNotice("成员信息已保存"); }
  function saveDepartment(department: Department) { setData((current) => current ? { ...current, departments: current.departments.some((item) => item.id === department.id) ? current.departments.map((item) => item.id === department.id ? department : item) : [...current.departments, department] } : current); setEditingDepartment(undefined); setNotice("部门信息已保存"); }
  const departments = [...(data?.departments ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-CN"));
  const search = query.trim().toLocaleLowerCase();
  const members = (data?.members ?? []).filter((member) => (!search || `${member.name} ${member.title}`.toLocaleLowerCase().includes(search)) && (!departmentId || (departmentId === "unassigned" ? !member.departmentId : member.departmentId === departmentId)));
  const groups = [...departments.map((department) => ({ id: department.id, department })), ...(data?.members.some((member) => !member.departmentId) ? [{ id: "unassigned", department: null }] : [])];
  const visibleGroups = groups.filter((group) => (!departmentId || departmentId === group.id) && (!search || members.some((member) => (member.departmentId ?? "unassigned") === group.id)));
  return <div className="mx-auto grid max-w-[100rem] gap-5 p-4 md:p-6 lg:p-8">
    {mode === "public" && <nav aria-label="组织工作空间" className="flex gap-2"><span className="rounded-lg bg-accent px-4 py-3 text-sm font-medium">人员目录</span><Link href="/organization/office" className="rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium hover:bg-muted">团队办公室 <span className="ml-1 text-xs text-muted-foreground">像素 / 项目视图</span></Link></nav>}
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">{mode === "admin" ? "人员管理" : "组织架构"}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{mode === "admin" ? "维护人员档案、部门归属与账号权限。职务不自动授予权限。" : "按部门查看团队成员。部门归属不代表个人汇报关系；未展开的单位名单待补充。"}</p></div>{mode === "admin" && data && <Button type="button" className="min-h-11" disabled={editing} onClick={() => editDepartment(null)}>新增部门</Button>}</header>
    {notice && <p role="status" className="rounded-lg border border-primary/20 bg-accent px-4 py-3 text-sm text-accent-foreground">{notice}</p>}
    {error && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/25 bg-card p-4 text-sm text-destructive"><span>{error}</span><Button type="button" variant="outline" className="min-h-11" onClick={refresh}>重试</Button></div>}
    {!data && !error && <p role="status" className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">正在加载组织资料…</p>}
    {data && <>
      <div className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,15rem)]"><label className="grid gap-1.5 text-sm font-medium"><span className="flex items-center gap-2"><Search className="size-4" aria-hidden="true" />搜索姓名或职务</span><input className={fieldClass} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入姓名或职务" /></label><label className="grid gap-1.5 text-sm font-medium">按部门筛选<select className={fieldClass} value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}><option value="">全部部门</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}<option value="unassigned">未分组</option></select></label></div>
      {editingMember && <MemberEditor key={editingMember.id} member={editingMember} departments={departments} currentAccountId={currentAccountId} onSaved={saveMember} onCancel={() => setEditingMember(null)} onReload={refresh} />}
      {editingDepartment !== undefined && <DepartmentEditor key={editingDepartment?.id ?? "new"} department={editingDepartment} departments={departments} onSaved={saveDepartment} onCancel={() => setEditingDepartment(undefined)} onReload={refresh} />}
      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="min-w-0 rounded-lg border border-border bg-card p-3"><h2 className="px-3 py-2 text-sm font-semibold">部门结构</h2><nav aria-label="部门结构"><button type="button" aria-pressed={!departmentId} className={`mb-1 flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm ${!departmentId ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`} onClick={() => setDepartmentId("")}><UsersRound className="size-4" aria-hidden="true" />全部成员</button><DepartmentTree departments={departments} selected={departmentId} onSelect={setDepartmentId} />{data.members.some((member) => !member.departmentId) && <button type="button" className="min-h-11 w-full rounded-lg px-3 text-left text-sm hover:bg-muted" onClick={() => setDepartmentId("unassigned")}>未分组</button>}</nav></aside>
        <div className="grid min-w-0 gap-4"><p className="text-sm text-muted-foreground">{departments.length} 个部门 · 当前匹配 {members.length} 条人员档案</p>
          {!members.length && <p className="rounded-lg border border-dashed bg-card p-6 text-sm text-muted-foreground">没有匹配的成员</p>}
          {visibleGroups.map(({ id, department }) => {
            const groupMembers = members.filter((member) => (member.departmentId ?? "unassigned") === id);
            const knownCount = data.members.filter((member) => member.departmentId === id && member.active && !member.isPlaceholder).length;
            const missing = Math.max(0, (department?.expectedHeadcount ?? 0) - knownCount);
            return <section key={id} aria-label={department?.name ?? "未分组"} className="min-w-0 rounded-lg border border-border bg-card p-4 sm:p-5"><div className="mb-4 flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words text-base font-semibold">{department?.name ?? "未分组"}</h2>{department?.parentId && <p className="mt-1 text-xs text-muted-foreground">上级部门：{departments.find((item) => item.id === department.parentId)?.name ?? "待补充"}</p>}{department?.expectedHeadcount !== null && department?.expectedHeadcount !== undefined && <p className="mt-2 text-sm text-muted-foreground">预计 {department.expectedHeadcount} 人 · 已录入 {knownCount} 人{missing > 0 ? ` · 仍有 ${missing} 人待补` : ""}</p>}{department?.notes && <p className="mt-2 break-words text-sm text-muted-foreground">{department.notes}</p>}</div>{mode === "admin" && department && <Button className="min-h-11" type="button" variant="ghost" disabled={editing} aria-label={`编辑${department.name}部门`} onClick={() => editDepartment(department)}>编辑部门</Button>}</div><div className="grid gap-3 xl:grid-cols-2">{groupMembers.map((member) => <MemberCard key={member.id} member={member} mode={mode} onEdit={editMember} editing={editing} />)}</div>{!groupMembers.length && <p className="text-sm text-muted-foreground">成员名单待补充</p>}</section>;
          })}
        </div>
      </div>
    </>}
  </div>;
}
