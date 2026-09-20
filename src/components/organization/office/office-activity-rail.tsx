"use client";

import { useState } from "react";
import type { OfficeMeeting, OfficeMember, OfficeWorkspace } from "@/organization/office-contracts";
import { Button } from "@/components/ui/button";
import styles from "./activity-rail.module.css";

type Activity = NonNullable<OfficeWorkspace["activity"]>;
type Filter = "all" | "approval" | "task" | "meeting" | "comment";
const filters: { id: Filter; label: string }[] = [{ id: "all", label: "全部" }, { id: "approval", label: "审批" }, { id: "task", label: "事项" }, { id: "meeting", label: "会议" }, { id: "comment", label: "批注" }];
const kinds: Record<string, string> = { task: "事项", trip: "出差", meeting: "会议", approval: "审批", comment: "批注" };

function timestamp(value: string | null) {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}
function matches(kind: string, filter: Filter) {
  return filter === "all" || (filter === "task" ? kind !== "approval" && kind !== "meeting" && kind !== "comment" : kind === filter);
}
function SafeTitle({ title, targetUrl }: { title: string; targetUrl: string }) {
  // Only root-relative links are accepted, including after URL normalization.
  const safe = targetUrl.startsWith("/") && !targetUrl.startsWith("//") && !/[\\\s\u0000-\u001f\u007f]/.test(targetUrl);
  return safe ? <a className={styles.itemTitle} href={targetUrl}>{title}</a> : <span className={styles.itemTitle}>{title}</span>;
}
function When({ value, label }: { value: string | null; label: string }) {
  if (!value) return <span>未设截止</span>;
  if (!Number.isFinite(timestamp(value))) return <span>时间待确认</span>;
  return <time dateTime={value}>{label} {new Date(value).toLocaleString("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</time>;
}
function MemberTodos({ todos, name }: { todos: Activity["todos"]; name: string }) {
  return <section className={styles.person} aria-label={`${name}的待办`}>
    <h3><span>{name}</span><span className={styles.count}>{todos.length}</span></h3>
    <ul>{todos.map(todo => <li key={todo.id}>
      <div className={styles.itemMeta}><span className={styles.kind}>{kinds[todo.kind] ?? "事项"}</span><When value={todo.dueAt} label="截止" /></div>
      <SafeTitle title={todo.title} targetUrl={todo.targetUrl} />
    </li>)}</ul>
  </section>;
}

export function OfficeActivityRail({ activity, members, canManage, onEndMeeting, endingMeetingId }: {
  activity: OfficeWorkspace["activity"]; members: OfficeMember[]; canManage: boolean;
  onEndMeeting?: (meeting: OfficeMeeting) => void; endingMeetingId?: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const name = (id: string) => members.find(member => member.id === id)?.name ?? "待确认成员";
  const meetings = (activity?.meetings ?? []).filter(() => filter === "all" || filter === "meeting").toSorted((a, b) => timestamp(a.startsAt) - timestamp(b.startsAt));
  const queues = (activity?.queues ?? []).filter(queue => matches(queue.kind, filter)).toSorted((a, b) => timestamp(a.createdAt) - timestamp(b.createdAt));
  const todos = (activity?.todos ?? []).filter(todo => matches(todo.kind, filter) && !(todo.kind === "meeting" && meetings.some(meeting => meeting.id === todo.id))).toSorted((a, b) => timestamp(a.dueAt) - timestamp(b.dueAt) || a.title.localeCompare(b.title, "zh-CN"));
  const owners = [...new Set(todos.flatMap(todo => todo.memberIds.length ? todo.memberIds : [""]))];
  const heading = canManage ? "全公司待办" : "我可见的待办";
  const empty = !todos.length && !queues.length && !meetings.length;
  return <aside className={styles.rail} aria-label={heading}>
    <header className={styles.header}>
      <span className={styles.eyebrow}>工作动态</span><h2>{heading}</h2>
      <p><span>{activity?.todos.length ?? 0} 项待办</span><span>{activity?.queues.length ?? 0} 条待沟通</span><span>{activity?.meetings.length ?? 0} 场会议</span></p>
    </header>
    <div className={styles.filters} role="group" aria-label="待办类型筛选">{filters.map(item => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div>
    <div className={styles.body}>
      {empty && <p className={styles.empty}>{filter === "all" ? "暂无可见待办、会议或待沟通事项" : "暂无此类待办"}</p>}
      {meetings.length > 0 && <section className={styles.summary} aria-label="当前会议">
        <h3><span className={styles.liveDot} />当前会议<span className={styles.count}>{meetings.length}</span></h3>
        <ul>{meetings.map(meeting => <li key={meeting.id}>
          <SafeTitle title={meeting.title} targetUrl={meeting.targetUrl} />
          <p className={styles.people}>{meeting.memberIds.map(name).join("、") || "待确认参会人"}</p>
          <p className={styles.itemMeta}><When value={meeting.startsAt} label="开始" /></p>
          {meeting.canEnd && onEndMeeting && <Button type="button" variant="outline" size="sm" className="mt-2 min-h-9" aria-label={`结束会议：${meeting.title}`} disabled={Boolean(endingMeetingId)} onClick={() => onEndMeeting(meeting)}>{endingMeetingId === meeting.id ? "正在结束…" : "结束会议"}</Button>}
        </li>)}</ul>
      </section>}
      {owners.map(owner => <MemberTodos key={owner || "unassigned"} name={owner ? name(owner) : "待分配"} todos={todos.filter(todo => owner ? todo.memberIds.includes(owner) : !todo.memberIds.length)} />)}
      {queues.length > 0 && <section className={styles.summary} aria-label="待沟通">
        <h3>待沟通<span className={styles.count}>{queues.length}</span></h3>
        <ul>{queues.map(queue => <li key={queue.id}>
          <div className={styles.itemMeta}><span className={styles.kind}>{kinds[queue.kind]}</span><When value={queue.createdAt} label="发起" /></div>
          <SafeTitle title={queue.title} targetUrl={queue.targetUrl} />
          <p className={styles.people}>{name(queue.fromMemberId)} → {name(queue.toMemberId)}</p>
        </li>)}</ul>
      </section>}
    </div>
    <footer className={styles.footer}>{(activity?.todos.length ?? 0) >= 100 ? "当前最多展示 100 项待办，可到我的待办查看全部。" : "点击事项可查看详情并处理"}</footer>
  </aside>;
}
