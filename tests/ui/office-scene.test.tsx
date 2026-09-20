// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { act, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfficeScene, CELL_HEIGHT, CELL_WIDTH } from "@/components/organization/office/office-scene";
import { MemberWork, TraditionalOffice, stageLabel } from "@/components/organization/office/office-details";
import type { OfficeGroup, OfficeMember } from "@/organization/office-contracts";

const member: OfficeMember = { id: "alice", name: "林川", title: "投资经理", departmentId: "invest", departmentName: "投资部", groupIds: ["project:p1", "project:p2"], style: { deskColor: "#aabbcc", deskShape: "classic", version: 1, avatarUrl: null }, profile: { version: 1, groupingMode: "department", displayedProjectId: null, description: "", presenceStatus: "office", customStatus: "" }, projects: [], tasks: [] };
const groups: OfficeGroup[] = ["p1", "p2"].map((id, index) => ({ id: `project:${id}`, label: `项目${index + 1}`, kind: "project", projectId: id, departmentId: null, stage: "new", progress: { done: 0, total: 0 }, latestUpdate: null, seats: [{ memberId: member.id, x: index, y: 0 }] }));
const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, "animate", originalAnimate);
  else Reflect.deleteProperty(HTMLElement.prototype, "animate");
});
function movementEnvironment(reduced = false) {
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel }));
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  const media = { matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("matchMedia", vi.fn(() => media));
  const observe = vi.fn(), disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class { observe = observe; disconnect = disconnect; });
  return { animate, cancel, media, observe, disconnect };
}

describe("office scene interactions", () => {
  it("moves multi-project members, cancels motion on pause/edit and cleans up observers", () => {
    const env = movementEnvironment();
    const props = { groups, members: [member], paused: false, editing: false, onMember: vi.fn(), onMove: vi.fn() };
    const { rerender, unmount } = render(<OfficeScene {...props} />);
    expect(env.animate).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ iterations: Infinity }));
    expect(env.observe).toHaveBeenCalled();
    rerender(<OfficeScene {...props} paused />);
    expect(env.cancel).toHaveBeenCalled();
    const stoppedAt = env.animate.mock.calls.length;
    act(() => window.dispatchEvent(new Event("resize")));
    expect(env.animate).toHaveBeenCalledTimes(stoppedAt);
    rerender(<OfficeScene {...props} />);
    expect(env.animate.mock.calls.length).toBeGreaterThan(stoppedAt);
    const movingAt = env.animate.mock.calls.length;
    rerender(<OfficeScene {...props} editing />);
    expect(env.animate).toHaveBeenCalledTimes(movingAt);
    unmount();
    expect(env.disconnect).toHaveBeenCalled();
    expect(env.media.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });
  it("honors reduced motion immediately and responds to a preference change", () => {
    const env = movementEnvironment(true);
    render(<OfficeScene groups={groups} members={[member]} paused={false} editing={false} onMember={vi.fn()} onMove={vi.fn()} />);
    expect(env.animate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "查看林川的工作 · 项目1" })).toBeVisible();
    env.media.matches = false;
    act(() => env.media.addEventListener.mock.calls[0][1]());
    expect(env.animate).toHaveBeenCalled();
  });
  it("keeps single-group members stationary and displays an approved image", () => {
    const env = movementEnvironment();
    const onMember = vi.fn();
    render(<OfficeScene groups={[groups[0]]} members={[{ ...member, style: { ...member.style, avatarUrl: "/api/v1/organization/office/avatars/approved" } }]} paused={false} editing={false} onMember={onMember} onMove={vi.fn()} />);
    expect(env.animate).not.toHaveBeenCalled();
    expect(screen.getByRole("img", { name: "林川的像素形象" })).toHaveAttribute("src", "/api/v1/organization/office/avatars/approved");
    fireEvent.click(screen.getByRole("button", { name: "查看林川的工作 · 项目1" }));
    expect(onMember).toHaveBeenCalledWith("alice");
  });
  it("accepts a dragged seat within its group and rejects foreign, malformed and read-only drags", () => {
    const onMove = vi.fn();
    const props = { groups: [groups[0]], members: [member], paused: true, editing: true, onMember: vi.fn(), onMove };
    const { rerender } = render(<OfficeScene {...props} />);
    const seat = screen.getByRole("button", { name: "查看林川的工作 · 项目1" });
    const floor = seat.parentElement!;
    const transfer = { setData: vi.fn(), getData: vi.fn(() => JSON.stringify({ groupId: "project:p1", memberId: "alice" })) };
    fireEvent.dragStart(seat, { dataTransfer: transfer });
    expect(transfer.setData).toHaveBeenCalledWith("application/office-seat", JSON.stringify({ groupId: "project:p1", memberId: "alice" }));
    const drop = () => {
      const event = createEvent.drop(floor, { dataTransfer: transfer });
      Object.defineProperties(event, { clientX: { value: 16 + CELL_WIDTH * 2 + 10 }, clientY: { value: 16 + CELL_HEIGHT + 10 } });
      fireEvent(floor, event);
    };
    fireEvent.dragOver(floor); drop();
    expect(onMove).toHaveBeenCalledWith("project:p1", "alice", 2, 1);
    transfer.getData.mockReturnValue(JSON.stringify({ groupId: "project:p2", memberId: "alice" })); drop();
    transfer.getData.mockReturnValue("not-json"); drop();
    transfer.getData.mockReturnValue(JSON.stringify({ groupId: "project:p1", memberId: "alice" }));
    rerender(<OfficeScene {...props} editing={false} />); drop();
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(seat).toHaveAttribute("draggable", "false");
  });
});

describe("office work summaries", () => {
  it("renders empty work as an explicit empty state and keeps other members read-only", () => {
    render(<MemberWork member={member} isSelf={false} onStyleSaved={vi.fn()} />);
    expect(screen.getByText("暂无已关联项目，可在项目中设置负责人或分配事项。")).toBeVisible();
    expect(screen.getByText("暂无可见的进行中事项")).toBeVisible();
    expect(screen.queryByRole("button", { name: "自定义我的工位" })).toBeNull();
  });
  it("shows support work and project links with meaningful progress and current due dates", () => {
    const person = { ...member, projects: [{ id: "p1", name: "项目1", stage: "researching", role: "协作", progress: { done: 1, total: 2 }, latestUpdate: null }], tasks: [{ id: "t", title: "核验财务", kind: "task", action: "pending", dueAt: "2026-09-10T00:00:00.000Z", projectId: "p1" }] };
    const onMember = vi.fn();
    const { unmount } = render(<TraditionalOffice groups={[{ ...groups[0], kind: "department", projectId: null, label: "支持部门", stage: null }]} members={[person]} onMember={onMember} />);
    expect(screen.getByText("核验财务")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "林川" })); expect(onMember).toHaveBeenCalledWith("alice");
    unmount();
    render(<MemberWork member={person} isSelf={false} onStyleSaved={vi.fn()} />);
    expect(screen.getByRole("link", { name: "项目1" })).toHaveAttribute("href", "/projects/p1");
    expect(screen.getByText("研究中")).toBeVisible();
    expect(screen.getByText(/截止/)).toHaveTextContent("2026/9/10");
  });
  it("localizes actual project stages while retaining custom stage names", () => {
    for (const stage of ["new", "researching", "contacting", "dd", "ic", "pass", "invested", "exited"]) expect(stageLabel(stage)).not.toBe(stage);
    expect(stageLabel("自定义流程")).toBe("自定义流程");
    expect(stageLabel(null)).toBe("部门协作");
  });
});
