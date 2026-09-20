"use client";

import { useId, useState, useSyncExternalStore } from "react";

export interface ActivityParticipantMember { id: string; name: string; departmentId?: string | null; departmentName?: string | null }
interface Props {
  members: ActivityParticipantMember[];
  selected: string[];
  onChange: (ids: string[]) => void;
  scopeKey: string;
  busy?: boolean;
  selectionMode?: "single" | "multiple";
}
const RECENT_LIMIT = 24;
const CHANGE_EVENT = "vc-activity-recent-participants";

function storageKey(scope: string): string | null {
  return scope.trim() && scope.length <= 300 ? `vc-hunter:activity-participants:v1:${encodeURIComponent(scope)}` : null;
}
function readStored(scope: string): string {
  try { const key = storageKey(scope); return key ? window.localStorage.getItem(key) ?? "" : ""; } catch { return ""; }
}
function recentIds(stored: string): string[] {
  try {
    const value: unknown = JSON.parse(stored);
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 200))].slice(0, RECENT_LIMIT) : [];
  } catch { return []; }
}

export function getRecentActivityParticipantIds(scopeKey: string): string[] {
  if (typeof window === "undefined") return [];
  return recentIds(readStored(scopeKey));
}

export function recentFirstMembers<T extends { id: string }>(members: readonly T[], scopeKey?: string): T[] {
  if (!scopeKey) return [...members];
  const rank = new Map(getRecentActivityParticipantIds(scopeKey).map((id, index) => [id, index]));
  return [...members].sort((left, right) => (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER));
}
function subscribe(listener: () => void): () => void {
  window.addEventListener("storage", listener); window.addEventListener(CHANGE_EVENT, listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener(CHANGE_EVENT, listener); };
}

/** Call only after the server confirms creation. Stores IDs, never names, under the authenticated workspace/person scope. */
export function recordRecentActivityParticipants(scopeKey: string, participantIds: readonly string[]): void {
  try {
    const key = storageKey(scopeKey);
    if (!key || !participantIds.length) return;
    const ids = recentIds(JSON.stringify([...participantIds, ...recentIds(readStored(scopeKey))]));
    window.localStorage.setItem(key, JSON.stringify(ids));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch { /* Browser storage is optional and must never prevent creating an activity. */ }
}

export function ActivityParticipantPicker({ members, selected, onChange, scopeKey, busy = false, selectionMode = "multiple" }: Props) {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const stored = useSyncExternalStore(subscribe, () => readStored(scopeKey), () => "");
  const memberIds = new Set(members.map(member => member.id));
  const authorizedSelected = [...new Set(selected.filter(id => memberIds.has(id)))];
  const recent = recentIds(stored).map(id => members.find(member => member.id === id)).filter((member): member is ActivityParticipantMember => Boolean(member));
  const recentSet = new Set(recent.map(member => member.id));
  const departmentNames = [...new Set(members.map(member => member.departmentName?.trim() || "未分组"))].sort((a, b) => a === "未分组" ? 1 : b === "未分组" ? -1 : a.localeCompare(b, "zh-CN"));
  const departments = departmentNames.filter(name => members.some(member => !recentSet.has(member.id) && (member.departmentName?.trim() || "未分组") === name));
  const groups = [
    ...(recent.length ? [{ name: "最近选择", members: recent }] : []),
    ...departments.map(name => ({ name, members: members.filter(member => !recentSet.has(member.id) && (member.departmentName?.trim() || "未分组") === name) })),
  ].map(group => ({ ...group, members: group.members.filter(member => `${member.name} ${member.departmentName ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) })).filter(group => group.members.length);
  const changeMany = (ids: readonly string[]) => {
    const targetIds = [...new Set(ids.filter(id => memberIds.has(id)))];
    const targetSet = new Set(targetIds);
    const allSelected = targetIds.length > 0 && targetIds.every(id => authorizedSelected.includes(id));
    onChange(allSelected ? authorizedSelected.filter(id => !targetSet.has(id)) : [...authorizedSelected, ...targetIds.filter(id => !authorizedSelected.includes(id))]);
  };
  return <fieldset disabled={busy} className="grid min-w-0 gap-3 rounded-lg border border-border p-3">
    <legend className="px-1 text-sm font-medium">接收人与参会人员</legend>
    <div className="flex flex-wrap items-center gap-2"><label htmlFor={searchId} className="sr-only">搜索姓名或部门</label><input id={searchId} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索姓名或部门" className="min-h-10 min-w-0 flex-1 rounded-md border border-input bg-white px-3 text-sm" /><span aria-live="polite" className="text-xs text-muted-foreground">已选 {authorizedSelected.length} 人</span></div>
    {selectionMode === "multiple" && members.length > 0 && <div role="group" aria-label="批量选择人员" className="flex min-w-0 flex-wrap gap-1.5">
      <button type="button" aria-pressed={authorizedSelected.length === members.length} onClick={() => changeMany(members.map(member => member.id))} className="min-h-9 rounded-md border border-input bg-white px-2.5 text-xs font-medium hover:bg-muted">{authorizedSelected.length === members.length ? "取消选择全部人员" : "选择全部人员"}</button>
      {departmentNames.map(name => {
        const ids = members.filter(member => (member.departmentName?.trim() || "未分组") === name).map(member => member.id);
        const allSelected = ids.every(id => authorizedSelected.includes(id));
        return <button key={name} type="button" aria-pressed={allSelected} onClick={() => changeMany(ids)} className="min-h-9 rounded-md border border-input bg-white px-2.5 text-xs hover:bg-muted">{allSelected ? `取消选择${name}全员` : `选择${name}全员`}</button>;
      })}
    </div>}
    <div className="grid max-h-72 min-w-0 gap-3 overflow-y-auto">
      {groups.map(group => <fieldset key={group.name} className="min-w-0"><legend className="mb-2 text-xs font-medium text-muted-foreground">{group.name}</legend><div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-4">{group.members.map(member => <label key={member.id} className={`flex min-h-10 min-w-0 cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-sm ${authorizedSelected.includes(member.id) ? "border-primary/30 bg-primary/5" : "border-transparent hover:bg-muted/50"}`}><input type="checkbox" aria-label={member.name} checked={authorizedSelected.includes(member.id)} onChange={event => onChange(event.target.checked ? selectionMode === "single" ? [member.id] : [...authorizedSelected, member.id] : authorizedSelected.filter(id => id !== member.id))} className="size-4 shrink-0 accent-primary" /><span className="break-words">{member.name}</span></label>)}</div></fieldset>)}
      {!groups.length && <p className="py-3 text-sm text-muted-foreground">{members.length ? "没有匹配的人员" : "暂无可选择的人员"}</p>}
    </div>
  </fieldset>;
}
