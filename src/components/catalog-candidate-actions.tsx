"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CandidateAdminEditor } from "@/components/candidate-admin-editor";
import { CandidateIntakeDialog, type CandidateIntakeOptions } from "@/components/candidate-intake-dialog";
import type { CandidateView } from "@/workbench/candidate-details";
import { recordRecentActivityParticipants } from "@/components/activity-participant-picker";

type Props = { candidate: CandidateView; team: { id: string; name: string; departmentId?: string | null; departmentName?: string | null }[]; currentUser: string; canAdmin: boolean; canReview?: boolean; recentScopeKey?: string };
export function CatalogCandidateActions({ candidate, team, currentUser, canAdmin, canReview = false, recentScopeKey }: Props) {
  const router = useRouter();
  const [updated, setUpdated] = useState<CandidateView | null>(null);
  const current = updated?.id === candidate.id && updated.version > candidate.version ? updated : candidate;
  const [intake, setIntake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const retry = useRef<{ body: string; key: string } | null>(null);
  function onUpdated(value: CandidateView) { setUpdated(value); router.refresh(); }
  async function review(decision: "promote" | "reject", options: CandidateIntakeOptions = {}) {
    if (pending.current || !canReview) return;
    const body = JSON.stringify({ decision, expectedVersion: current.version, ...(decision === "promote" ? options : {}), reason: decision === "promote" ? "确认进入项目管理" : "投资经理暂不跟进" });
    if (retry.current?.body !== body) retry.current = { body, key: crypto.randomUUID() };
    pending.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/v1/candidates/${encodeURIComponent(current.id)}/review`, { method: "PATCH", headers: { "content-type": "application/json", "idempotency-key": retry.current.key }, body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "操作失败，请稍后重试。");
      onUpdated({ ...current, ...payload.data, track: options.track || current.track });
      if (decision === "promote" && recentScopeKey) {
        const savedNames = options.assignees ?? (options.assignee ? [options.assignee] : []);
        recordRecentActivityParticipants(recentScopeKey, team.filter(member => savedNames.includes(member.name)).map(member => member.id));
      }
      setIntake(false); retry.current = null;
    } catch (failure) { setError(failure instanceof Error ? failure.message : "网络连接失败，请重试。"); }
    finally { pending.current = false; setBusy(false); }
  }
  if (current.archivedAt) return null;
  return <div className="grid gap-2">
    <div className="flex flex-wrap items-center gap-2">
      {canReview && current.status === "pending_review" && <><Button size="sm" disabled={busy} onClick={() => { setError(""); setIntake(true); }}>入库</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void review("reject")}>暂不跟进</Button></>}
      {canAdmin && !busy && <CandidateAdminEditor candidate={current} onUpdated={onUpdated} />}
    </div>
    {error && !intake && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {intake && canReview && <CandidateIntakeDialog candidate={current} team={team} currentUser={currentUser} recentScopeKey={recentScopeKey} busy={busy} error={error || undefined} onCancel={() => setIntake(false)} onConfirm={options => review("promote", options)} />}
  </div>;
}
