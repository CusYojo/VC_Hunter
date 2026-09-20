"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { OfficeGroup, OfficeMember, OfficePresenceStatus, OfficeStyle, OfficeWorkspace } from "@/organization/office-contracts";
import { fieldClass, organizationWrite } from "../api";
import { PixelDesk } from "./pixel-art";
import styles from "./office.module.css";

const stageLabels: Record<string, string> = { new: "新入库", researching: "研究中", contacting: "接洽中", pass: "暂不推进", exited: "已退出", discovered: "新发现", screening: "初筛", watching: "观察中", contacted: "已接触", dd: "尽调中", ic: "投决中", invested: "已投资", rejected: "已终止", archived: "已归档", lead: "项目线索", active: "推进中" };
export function stageLabel(stage: string | null) { return stage ? stageLabels[stage] ?? stage : "部门协作"; }
export function progressLabel(progress: { done: number; total: number }) { return progress.total ? `完成节点 ${progress.done}/${progress.total}` : "尚未设置推进节点"; }
export function presenceLabel(member: OfficeMember) {
  if (member.profile.presenceStatus === "custom") return member.profile.customStatus;
  return ({ office: "在公司", away: "外出", trip: "出差中" } as const)[member.profile.presenceStatus];
}

export function TraditionalOffice({ groups, members, onMember }: { groups: OfficeGroup[]; members: OfficeMember[]; onMember: (id: string) => void }) {
  return <div className={styles.traditional}>{groups.map(group => <section key={group.id} className={styles.listGroup} aria-label={`${group.label}成员与进度`}>
    <header><div><span className={styles.eyebrow}>{group.kind === "project" ? "项目小组" : "部门工作区"}</span><h2>{group.projectId ? <Link href={`/projects/${encodeURIComponent(group.projectId)}`}>{group.label}</Link> : group.label}</h2></div><span className={styles.stage}>{stageLabel(group.stage)}</span></header>
    {group.kind === "project" && <div className={styles.progressRow}><span>{progressLabel(group.progress)}</span>{group.progress.total > 0 && <progress value={group.progress.done} max={group.progress.total} aria-label={`${group.label}节点完成情况`} />}</div>}
    {group.latestUpdate && <p className={styles.latest}>{group.latestUpdate.title} · {new Date(group.latestUpdate.at).toLocaleDateString("zh-CN")}</p>}
    <ul>{group.seats.map(seat => {
      const member = members.find(item => item.id === seat.memberId);
      if (!member) return null;
      const role = member.projects.find(project => project.id === group.projectId)?.role ?? member.title;
      const displayProject = member.projects.find(project => project.id === member.profile.displayedProjectId) ?? member.projects[0];
      return <li key={member.id}><div><button type="button" onClick={() => onMember(member.id)}>{member.name}</button><small>{role} · {member.departmentName}</small><span className={styles.presence}>{presenceLabel(member)}</span></div><div>{group.kind === "department" ? <><p>{member.profile.description || displayProject?.name || "暂无关联项目"}</p>{member.tasks.map(task => <p key={task.id} className={styles.taskText}>{task.title}</p>)}</> : <span>{member.profile.description || (member.projects.length > 1 ? `同时参与 ${member.projects.length} 个项目` : "项目成员")}</span>}</div></li>;
    })}</ul>
  </section>)}</div>;
}

function DeskEditor({ member, onSaved }: { member: OfficeMember; onSaved: (style: OfficeStyle) => void }) {
  const [color, setColor] = useState(member.style.deskColor);
  const [shape, setShape] = useState(member.style.deskShape);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true); setError("");
    try { onSaved(await organizationWrite<OfficeStyle>("/api/v1/organization/office/me", "PATCH", { expectedVersion: member.style.version, deskColor: color, deskShape: shape })); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "保存失败，请重试。"); }
    finally { setBusy(false); }
  }
  return <div className={styles.deskEditor}><PixelDesk color={color} shape={shape} /><div><label>工位颜色<input type="color" aria-label="工位颜色" value={color} onChange={event => setColor(event.target.value)} /></label><label>工位形状<select aria-label="工位形状" className={fieldClass} value={shape} onChange={event => setShape(event.target.value as OfficeStyle["deskShape"])}><option value="classic">经典长桌</option><option value="corner">转角工位</option><option value="round">圆角工位</option></select></label></div>{error && <p role="alert">{error}</p>}<Button disabled={busy} onClick={() => void save()}>{busy ? "正在保存…" : "保存工位"}</Button></div>;
}

function ProfileEditor({ member, onSaved }: { member: OfficeMember; onSaved: (workspace: OfficeWorkspace) => void }) {
  const [projectId, setProjectId] = useState(member.profile.displayedProjectId ?? "");
  const [description, setDescription] = useState(member.profile.description);
  const [presence, setPresence] = useState<OfficePresenceStatus>(member.profile.presenceStatus);
  const [customStatus, setCustomStatus] = useState(member.profile.customStatus);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function save() {
    setBusy(true); setError("");
    try {
      onSaved(await organizationWrite<OfficeWorkspace>("/api/v1/organization/office/profile", "PATCH", {
        expectedVersion: member.profile.version, groupingMode: member.profile.groupingMode,
        displayedProjectId: projectId || null, description, presenceStatus: presence,
        customStatus: presence === "custom" ? customStatus : "",
      }));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "保存失败，请重试。"); }
    finally { setBusy(false); }
  }
  return <div className={styles.profileEditor}>
    <label>展示项目<select className={fieldClass} aria-label="办公室展示项目" value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">不显示项目</option>{member.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
    <label>个人描述<textarea aria-label="办公室个人描述" maxLength={160} value={description} onChange={event => setDescription(event.target.value)} placeholder="例如：正在推进技术尽调" /></label>
    <label>当前状态<select className={fieldClass} aria-label="办公室状态" value={presence} onChange={event => setPresence(event.target.value as OfficePresenceStatus)}><option value="office">在公司</option><option value="away">外出</option><option value="trip">出差中</option><option value="custom">自定义</option></select></label>
    {presence === "custom" && <label>自定义状态<input aria-label="自定义办公室状态" maxLength={32} value={customStatus} onChange={event => setCustomStatus(event.target.value)} /></label>}
    {error && <p role="alert">{error}</p>}<Button disabled={busy || (presence === "custom" && !customStatus.trim())} onClick={() => void save()}>{busy ? "正在保存…" : "保存个人展示"}</Button>
  </div>;
}

export function MemberWork({ member, isSelf, onStyleSaved, onProfileSaved = () => {} }: { member: OfficeMember; isSelf: boolean; onStyleSaved: (style: OfficeStyle) => void; onProfileSaved?: (workspace: OfficeWorkspace) => void }) {
  const [customizing, setCustomizing] = useState(false); const [profileEditing, setProfileEditing] = useState(false);
  return <div className={styles.memberWork}><p>{member.departmentName} · {member.title || "团队成员"}</p>
    <p><span className={styles.presence}>{presenceLabel(member)}</span>{member.profile.description ? ` · ${member.profile.description}` : ""}</p>
    {isSelf && <div className={styles.memberActions}><Button variant="outline" onClick={() => setProfileEditing(!profileEditing)}>自定义我的展示</Button><Button variant="outline" onClick={() => setCustomizing(!customizing)}>自定义我的工位</Button></div>}
    {profileEditing && <ProfileEditor member={member} onSaved={onProfileSaved} />}
    {customizing && <DeskEditor member={member} onSaved={onStyleSaved} />}
    <h3>参与项目 <span>{member.projects.length}</span></h3>
    {!member.projects.length && <p className={styles.latest}>暂无已关联项目，可在项目中设置负责人或分配事项。</p>}
    {member.projects.map(project => <article key={project.id}><div><Link href={`/projects/${encodeURIComponent(project.id)}`}>{project.name}</Link><span className={styles.stage}>{stageLabel(project.stage)}</span></div><p>{project.role} · {progressLabel(project.progress)}</p><small>{project.latestUpdate?.title ?? "暂无推进记录"}{project.latestUpdate ? ` · ${new Date(project.latestUpdate.at).toLocaleDateString("zh-CN")}` : ""}</small></article>)}
    <h3>正在处理的事项 <span>{member.tasks.length}</span></h3>
    {member.tasks.length ? <ul>{member.tasks.map(task => <li key={task.id}>{task.title}<small>{task.dueAt ? ` · 截止 ${new Date(task.dueAt).toLocaleDateString("zh-CN")}` : ""}</small></li>)}</ul> : <p className={styles.latest}>暂无可见的进行中事项</p>}
  </div>;
}

export function LayoutEditor({ data, busy, onMove, onSave, onCancel }: {
  data: OfficeWorkspace; busy: boolean;
  onMove: (groupId: string, memberId: string, x: number, y: number) => void; onSave: () => void; onCancel: () => void;
}) {
  const [groupId, setGroupId] = useState(data.groups[0]?.id ?? "");
  const group = data.groups.find(item => item.id === groupId) ?? data.groups[0];
  return <section className={styles.layoutEditor} aria-label="工位布局编辑">
    <header><div><h2>调整工位布局</h2><p>在组内拖动工位，或直接修改网格坐标。切换分组的成员会重新安排座位，其他工位的位置改动会保留。</p></div><div><Button variant="outline" disabled={busy} onClick={onCancel}>取消调整</Button><Button disabled={busy} onClick={onSave}>{busy ? "保存中…" : "保存布局"}</Button></div></header>
    <p className={styles.layoutHint}>当前按{data.groupingMode === "department" ? "部门" : "项目"}显示；可在上方切换后分别保存工位位置。</p>
    <label>调整小组<select aria-label="调整小组" className={fieldClass} value={group?.id ?? ""} onChange={event => setGroupId(event.target.value)}>{data.groups.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <div className={styles.coordinateList}>{group?.seats.map(seat => {
      const name = data.members.find(member => member.id === seat.memberId)?.name ?? seat.memberId;
      return <div key={seat.memberId}><strong>{name}</strong><label>列<input type="number" min={0} max={31} value={seat.x} aria-label={`${name}工位列`} onChange={event => onMove(group.id, seat.memberId, Number(event.target.value), seat.y)} /></label><label>行<input type="number" min={0} max={127} value={seat.y} aria-label={`${name}工位行`} onChange={event => onMove(group.id, seat.memberId, seat.x, Number(event.target.value))} /></label></div>;
    })}</div>
  </section>;
}
