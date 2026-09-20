"use client";

import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, MapPin, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { WorkspaceActivity } from "@/workbench/activity-contracts";

const ZONE_OFFSET = 8 * 3_600_000;
const DAY = 86_400_000;
const DAY_START = 8 * 60;
const DAY_END = 20 * 60;
const HOUR_HEIGHT = 64;
const labels = { task: "待办", meeting: "会议", trip: "行程", approval: "审批" } as const;
const tones = { task: "border-blue-300 bg-blue-50 text-blue-950", meeting: "border-violet-300 bg-violet-50 text-violet-950", trip: "border-amber-300 bg-amber-50 text-amber-950", approval: "border-emerald-300 bg-emerald-50 text-emerald-950" } as const;

export interface ShanghaiCalendarParts { date: string; minutes: number }
export function shanghaiCalendarParts(value: string | Date): ShanghaiCalendarParts {
  const instant = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(instant.getTime())) throw new Error("Invalid calendar date");
  const shifted = new Date(instant.getTime() + ZONE_OFFSET);
  return { date: shifted.toISOString().slice(0, 10), minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
}
function addDays(date: string, count: number): string { return new Date(Date.parse(`${date}T00:00:00Z`) + count * DAY).toISOString().slice(0, 10); }
export function calendarWeek(anchor: string | Date): Array<{ date: string; day: string; short: string }> {
  const date = shanghaiCalendarParts(anchor).date;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const monday = addDays(date, -(weekday === 0 ? 6 : weekday - 1));
  return Array.from({ length: 7 }, (_, index) => {
    const current = addDays(monday, index); const parsed = new Date(`${current}T00:00:00Z`);
    return { date: current, day: new Intl.DateTimeFormat("zh-CN", { weekday: "short", timeZone: "UTC" }).format(parsed), short: `${parsed.getUTCMonth() + 1}/${parsed.getUTCDate()}` };
  });
}
function clock(minutes: number): string { return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; }
function endParts(item: WorkspaceActivity, start: ShanghaiCalendarParts): ShanghaiCalendarParts {
  if (!item.endAt) return { date: start.date, minutes: Math.min(start.minutes + 60, 24 * 60) };
  try {
    const end = shanghaiCalendarParts(item.endAt);
    const absoluteStart = Date.parse(`${start.date}T00:00:00Z`) + start.minutes * 60_000;
    const absoluteEnd = Date.parse(`${end.date}T00:00:00Z`) + end.minutes * 60_000;
    return absoluteEnd > absoluteStart ? end : { date: start.date, minutes: Math.min(start.minutes + 60, 24 * 60) };
  } catch { return { date: start.date, minutes: Math.min(start.minutes + 60, 24 * 60) }; }
}
function formatRange(item: WorkspaceActivity): string {
  if (!item.dueAt) return "全天";
  const start = shanghaiCalendarParts(item.dueAt); const end = endParts(item, start);
  return `${start.date} ${clock(start.minutes)}–${end.date === start.date ? "" : `${end.date} `}${clock(end.minutes)}`;
}

export function ActivityCalendar({ items, currentUserId, now = new Date(), onEdit }: { items: WorkspaceActivity[]; currentUserId?: string; now?: string | Date; onEdit: (item: WorkspaceActivity) => void }) {
  const today = shanghaiCalendarParts(now).date;
  const [anchor, setAnchor] = useState(today);
  const [selected, setSelected] = useState<WorkspaceActivity | null>(null);
  const days = useMemo(() => calendarWeek(`${anchor}T04:00:00+08:00`), [anchor]);
  const allDay = items.filter(item => !item.dueAt && (item.status ?? "active") === "active");
  const timed = items.flatMap(item => {
    if (!item.dueAt || (item.status ?? "active") !== "active") return [];
    try {
      const start = shanghaiCalendarParts(item.dueAt), end = endParts(item, start);
      return days.filter(day => day.date >= start.date && day.date <= end.date && !(day.date === end.date && end.date !== start.date && end.minutes === 0))
        .map(day => ({ item, start, end, date: day.date }));
    } catch { return []; }
  });
  const first = new Date(`${days[0].date}T00:00:00Z`), last = new Date(`${days[6].date}T00:00:00Z`);
  const label = `${first.getUTCFullYear()}年${first.getUTCMonth() + 1}月${first.getUTCDate()}日至${first.getUTCMonth() === last.getUTCMonth() ? "" : `${last.getUTCMonth() + 1}月`}${last.getUTCDate()}日`;
  return <section className="grid min-w-0 gap-3 rounded-xl border border-border bg-card p-3 sm:p-4" aria-labelledby="activity-calendar-title">
    <header className="flex flex-wrap items-center justify-between gap-2"><div><h2 id="activity-calendar-title" className="flex items-center gap-2 text-lg font-semibold"><CalendarDays className="size-5 text-primary" aria-hidden="true" />日程</h2><p className="mt-1 text-xs text-muted-foreground">{label} · 上海时间（UTC+8）</p></div><div className="flex items-center gap-2"><Button type="button" variant="outline" size="sm" aria-label="上一周" onClick={() => setAnchor(addDays(days[0].date, -7))}><ChevronLeft aria-hidden="true" /></Button><Button type="button" variant="outline" size="sm" onClick={() => setAnchor(today)}>今天</Button><Button type="button" variant="outline" size="sm" aria-label="下一周" onClick={() => setAnchor(addDays(days[0].date, 7))}><ChevronRight aria-hidden="true" /></Button></div></header>
    <div data-testid="calendar-week-scroll" className="max-w-full overflow-x-auto overscroll-x-contain rounded-lg border">
      <div role="grid" aria-label={`${label}日程`} className="min-w-[63rem] bg-white">
        <div className="grid grid-cols-[4.5rem_repeat(7,minmax(0,1fr))] border-b bg-muted/35"><div aria-hidden="true" />{days.map(day => <div role="columnheader" key={day.date} className={`min-h-14 border-l px-2 py-2 text-center text-sm ${day.date === today ? "bg-primary/5 text-primary" : ""}`}><strong>{day.day}</strong><span className="ml-1">{day.short}</span></div>)}</div>
        <div role="row" aria-label="全天日程" className="grid min-h-14 grid-cols-[4.5rem_repeat(7,minmax(0,1fr))] border-b"><div className="px-2 py-3 text-xs text-muted-foreground">全天</div>{days.map((day, index) => <div key={day.date} className="border-l p-1">{index === 0 && allDay.map(item => <button key={item.id} type="button" onClick={() => setSelected(item)} className={`mb-1 min-h-8 w-full rounded border px-2 text-left text-xs ${tones[item.kind]}`}>{item.title}</button>)}</div>)}</div>
        <div className="grid grid-cols-[4.5rem_repeat(7,minmax(0,1fr))]"><div className="relative" style={{ height: `${(DAY_END - DAY_START) / 60 * HOUR_HEIGHT}px` }}>{Array.from({ length: 13 }, (_, hour) => <span key={hour} className="absolute right-2 -translate-y-1/2 text-[11px] text-muted-foreground" style={{ top: `${hour * HOUR_HEIGHT}px` }}>{String(hour + 8).padStart(2, "0")}:00</span>)}</div>{days.map(day => <div key={day.date} role="gridcell" aria-label={`${day.date}日程`} className={`relative border-l ${day.date === today ? "bg-primary/[0.025]" : ""}`} style={{ height: `${(DAY_END - DAY_START) / 60 * HOUR_HEIGHT}px`, backgroundImage: "linear-gradient(to bottom, transparent calc(100% - 1px), hsl(var(--border)) 1px)", backgroundSize: `100% ${HOUR_HEIGHT}px` }}>{timed.filter(entry => entry.date === day.date && (entry.start.date !== day.date || entry.start.minutes < DAY_END) && (entry.end.date !== day.date || entry.end.minutes > DAY_START)).map(({ item, start, end, date }) => {
          const segmentStart = start.date === date ? start.minutes : DAY_START;
          const visibleStart = Math.max(DAY_START, segmentStart); const eventEnd = end.date === date ? end.minutes : DAY_END; const visibleEnd = Math.min(DAY_END, Math.max(visibleStart + 30, eventEnd));
          const endPrefix = end.date === start.date ? "" : `${end.date} `;
          const accessibleTime = `${clock(start.minutes)}至${endPrefix}${clock(end.minutes)}`;
          return <button key={`${item.id}:${date}`} type="button" aria-label={item.title + "，" + accessibleTime} onClick={() => setSelected(item)} style={{ top: `${(visibleStart - DAY_START) / 60 * HOUR_HEIGHT}px`, height: `${Math.max(32, (visibleEnd - visibleStart) / 60 * HOUR_HEIGHT)}px` }} className={`absolute inset-x-1 z-10 overflow-hidden rounded-md border px-2 py-1 text-left text-xs leading-4 shadow-sm focus-visible:z-20 ${tones[item.kind]}`}><strong className="block truncate">{item.title}</strong><span>{start.date === date ? `${clock(start.minutes)}–${end.date === date ? clock(end.minutes) : "次日"}` : `续至 ${end.date === date ? clock(end.minutes) : "次日"}`}</span></button>;
        })}</div>)}</div>
      </div>
    </div>
    <Dialog open={Boolean(selected)} onOpenChange={open => { if (!open) setSelected(null); }}>
      <DialogContent aria-label={selected ? `${selected.title}详情` : "日程详情"}>
        <DialogHeader>
          <DialogTitle>{selected?.title}</DialogTitle>
          <DialogDescription>{selected ? `${labels[selected.kind]} · ${formatRange(selected)}` : "日程详情"}</DialogDescription>
        </DialogHeader>
        {selected && <div className="grid gap-3 text-sm">
          {selected.location && <p className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{selected.location}</p>}
          <p className="flex items-start gap-2"><Clock3 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{formatRange(selected)}</p>
          {selected.description && <p className="whitespace-pre-wrap leading-6 text-muted-foreground">{selected.description}</p>}
          {selected.createdBy === currentUserId && <Button type="button" variant="outline" onClick={() => { setSelected(null); onEdit(selected); }}><Pencil aria-hidden="true" />编辑事项</Button>}
        </div>}
      </DialogContent>
    </Dialog>
  </section>;
}
