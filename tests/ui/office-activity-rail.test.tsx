// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OfficeActivityRail } from "@/components/organization/office/office-activity-rail";
import type { OfficeMember } from "@/organization/office-contracts";

const members: OfficeMember[] = ["林川", "陈青"].map((name, index) => ({ id: `m${index}`, name, title: "经理", departmentId: "d", departmentName: "投资部", groupIds: [], style: { deskColor: "#aabbcc", deskShape: "classic", version: 1, avatarUrl: null }, profile: { version: 1, groupingMode: "department", displayedProjectId: null, description: "", presenceStatus: "office", customStatus: "" }, projects: [], tasks: [] }));
const activity = {
  todos: [
    { id: "later", kind: "task", title: "整理访谈", memberIds: ["m0"], dueAt: "2026-09-12T10:00:00+08:00", targetUrl: "/activities/later" },
    { id: "early", kind: "task", title: "核验预算", memberIds: ["m0", "m1"], dueAt: "2026-09-05T09:30:00+08:00", targetUrl: "/activities/early" },
    { id: "approve", kind: "approval", title: "审批立项", memberIds: ["m1"], dueAt: null, targetUrl: "/activities/approve" },
  ],
  queues: [{ id: "comment", kind: "comment" as const, title: "请补充回款依据", fromMemberId: "m0", toMemberId: "m1", targetUrl: "/projects/p?comment=c", createdAt: "2026-09-04T10:00:00+08:00" }],
  meetings: [{ id: "meeting", title: "项目讨论会", memberIds: ["m0", "m1"], startsAt: "2026-09-04T14:00:00+08:00", targetUrl: "/activities/meeting" }],
};

describe("office activity rail", () => {
  it("groups company todos by member and puts nearest deadlines first", () => {
    render(<OfficeActivityRail activity={activity} members={members} canManage />);
    expect(screen.getByRole("heading", { name: "全公司待办" })).toBeVisible();
    expect(screen.getByText("3 项待办")).toBeVisible();
    const person = screen.getByRole("region", { name: "林川的待办" });
    expect(within(person).getAllByRole("link").map(link => link.textContent)).toEqual(["核验预算", "整理访谈"]);
    expect(within(person).getByRole("link", { name: "核验预算" })).toHaveAttribute("href", "/activities/early");
    expect(within(person).getByText(/9月5日/)).toBeVisible();
    expect(screen.getByText("未设截止")).toBeVisible();
  });
  it("labels ordinary members by their actual visibility and filters approvals and tasks", () => {
    render(<OfficeActivityRail activity={activity} members={members} canManage={false} />);
    expect(screen.getByRole("heading", { name: "我可见的待办" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "审批" }));
    expect(screen.getByRole("button", { name: "审批" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("link", { name: "审批立项" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "整理访谈" })).toBeNull();
    expect(screen.queryByRole("link", { name: "项目讨论会" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "事项" }));
    expect(screen.getByRole("link", { name: "整理访谈" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "审批立项" })).toBeNull();
  });
  it("shows meeting participants and pending communication with links back to their records", () => {
    render(<OfficeActivityRail activity={activity} members={members} canManage />);
    fireEvent.click(screen.getByRole("button", { name: "会议" }));
    expect(screen.getByRole("heading", { name: /^当前会议/ })).toBeVisible();
    expect(screen.getByRole("link", { name: "项目讨论会" })).toHaveAttribute("href", "/activities/meeting");
    expect(screen.getByText("林川、陈青")).toBeVisible();
    expect(screen.queryByRole("link", { name: "审批立项" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "批注" }));
    expect(screen.getByRole("heading", { name: /^待沟通/ })).toBeVisible();
    expect(screen.getByText("林川 → 陈青")).toBeVisible();
    expect(screen.getByRole("link", { name: "请补充回款依据" })).toHaveAttribute("href", "/projects/p?comment=c");
    fireEvent.click(screen.getByRole("button", { name: "全部" }));
    expect(screen.getByRole("link", { name: "项目讨论会" })).toBeVisible();
  });
  it("supports older office responses without activity and honest empty filters", () => {
    const { rerender } = render(<OfficeActivityRail activity={undefined} members={members} canManage={false} />);
    expect(screen.getByText("暂无可见待办、会议或待沟通事项")).toBeVisible();
    rerender(<OfficeActivityRail activity={{ todos: [], meetings: [], queues: [activity.queues[0]] }} members={members} canManage />);
    fireEvent.click(screen.getByRole("button", { name: "审批" }));
    expect(screen.getByText("暂无此类待办")).toBeVisible();
  });
  it("renders missing owners and invalid dates safely without exposing raw member IDs", () => {
    render(<OfficeActivityRail activity={{ todos: [{ ...activity.todos[0], memberIds: [], dueAt: "invalid" }, { ...activity.todos[1], memberIds: ["private-id"] }], meetings: [], queues: [] }} members={members} canManage />);
    expect(screen.getByRole("region", { name: "待分配的待办" })).toBeVisible();
    expect(screen.getByRole("region", { name: "待确认成员的待办" })).toBeVisible();
    expect(screen.getByText("时间待确认")).toBeVisible();
    expect(screen.queryByText("private-id")).toBeNull();
  });
  it("never makes unsafe cross-origin or script targets clickable", () => {
    const targets = ["https://example.com", "//example.com", "/\\example.com", "javascript:alert(1)", "/\n/example.com"];
    render(<OfficeActivityRail activity={{ todos: targets.map((targetUrl, index) => ({ ...activity.todos[0], id: String(index), title: `安全事项${index}`, targetUrl })), meetings: [], queues: [] }} members={members} canManage />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByText("安全事项0")).toBeVisible();
  });
  it("keeps scheduled meetings as todos but shows active meetings only once", () => {
    const scheduled = { ...activity.todos[0], id: "scheduled", kind: "meeting", title: "明日访谈" };
    const active = { ...scheduled, id: activity.meetings[0].id, title: activity.meetings[0].title };
    render(<OfficeActivityRail activity={{ todos: [scheduled, active, { ...activity.todos[1], kind: "trip", memberIds: ["m1"] }], meetings: activity.meetings, queues: [] }} members={members} canManage />);
    fireEvent.click(screen.getByRole("button", { name: "会议" }));
    expect(screen.getAllByRole("link", { name: "项目讨论会" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "明日访谈" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "事项" }));
    expect(screen.getByText("出差")).toBeVisible();
    expect(screen.queryByRole("link", { name: "明日访谈" })).toBeNull();
  });
  it("allows ending only meetings explicitly authorized by the server and passes their version", () => {
    const onEndMeeting = vi.fn();
    const meeting = { ...activity.meetings[0], canEnd: true, version: 4 };
    render(<OfficeActivityRail activity={{ ...activity, meetings: [meeting, { ...meeting, id: "other", title: "其他会议", canEnd: false }] }} members={members} canManage={false} onEndMeeting={onEndMeeting} />);
    const button = screen.getByRole("button", { name: "结束会议：项目讨论会" });
    fireEvent.click(button);
    expect(onEndMeeting).toHaveBeenCalledExactlyOnceWith(meeting);
    expect(screen.queryByRole("button", { name: "结束会议：其他会议" })).toBeNull();
  });
  it("hides completion without a callback or permission, and disables actions during completion", () => {
    const onEndMeeting = vi.fn();
    const meeting = { ...activity.meetings[0], canEnd: true, version: 4 };
    const props = { activity: { ...activity, meetings: [meeting] }, members, canManage: true };
    const { rerender } = render(<OfficeActivityRail {...props} />);
    expect(screen.queryByRole("button", { name: "结束会议：项目讨论会" })).toBeNull();
    rerender(<OfficeActivityRail {...props} activity={activity} onEndMeeting={onEndMeeting} />);
    expect(screen.queryByRole("button", { name: "结束会议：项目讨论会" })).toBeNull();
    rerender(<OfficeActivityRail {...props} onEndMeeting={onEndMeeting} endingMeetingId={meeting.id} />);
    const button = screen.getByRole("button", { name: "结束会议：项目讨论会" });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("正在结束");
    fireEvent.click(button);
    expect(onEndMeeting).not.toHaveBeenCalled();
    rerender(<OfficeActivityRail {...props} onEndMeeting={onEndMeeting} endingMeetingId="another" />);
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("结束会议");
  });
});
