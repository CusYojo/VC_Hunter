"use client";

import { useMemo, useState } from "react";
import { CalendarDays, CheckSquare2, ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MeetingSummary, WorkItem } from "@/prototype/contracts";

const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];
const timeZone = "Asia/Shanghai";

type Month = { year: number; month: number };
type CalendarEntry = {
  id: string;
  title: string;
  at: string;
  dayKey: string;
  kind: "meeting" | "task";
  detail: string;
};

function dateParts(value: string | Date) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(typeof value === "string" ? new Date(value) : value);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: read("year"), month: read("month"), day: read("day") };
}

function dayKey({ year, month, day }: { year: number; month: number; day: number }) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthDays({ year, month }: Month) {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  return Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1, 1 - firstWeekday + index));
    const value = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
    return { ...value, key: dayKey(value), inCurrentMonth: value.year === year && value.month === month };
  });
}

function moveMonth(value: Month, offset: number): Month {
  const date = new Date(Date.UTC(value.year, value.month - 1 + offset, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(new Date(value));
}

function MiniCalendar({ days }: { days: ReturnType<typeof monthDays> }) {
  const today = dayKey(dateParts(new Date()));
  return (
    <div aria-label="迷你月历" className="grid grid-cols-7 gap-y-1 text-center text-[11px]">
      {weekdayLabels.map((label) => <span key={label} className="py-1 font-medium text-muted-foreground">{label}</span>)}
      {days.map((day) => <span key={day.key} className={`grid h-7 place-items-center rounded-md tabular-nums ${day.key === today ? "bg-primary text-primary-foreground" : day.inCurrentMonth ? "text-foreground" : "text-muted-foreground/45"}`} aria-current={day.key === today ? "date" : undefined}>{day.day}</span>)}
    </div>
  );
}

export function MonthCalendar({ meetings, workItems }: { meetings: MeetingSummary[]; workItems: WorkItem[] }) {
  const baselineParts = dateParts(meetings[0]?.startsAt ?? workItems[0]?.dueAt ?? new Date());
  const baseline = { year: baselineParts.year, month: baselineParts.month };
  const [activeMonth, setActiveMonth] = useState<Month>(baseline);
  const days = useMemo(() => monthDays(activeMonth), [activeMonth]);
  const entries = useMemo<CalendarEntry[]>(() => [
    ...meetings.map((meeting) => ({ id: meeting.id, title: meeting.title, at: meeting.startsAt, dayKey: dayKey(dateParts(meeting.startsAt)), kind: "meeting" as const, detail: meeting.location })),
    ...workItems.filter((item) => item.status !== "done").map((item) => ({ id: item.id, title: item.title, at: item.dueAt, dayKey: dayKey(dateParts(item.dueAt)), kind: "task" as const, detail: item.assignee })),
  ].sort((left, right) => left.at.localeCompare(right.at)), [meetings, workItems]);
  const visibleEntries = entries.filter((entry) => {
    const parts = dateParts(entry.at);
    return parts.year === activeMonth.year && parts.month === activeMonth.month;
  });
  const today = dayKey(dateParts(new Date()));

  return (
    <section aria-label="团队日历月视图" className="overflow-hidden rounded-lg border bg-card">
      <header className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-primary">Team schedule</p>
          <h2 className="font-editorial text-2xl font-normal tracking-tight">{activeMonth.year}年{activeMonth.month}月</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="icon-lg" aria-label="上个月" onClick={() => setActiveMonth((value) => moveMonth(value, -1))}><ChevronLeft aria-hidden="true" /></Button>
          <Button variant="outline" size="lg" aria-label="返回本月" onClick={() => setActiveMonth(baseline)}><CalendarDays aria-hidden="true" />本月</Button>
          <Button variant="outline" size="icon-lg" aria-label="下个月" onClick={() => setActiveMonth((value) => moveMonth(value, 1))}><ChevronRight aria-hidden="true" /></Button>
        </div>
      </header>

      <div className="hidden md:grid xl:grid-cols-[13.5rem_minmax(0,1fr)]">
        <aside className="hidden border-r p-4 xl:block">
          <p className="mb-3 text-sm font-semibold">{activeMonth.year} 年 {activeMonth.month} 月</p>
          <MiniCalendar days={days} />
          <div className="mt-6 border-t pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">日历分类</p>
            <ul className="mt-3 grid gap-2.5 text-sm">
              <li className="flex items-center justify-between"><span className="flex items-center gap-2"><CalendarDays className="size-4 text-primary" aria-hidden="true" />会议</span><strong className="tabular-nums">{visibleEntries.filter((entry) => entry.kind === "meeting").length}</strong></li>
              <li className="flex items-center justify-between"><span className="flex items-center gap-2"><CheckSquare2 className="size-4 text-muted-foreground" aria-hidden="true" />任务截止</span><strong className="tabular-nums">{visibleEntries.filter((entry) => entry.kind === "task").length}</strong></li>
            </ul>
          </div>
          <div className="mt-6 rounded-md bg-muted/55 p-3 text-xs leading-5 text-muted-foreground">
            <strong className="block text-foreground">本月工作负载</strong>
            共 {visibleEntries.length} 项安排，会议与任务已按上海时区自动归档。
          </div>
        </aside>

        <div className="min-w-0 overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-7 border-b bg-muted/25 text-xs font-medium text-muted-foreground">
              {weekdayLabels.map((label) => <div key={label} className="px-3 py-2.5">周{label}</div>)}
            </div>
            <div className="grid grid-cols-7 border-l">
              {days.map((day) => {
                const dayEntries = entries.filter((entry) => entry.dayKey === day.key);
                return (
                  <div key={day.key} aria-label={`${day.year}年${day.month}月${day.day}日`} aria-current={day.key === today ? "date" : undefined} className={`min-h-28 border-r border-b p-2 ${day.inCurrentMonth ? "bg-card" : "bg-muted/20 text-muted-foreground/45"}`}>
                    <time dateTime={day.key} className={`mb-1.5 grid size-7 place-items-center rounded-md text-xs tabular-nums ${day.key === today ? "bg-primary font-semibold text-primary-foreground" : ""}`}>{day.day}</time>
                    <div className="grid gap-1">
                      {dayEntries.slice(0, 3).map((entry) => {
                        const Icon = entry.kind === "meeting" ? CalendarDays : CheckSquare2;
                        return <div key={`${entry.kind}-${entry.id}`} title={`${entry.title} · ${entry.detail}`} className={`flex min-w-0 items-start gap-1.5 rounded-md px-2 py-1.5 text-[11px] leading-4 ${entry.kind === "meeting" ? "bg-primary/[0.09] text-primary" : "bg-muted text-foreground"}`}><Icon className="mt-0.5 size-3 shrink-0" aria-hidden="true" /><span className="min-w-0"><strong className="block truncate font-medium">{entry.title}</strong><span className="block text-[10px] opacity-75">{formatTime(entry.at)}</span></span></div>;
                      })}
                      {dayEntries.length > 3 && <span className="px-2 text-[10px] text-muted-foreground">另有 {dayEntries.length - 3} 项</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <ol className="divide-y md:hidden">
        {visibleEntries.map((entry) => {
          const parts = dateParts(entry.at);
          const Icon = entry.kind === "meeting" ? CalendarDays : CheckSquare2;
          return <li key={`${entry.kind}-${entry.id}`} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3 p-4"><time dateTime={entry.at} className="text-center"><strong className="block font-editorial text-2xl font-normal tabular-nums">{parts.day}</strong><span className="text-[11px] text-muted-foreground">{formatTime(entry.at)}</span></time><div className="min-w-0"><div className="flex items-center gap-2"><Icon className={`size-4 ${entry.kind === "meeting" ? "text-primary" : "text-muted-foreground"}`} aria-hidden="true" /><span className="text-xs font-medium text-muted-foreground">{entry.kind === "meeting" ? "会议" : "任务截止"}</span></div><h3 className="mt-1 font-semibold">{entry.title}</h3><p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">{entry.kind === "meeting" && <MapPin className="size-3" aria-hidden="true" />}{entry.detail}</p></div></li>;
        })}
        {visibleEntries.length === 0 && <li className="p-8 text-center text-sm text-muted-foreground">本月暂无安排</li>}
      </ol>
    </section>
  );
}
