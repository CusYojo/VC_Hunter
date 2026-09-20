"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import type { CandidateView } from "@/workbench/candidate-details";

export function candidateDay(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date) : "";
}
export function queueCompare(left: CandidateView, right: CandidateView) {
  return candidateDay(right.createdAt).localeCompare(candidateDay(left.createdAt))
    || Number(left.status === "dismissed") - Number(right.status === "dismissed")
    || (left.queueRank ?? 1000000) - (right.queueRank ?? 1000000)
    || right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id);
}
export function CandidateOrderButtons({ candidate, rows, busy, onMove }: { candidate: CandidateView; rows: CandidateView[]; busy: boolean; onMove: (candidate: CandidateView, direction: -1 | 1) => void }) {
  const group = rows.filter(row => candidateDay(row.createdAt) === candidateDay(candidate.createdAt) && (row.status === "dismissed") === (candidate.status === "dismissed"));
  const index = group.findIndex(row => row.id === candidate.id);
  return <div className="flex gap-1"><button type="button" aria-label={`上移 ${candidate.companyName}`} disabled={busy || index <= 0} onClick={() => onMove(candidate, -1)} className="grid size-11 place-items-center rounded-lg border hover:bg-muted disabled:opacity-30"><ArrowUp className="size-4" aria-hidden="true" /></button><button type="button" aria-label={`下移 ${candidate.companyName}`} disabled={busy || index === group.length - 1} onClick={() => onMove(candidate, 1)} className="grid size-11 place-items-center rounded-lg border hover:bg-muted disabled:opacity-30"><ArrowDown className="size-4" aria-hidden="true" /></button></div>;
}
export function CandidateQueueTable({ rows, allRows, busy, canAdmin, onMove, onOpen, onReject, onIntake }: {
  rows: CandidateView[]; allRows: CandidateView[]; busy: boolean; canAdmin: boolean;
  onMove: (candidate: CandidateView, direction: -1 | 1) => void; onOpen: (candidate: CandidateView) => void;
  onReject: (candidate: CandidateView) => void; onIntake: (candidate: CandidateView) => void;
}) {
  return <div role="region" aria-label="全部项目表格" tabIndex={0} className="mt-4 min-w-0 max-w-full overflow-x-auto rounded-xl border bg-card"><table className="w-full min-w-[1150px] border-collapse text-left text-sm"><thead className="bg-muted/50"><tr>{["序号", "公司名", "简介", "行业", "收录日期", "最新融资日期", "融资轮次", "融资金额", "投资方", "状态", "操作", ...(canAdmin ? ["管理员排序"] : [])].map(title => <th key={title} className="whitespace-nowrap border-b px-3 py-3 font-medium">{title}</th>)}</tr></thead><tbody>{rows.map((candidate, index) => <tr key={candidate.id} data-candidate-id={candidate.id} className="border-b last:border-0 hover:bg-muted/25">
    <td className="px-3 py-3 text-muted-foreground">{index + 1}</td><td className="min-w-36 px-3 py-3"><button type="button" onClick={() => onOpen(candidate)} className="min-h-11 text-left font-semibold text-primary hover:underline">{candidate.companyName}</button></td>
    <td className="min-w-52 max-w-72 px-3 py-3"><p className="line-clamp-2" title={candidate.summary}>{candidate.summary}</p></td><td className="min-w-28 px-3 py-3">{candidate.rawTrack || candidate.track}</td><td className="whitespace-nowrap px-3 py-3">{candidateDay(candidate.createdAt)}</td><td className="whitespace-nowrap px-3 py-3">{candidate.eventDate || "未披露"}</td><td className="whitespace-nowrap px-3 py-3">{candidate.round || "未披露"}</td><td className="whitespace-nowrap px-3 py-3">{candidate.amountText || "未披露"}</td><td className="min-w-44 max-w-64 px-3 py-3"><p className="line-clamp-2" title={candidate.investorNames.join("、")}>{candidate.investorNames.join("、") || "未披露"}</p></td>
    <td className="whitespace-nowrap px-3 py-3">{candidate.archivedAt ? "已归档" : candidate.status === "promoted" ? "已入库" : candidate.status === "dismissed" ? "已拒绝" : "待查看"}</td><td className="px-3 py-3"><div className="flex gap-2">{candidate.status === "pending_review" && !candidate.archivedAt ? <><button type="button" disabled={busy} className="min-h-11 whitespace-nowrap rounded-lg px-3 text-destructive hover:bg-muted" onClick={() => onReject(candidate)}>拒绝</button><button type="button" disabled={busy} className="min-h-11 whitespace-nowrap rounded-lg bg-primary px-3 text-primary-foreground" onClick={() => onIntake(candidate)}>入库</button></> : candidate.projectId ? <a className="inline-flex min-h-11 items-center whitespace-nowrap text-primary" href={`/projects/${encodeURIComponent(candidate.projectId)}`}>打开项目</a> : <span className="text-xs text-muted-foreground">{candidate.archivedAt ? "基础信息" : "已处理"}</span>}</div></td>
    {canAdmin && <td className="px-3 py-3"><CandidateOrderButtons candidate={candidate} rows={allRows} busy={busy} onMove={onMove} /></td>}
  </tr>)}</tbody></table></div>;
}
