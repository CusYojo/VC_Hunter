"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Grid2X2, List, Move, Palette, Pause, Play, RefreshCw, Search, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { OfficeGroupingMode, OfficeMeeting, OfficeStyle, OfficeWorkspace as Workspace } from "@/organization/office-contracts";
import { organizationRequest, organizationWrite, fieldClass } from "../api";
import { OfficeScene } from "./office-scene";
import { LayoutEditor, MemberWork, TraditionalOffice } from "./office-details";
import { OfficeActivityRail } from "./office-activity-rail";
import { AvatarPanel } from "./avatar-panel";
import styles from "./office.module.css";

export function OfficeWorkspace() {
  const [data, setData] = useState<Workspace | null>(null);
  const [draft, setDraft] = useState<Workspace | null>(null);
  const [view, setView] = useState<"pixel" | "list">("pixel");
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [avatars, setAvatars] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [endingMeetingId, setEndingMeetingId] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const reload = useCallback(async (signal?: AbortSignal) => {
    try {
      const workspace = await organizationRequest<Workspace>("/api/v1/organization/office", { signal });
      if (signal?.aborted) return;
      setData(workspace); setError(""); setUpdatedAt(new Date());
    } catch (failure) { if (!signal?.aborted) setError(failure instanceof Error ? failure.message : "办公室暂时无法加载。"); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void reload(controller.signal);
      if (new URLSearchParams(window.location.search).get("tab") === "avatars") setAvatars(true);
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [reload]);
  useEffect(() => {
    if (draft || selected || avatars) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => void reload(controller.signal), 10_000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [draft, selected, avatars, reload]);

  function move(groupId: string, memberId: string, x: number, y: number) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > 31 || y < 0 || y > 127) return;
    setDraft(current => current ? { ...current, groups: current.groups.map(group => group.id === groupId ? { ...group, seats: group.seats.map(seat => seat.memberId === memberId ? { ...seat, x, y } : seat) } : group) } : current);
  }
  async function saveLayout() {
    if (!draft || !data || busy) return;
    setBusy(true); setError("");
    const seats = draft.groups.flatMap(group => group.seats.filter(seat => {
      const member = draft.members.find(item => item.id === seat.memberId);
      if (!member) return false;
      const department = draft.departments.find(item => item.id === member.departmentId);
      return draft.groupingMode === "project" && member.projects.length
        ? group.id === `project:${member.profile.displayedProjectId ?? member.projects[0].id}`
        : group.id === `department:${department?.id ?? "unassigned"}`;
    }).map(seat => ({ groupId: group.id, ...seat })));
    try {
      const next = await organizationWrite<Workspace>("/api/v1/admin/organization/office/layout", "PATCH", {
        expectedVersion: data.layoutVersion,
        departments: [],
        seats,
      });
      setData(next); setDraft(null); setNotice("办公室布局已保存");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "布局保存失败，请重试。"); }
    finally { setBusy(false); }
  }
  async function endMeeting(meeting: OfficeMeeting) {
    if (endingMeetingId || !meeting.canEnd || !meeting.version) return;
    setEndingMeetingId(meeting.id);setError("");
    try {
      await organizationWrite(`/api/v1/activity/${encodeURIComponent(meeting.id)}/complete-meeting`, "POST", { expectedVersion: meeting.version });
      await reload();setNotice("会议已结束，参会成员返回工位。");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "会议结束失败，请刷新后重试。"); }
    finally { setEndingMeetingId(null); }
  }
  async function changeGrouping(groupingMode: OfficeGroupingMode) {
    const self = data?.members.find(member => member.id === data.selfMemberId);
    if (!self || busy || data?.groupingMode === groupingMode) return;
    setBusy(true); setError("");
    try {
      const next = await organizationWrite<Workspace>("/api/v1/organization/office/profile", "PATCH", {
        expectedVersion: self.profile.version, groupingMode, displayedProjectId: self.profile.displayedProjectId,
        description: self.profile.description, presenceStatus: self.profile.presenceStatus, customStatus: self.profile.customStatus,
      });
      setData(next); setDraft(null); setNotice(groupingMode === "department" ? "已按部门显示" : "已按项目显示");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "分组方式保存失败，请重试。"); }
    finally { setBusy(false); }
  }
  function styleSaved(style: OfficeStyle) {
    setData(current => current ? { ...current, members: current.members.map(member => member.id === current.selfMemberId ? { ...member, style } : member) } : current);
    setNotice("工位外观已保存");
  }
  const workspace = draft ?? data;
  const search = query.trim().toLocaleLowerCase();
  const members = workspace?.members.filter(member => (!department || member.departmentId === department) && (!search || `${member.name} ${member.title} ${member.projects.map(project => project.name).join(" ")}`.toLocaleLowerCase().includes(search))) ?? [];
  const groups = workspace?.groups.map(group => ({ ...group, seats: group.seats.filter(seat => members.some(member => member.id === seat.memberId)) })).filter(group => group.seats.length > 0) ?? [];
  const selectedMember = data?.members.find(member => member.id === selected);
  const crossProject = members.filter(member => member.projects.length > 1).length;
  return <div className={styles.workspace}>
    <header className={styles.pageHeader}>
      <div><Link href="/organization" className={styles.back}><ArrowLeft size={14} />组织架构</Link><div className={styles.titleLine}><h1>团队办公室</h1><span>TEAM OFFICE</span></div><p>看看伙伴们正在推进什么，一起把事情做成。</p></div>
      <div className={styles.headerActions}>
        {data?.members.some(member => member.id === data.selfMemberId) && <Button variant="outline" onClick={() => setSelected(data.selfMemberId)}><Palette />我的工位</Button>}
        {data && <Button variant="outline" onClick={() => setAvatars(true)}>{data.canManage ? "形象与审核" : "我的像素形象"}</Button>}
        {data?.canManage && <Button variant={draft ? "default" : "outline"} onClick={() => { if (draft) setDraft(null); else { setDraft(data); setView("pixel"); setNotice(""); } }}><Move />{draft ? "退出布局编辑" : "调整布局"}</Button>}
      </div>
    </header>
    {error && <div className={styles.error} role="alert"><span>{error}</span><Button variant="outline" onClick={() => { if (draft) void saveLayout(); else void reload(); }}>重试</Button>{draft && <Button variant="outline" onClick={() => { setDraft(null); setError(""); void reload(); }}>放弃修改并载入最新布局</Button>}</div>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {!workspace && !error && <p className={styles.loading} role="status">正在打开办公室…</p>}
    {workspace && <>
      <div className={styles.toolbar}>
        <div className={styles.viewSwitch} aria-label="办公室视图"><button type="button" aria-pressed={view === "pixel"} onClick={() => setView("pixel")}><Grid2X2 size={16} />像素办公室</button><button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}><List size={16} />传统列表</button></div>
        <div className={styles.viewSwitch} aria-label="办公室分组方式"><button type="button" disabled={busy} aria-pressed={workspace.groupingMode === "department"} onClick={() => void changeGrouping("department")}>按部门</button><button type="button" disabled={busy} aria-pressed={workspace.groupingMode === "project"} onClick={() => void changeGrouping("project")}>按项目</button></div>
        <label className={styles.search}><Search size={16} /><input type="search" aria-label="搜索成员或项目" placeholder="搜索成员或项目" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <select className={fieldClass} aria-label="办公室部门筛选" value={department} onChange={event => setDepartment(event.target.value)}><option value="">全部部门</option>{workspace.departments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <Button variant="ghost" disabled={Boolean(draft) || busy} aria-label="刷新办公室" onClick={() => void reload()}><RefreshCw /></Button>
      </div>
      <div className={styles.officeMeta}><p><UsersRound size={15} /><strong>{members.length}</strong> 位伙伴<span>·</span><strong>{groups.length}</strong> 个工作小组<span>·</span><strong>{crossProject}</strong> 位跨项目协作</p>{view === "pixel" && <button type="button" onClick={() => setPaused(!paused)}>{paused ? <Play size={14} /> : <Pause size={14} />}{paused ? "恢复走动" : "暂停走动"}</button>}</div>
      {draft && <LayoutEditor data={draft} busy={busy} onMove={move} onSave={() => void saveLayout()} onCancel={() => setDraft(null)} />}
      <div className={styles.officeBody}><div className={styles.mapColumn}>
      {!groups.length ? <div className={styles.empty}><UsersRound size={32} /><h2>这里还没有匹配的工位</h2><p>{search || department ? "试试其他姓名、项目或部门。" : "录入部门成员，并为项目设置负责人后，就能在办公室看到大家。"}</p></div> : view === "pixel" ? <OfficeScene activity={workspace.activity} groups={groups} members={members} paused={paused} editing={Boolean(draft)} onMember={setSelected} onMove={move} /> : <TraditionalOffice groups={groups} members={members} onMember={setSelected} />}
      </div><OfficeActivityRail activity={workspace.activity} members={workspace.members} canManage={workspace.canManage} onEndMeeting={meeting => void endMeeting(meeting)} endingMeetingId={endingMeetingId ?? undefined} /></div>
      <footer className={styles.pageFooter}><p><span className={styles.legendDot} />虚线脚印表示待处理沟通；会议结束后回工位。动画按事项状态展示。</p><span>{updatedAt ? `最近同步 ${updatedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : ""}</span></footer>
    </>}
    <Dialog open={Boolean(selectedMember)} onOpenChange={open => { if (!open) setSelected(null); }}><DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>{selectedMember?.name}的工作</DialogTitle><DialogDescription>项目进度与当前可见事项</DialogDescription></DialogHeader>{selectedMember && <MemberWork key={selectedMember.id} member={selectedMember} isSelf={selectedMember.id === data?.selfMemberId} onStyleSaved={styleSaved} onProfileSaved={next => { setData(next); setNotice("个人展示已保存"); }} />}</DialogContent></Dialog>
    <Dialog open={avatars} onOpenChange={setAvatars}><DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>像素形象{data?.canManage ? "与审核" : ""}</DialogTitle><DialogDescription>提交自己的像素形象，审核通过后会展示在办公室。</DialogDescription></DialogHeader>{data && <AvatarPanel canManage={data.canManage} onUpdated={() => void reload()} />}</DialogContent></Dialog>
  </div>;
}
