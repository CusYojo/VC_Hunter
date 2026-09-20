// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OfficeScene } from "@/components/organization/office/office-scene";
import type { OfficeGroup, OfficeMember, OfficeWorkspace } from "@/organization/office-contracts";
const members: OfficeMember[] = ["甲", "乙"].map((name, index) => ({ id: `m${index}`, name, title: "经理", departmentId: "d", departmentName: "投资部", groupIds: ["department:d"], style: { deskColor: "#b98758", deskShape: "classic", version: 1, avatarUrl: null }, profile: { version: 1, groupingMode: "department", displayedProjectId: null, description: "", presenceStatus: "office", customStatus: "" }, projects: [], tasks: [] }));
const groups: OfficeGroup[] = [{ id: "department:d", label: "投资部", kind: "department", projectId: null, departmentId: "d", stage: null, progress: { done: 0, total: 0 }, latestUpdate: null, seats: members.map((member, index) => ({ memberId: member.id, x: index, y: 0 })) }];
const activity: NonNullable<OfficeWorkspace["activity"]> = { todos: [], queues: [{ id: "q", kind: "approval", title: "预算审批", fromMemberId: "m0", toMemberId: "m1", targetUrl: "/work", createdAt: "2026-09-04" }], meetings: [] };
const props = { groups, members, paused: true, editing: false, onMember: vi.fn(), onMove: vi.fn() };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("draws a pending approval path, queues its requester, and returns them after resolution", () => {
  const { container, rerender } = render(<OfficeScene {...props} activity={activity} />);
  expect(container.querySelector('[data-office-person="m0"]')).toHaveAttribute("data-mode", "queue");
  expect(container.querySelectorAll('[data-office-footsteps]')).toHaveLength(1);
  rerender(<OfficeScene {...props} activity={{ ...activity, queues: [] }} />);
  expect(container.querySelector('[data-office-person="m0"]')).toHaveAttribute("data-mode", "desk");
  expect(container.querySelectorAll('[data-office-footsteps]')).toHaveLength(0);
});
it("keeps comments and other office activity out of the project-document approval queue", () => {
  const withComment = { ...activity, queues: [...activity.queues, { ...activity.queues[0], id: "second-approver", toMemberId: "m0" }, { ...activity.queues[0], id: "comment", kind: "comment" as const, fromMemberId: "m1", toMemberId: "m0" }] };
  const { container } = render(<OfficeScene {...props} activity={withComment} />);
  expect(container.querySelectorAll("[data-office-queue-seat]")).toHaveLength(2);
  expect(container.querySelector('[data-office-queue-seat="second-approver"]')).toBeInTheDocument();
  expect(container.querySelector('[data-office-queue-seat="comment"]')).not.toBeInTheDocument();
  expect(screen.getByText("项目资料审批排队")).toBeVisible();
});
it("puts meeting participants in a room before queued work, then returns to their queue or desk", () => {
  const meeting = { id: "meeting", title: "项目评审", memberIds: ["m0", "m1"], startsAt: "2026-09-04", targetUrl: "/work" };
  const { container, rerender } = render(<OfficeScene {...props} activity={{ ...activity, meetings: [meeting] }} />);
  expect(screen.getByRole("region", { name: "会议室 · 项目评审" })).toBeVisible();
  expect(container.querySelector('[data-office-person="m0"]')).toHaveAttribute("data-mode", "meeting");
  expect(container.querySelector('[data-office-person="m1"]')).toHaveAttribute("data-mode", "meeting");
  expect(container.querySelectorAll('[data-office-footsteps]')).toHaveLength(0);
  expect(container.querySelectorAll('[data-office-person]')).toHaveLength(2);
  rerender(<OfficeScene {...props} activity={activity} />);
  expect(container.querySelector('[data-office-person="m0"]')).toHaveAttribute("data-mode", "queue");
  expect(container.querySelector('[data-office-person="m1"]')).toHaveAttribute("data-mode", "desk");
});
it("keeps editing and filtered-out destinations from stranding people away from their desks", () => {
  const { container, rerender } = render(<OfficeScene {...props} activity={activity} editing />);
  expect(container.querySelector('[data-office-person="m0"]')).toHaveAttribute("data-mode", "desk");
  rerender(<OfficeScene {...props} groups={[{ ...groups[0], seats: [groups[0].seats[0]] }]} members={[members[0]]} activity={activity} />);
  expect(container.querySelector('[data-office-person="m0"]')).toHaveAttribute("data-mode", "desk");
  fireEvent.change(screen.getByRole("slider", { name: "办公室缩放" }), { target: { value: "150" } });
  expect(container.querySelectorAll('[data-office-person]')).toHaveLength(1);
});
