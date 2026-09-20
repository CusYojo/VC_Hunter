export interface IntelligenceSchedule { frequency: "daily" | "every_two_days" | "weekly"; time: string; weekdaysOnly: boolean; weekday?: number }

const SHANGHAI_OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;

export function nextIntelligencePlanRun(schedule: IntelligenceSchedule, now: string, lastRunAt?: string | null): string {
  const nowMs = parseTime(now);
  const [hour, minute] = parseClock(schedule.time);
  const local = localParts(nowMs);
  let candidate: number;
  if (schedule.frequency === "weekly") {
    const targetWeekday = schedule.weekday ?? 0;
    let daysAhead = (targetWeekday - local.weekday + 7) % 7;
    candidate = shanghaiTime(local.year, local.month, local.day + daysAhead, hour, minute);
    if (candidate <= nowMs) { daysAhead += 7; candidate = shanghaiTime(local.year, local.month, local.day + daysAhead, hour, minute); }
  } else if (schedule.frequency === "every_two_days" && lastRunAt) {
    const previous = localParts(parseTime(lastRunAt));
    candidate = shanghaiTime(previous.year, previous.month, previous.day + 2, hour, minute);
    while (candidate <= nowMs) candidate += 2 * DAY_MS;
  } else {
    candidate = shanghaiTime(local.year, local.month, local.day, hour, minute);
    const step = schedule.frequency === "every_two_days" ? 2 : 1;
    if (candidate <= nowMs) candidate += step * DAY_MS;
  }
  while (schedule.weekdaysOnly && [0, 6].includes(localParts(candidate).weekday)) candidate += DAY_MS;
  return new Date(candidate).toISOString();
}

export function nextWeekdayDigestRun(now: string): string {
  return nextIntelligencePlanRun({ frequency: "daily", time: "08:30", weekdaysOnly: true }, now);
}

export function shanghaiBusinessTime(now: string): { date: string; weekday: number; minutes: number; dayStart: string } {
  const time = parseTime(now);
  const parts = localParts(time);
  return {
    date: `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
    weekday: parts.weekday,
    minutes: parts.hour * 60 + parts.minute,
    dayStart: new Date(shanghaiTime(parts.year, parts.month, parts.day, 0, 0)).toISOString(),
  };
}

function localParts(time: number) {
  const date = new Date(time + SHANGHAI_OFFSET_MS);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), weekday: date.getUTCDay(), hour: date.getUTCHours(), minute: date.getUTCMinutes() };
}
function shanghaiTime(year: number, month: number, day: number, hour: number, minute: number): number { return Date.UTC(year, month - 1, day, hour, minute) - SHANGHAI_OFFSET_MS; }
function parseTime(value: string): number { const time = Date.parse(value); if (!Number.isFinite(time)) throw new RangeError("Invalid schedule time"); return time; }
function parseClock(value: string): [number, number] { const match = /^(\d{2}):(\d{2})$/u.exec(value); if (!match) throw new RangeError("Invalid schedule clock"); const hour = Number(match[1]); const minute = Number(match[2]); if (hour > 23 || minute > 59) throw new RangeError("Invalid schedule clock"); return [hour, minute]; }
