// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ActivityCalendar, calendarWeek, shanghaiCalendarParts } from "@/components/activity-calendar";
import type { WorkspaceActivity } from "@/workbench/activity-contracts";
const event = (input: Partial<WorkspaceActivity> & Pick<WorkspaceActivity, "id" | "title">): WorkspaceActivity => ({ kind: "meeting", description: "", dueAt: null, endAt: null, location: "", projectId: null, createdBy: "alice", createdAt: "2026-09-01T00:00:00Z", version: 1, responses: [], audit: [], ...input, id: input.id, title: input.title });
const rows = [
  event({ id: "all", title: "全天材料准备", kind: "task" }),
  event({ id: "timed", title: "客户访谈", dueAt: "2026-09-02T01:30:00Z", endAt: "2026-09-02T04:00:00Z", location: "A会议室", description: "讨论产品验证" }),
  event({ id: "next", title: "下周会议", dueAt: "2026-09-08T02:00:00Z" }),
  event({ id: "cross", title: "跨日尽调", dueAt: "2026-09-04T11:00:00Z", endAt: "2026-09-05T02:00:00Z" }),
];
it("computes Monday weeks and Shanghai dates independently of browser timezone", () => {
  expect(shanghaiCalendarParts("2026-09-06T16:30:00Z")).toMatchObject({ date: "2026-09-07", minutes: 30 });
  expect(calendarWeek("2026-09-03T12:00:00Z").map(day => day.date)).toEqual(["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"]);
});
it("continues a cross-day event in each affected Shanghai day", () => {
  render(<ActivityCalendar items={rows} now="2026-09-03T04:00:00Z" onEdit={vi.fn()} />);
  expect(within(screen.getByRole("gridcell", { name:"2026-09-04日程" })).getByRole("button", { name:/跨日尽调/ })).toBeVisible();
  expect(within(screen.getByRole("gridcell", { name:"2026-09-05日程" })).getByRole("button", { name:/跨日尽调/ })).toBeVisible();
});
it("shows a weekly Outlook-style time grid, all-day items and multi-hour spans", () => {
  render(<ActivityCalendar items={rows} now="2026-09-03T04:00:00Z" onEdit={vi.fn()} />);
  expect(screen.getByRole("grid", { name: "2026年8月31日至9月6日日程" })).toBeVisible();
  expect(screen.getByRole("row", { name: "全天日程" })).toHaveTextContent("全天材料准备");
  const meeting = screen.getByRole("button", { name: /客户访谈.*09:30.*12:00/ });
  expect(meeting).toHaveStyle({ top: "96px", height: "160px" });
  expect(screen.getByText(/上海时间（UTC\+8）/)).toBeVisible();
  expect(screen.queryByText("下周会议")).not.toBeInTheDocument();
});
it("moves by week, returns to today and opens event details with creator edit", () => {
  const edit = vi.fn(); render(<ActivityCalendar items={rows} now="2026-09-03T04:00:00Z" currentUserId="alice" onEdit={edit} />);
  fireEvent.click(screen.getByRole("button", { name: "下一周" })); expect(screen.getByText("下周会议")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "今天" })); expect(screen.getByText("客户访谈")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /客户访谈.*09:30.*12:00/ }));
  const details = screen.getByRole("dialog", { name: "客户访谈" });
  expect(details).toHaveTextContent("A会议室"); expect(details).toHaveTextContent("讨论产品验证");
  fireEvent.click(within(details).getByRole("button", { name: "编辑事项" })); expect(edit).toHaveBeenCalledWith(expect.objectContaining({ id: "timed" }));
});
it("keeps mobile week scrolling inside the calendar and exposes day labels", () => {
  render(<ActivityCalendar items={rows} now="2026-09-03T04:00:00Z" onEdit={vi.fn()} />);
  const scroller = screen.getByTestId("calendar-week-scroll");
  expect(scroller).toHaveClass("overflow-x-auto", "max-w-full");
  expect(within(scroller).getAllByRole("columnheader")).toHaveLength(7);
  expect(screen.getByRole("button", { name: "上一周" })).toBeVisible();
});
