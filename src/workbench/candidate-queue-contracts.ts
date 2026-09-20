import { normalizeNewsPublishedAt } from "@/domain/news-publication";
import { z } from "zod";
import type { CandidateView } from "./candidate-details";
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0,10) === value;
});
export const candidateQueueFiltersSchema = z.object({
  period: z.enum(["today", "week", "all"]).default("all"),
  q: z.string().trim().max(200).default(""), date: calendarDate.optional(),
  status: z.enum(["pending_review", "promoted", "dismissed", "archived"]).optional(),
  track: z.string().trim().min(1).max(128).optional(),
}).strict();
export type CandidateQueueFilters = z.input<typeof candidateQueueFiltersSchema>;
export const shanghaiDate = (date: Date | string) => new Date(new Date(date).getTime() + 8 * 3600000).toISOString().slice(0,10);
export function filterCandidateQueue(rows: readonly CandidateView[], raw: CandidateQueueFilters = {}, now = new Date()): CandidateView[] {
  const input = candidateQueueFiltersSchema.parse(raw);
  const today = shanghaiDate(now); const weekStart = shanghaiDate(new Date(now.getTime() - 6 * 86400000));
  const q = input.q.toLocaleLowerCase("zh-CN");
  return rows.filter(row => {
    const day = shanghaiDate(row.createdAt);
    if (input.date ? day !== input.date : input.period === "today" ? day !== today : input.period === "week" && (day < weekStart || day > today)) return false;
    if (row.origin !== "manual_screenshot" && (input.date || input.period !== "all")) {
      const verifiedAt = normalizeNewsPublishedAt(row.lead.publicationVerifiedAt);
      if (!verifiedAt || Date.parse(verifiedAt) > now.getTime()) return false;
      const publishedAt = normalizeNewsPublishedAt(row.lead.publishedAt);
      if (!publishedAt || Date.parse(publishedAt) > now.getTime()) return false;
      const publishedDay = shanghaiDate(publishedAt);
      if (input.date ? publishedDay !== input.date : input.period === "today" ? publishedDay !== today : publishedDay < weekStart || publishedDay > today) return false;
    }
    if (input.track && row.track !== input.track) return false;
    if (input.status === "archived" ? !row.archivedAt : input.status && (row.status !== input.status || (input.status === "pending_review" && row.archivedAt))) return false;
    return !q || [row.companyName, row.summary, row.rawTrack, row.track, row.lead.title, ...row.investorNames].join(" ").toLocaleLowerCase("zh-CN").includes(q);
  }).sort((a,b) => shanghaiDate(b.createdAt).localeCompare(shanghaiDate(a.createdAt)) || Number(a.status === "dismissed") - Number(b.status === "dismissed") || (a.queueRank ?? 1000000) - (b.queueRank ?? 1000000) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}
