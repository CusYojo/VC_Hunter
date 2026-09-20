"use client";

import { useState } from "react";
import { Users, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TRACKS } from "@/domain/projects";
import type { CandidateView } from "@/workbench/candidate-details";
import { recentFirstMembers } from "@/components/activity-participant-picker";

export interface CandidateIntakeOptions { assignee?: string; assignees?: string[]; track?: string }

export function CandidateIntakeDialog({ candidate, team, currentUser, busy, error, onCancel, onConfirm, recentScopeKey }: {
  candidate: CandidateView; team: Array<{ id: string; name: string; departmentId?: string | null; departmentName?: string | null }>; currentUser: string; recentScopeKey?: string;
  busy: boolean; error?: string; onCancel: () => void; onConfirm: (options: CandidateIntakeOptions) => void;
}) {
  const [distribute, setDistribute] = useState(false);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [join, setJoin] = useState(false);
  const [track, setTrack] = useState("");
  const [personQuery, setPersonQuery] = useState("");
  const needsTrack = !TRACKS.includes(candidate.track as never);
  const canJoin = team.some(member => member.name === currentUser);
  const selected = [...new Set([...(distribute ? assignees : []), ...(join && canJoin ? [currentUser] : [])])];
  const ready = (team.length === 0 || selected.length > 0) && (!needsTrack || Boolean(track));
  const optionClass = "flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm has-checked:border-primary has-checked:bg-primary/5";
  const normalizedQuery = personQuery.trim().toLocaleLowerCase("zh-CN");
  const visibleTeam = recentFirstMembers(team, recentScopeKey).filter(member => `${member.name} ${member.departmentName ?? ""}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery));

  return <Dialog open onOpenChange={open => { if (!open && !busy) onCancel(); }}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md" showCloseButton={!busy}>
      <DialogHeader><DialogTitle className="pr-6 leading-6">入库 · {candidate.companyName}</DialogTitle><DialogDescription>可分配多位负责人，也可同时加入项目。入库后仍保留在发现列表中。</DialogDescription></DialogHeader>
      <fieldset disabled={busy} className="grid gap-3" aria-busy={busy}>
        <legend className="mb-2 text-sm font-medium">入库方式</legend>
        {team.length > 0 ? <>
          <label className={optionClass}><input type="checkbox" checked={distribute} onChange={event => setDistribute(event.target.checked)} /><Users className="size-4 text-primary" aria-hidden="true" />分发给同事</label>
          {distribute && <fieldset className="max-h-56 overflow-y-auto rounded-lg border p-2"><legend className="px-1 text-sm">分发给谁（可多选）</legend><input type="search" aria-label="搜索入库负责人" placeholder="搜索姓名或部门" value={personQuery} onChange={event => setPersonQuery(event.target.value)} className="my-2 min-h-10 w-full rounded-md border bg-background px-3 text-sm" />{visibleTeam.map(member => <label key={member.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-muted"><input type="checkbox" checked={assignees.includes(member.name)} onChange={event => setAssignees(current => event.target.checked ? [...current, member.name] : current.filter(name => name !== member.name))} />{member.name}{member.departmentName ? <small className="text-muted-foreground">{member.departmentName}</small> : null}</label>)}{visibleTeam.length === 0 && <p className="py-3 text-sm text-muted-foreground">没有匹配的人员</p>}</fieldset>}
          {canJoin && <label className={optionClass}><input type="checkbox" checked={join} onChange={event => setJoin(event.target.checked)} /><UserPlus className="size-4 text-primary" aria-hidden="true" />我感兴趣，加入项目</label>}
        </> : <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">暂无可选团队成员，确认后直接入库，稍后可在项目管理中分配负责人。</p>}
        {selected.length > 0 && <p className="text-sm text-muted-foreground">负责人：{selected.join("、")}</p>}
        {needsTrack && <label className="grid gap-1.5 text-sm">正式分类待复核<select aria-label={`为${candidate.companyName}确认赛道`} className="h-11 rounded-lg border bg-background px-3" value={track} onChange={event => setTrack(event.target.value)}><option value="">请选择正式项目赛道</option>{TRACKS.map(value => <option key={value} value={value}>{value}</option>)}</select></label>}
      </fieldset>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <DialogFooter><Button variant="outline" className="min-h-11" disabled={busy} onClick={onCancel}>取消</Button><Button className="min-h-11" disabled={busy || !ready} onClick={() => onConfirm({ ...(selected.length > 1 ? { assignees: selected } : selected.length === 1 ? { assignee: selected[0] } : {}), ...(needsTrack ? { track } : {}) })}>{busy ? "正在入库…" : "确认入库"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
