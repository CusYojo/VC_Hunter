// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { act, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OfficeScene, CELL_WIDTH, CELL_HEIGHT } from "@/components/organization/office/office-scene";
import type { OfficeGroup, OfficeMember } from "@/organization/office-contracts";
const member: OfficeMember = { id: "m", name: "林川", title: "经理", departmentId: "d", departmentName: "投资部", groupIds: ["project:p"], style: { deskColor: "#aabbcc", deskShape: "classic", version: 1, avatarUrl: null }, profile: { version: 1, groupingMode: "project", displayedProjectId: "p", description: "", presenceStatus: "office", customStatus: "" }, projects: [{ id: "p", name: "星河机器人", stage: "dd", role: "负责人", progress: { done: 1, total: 3 }, latestUpdate: { title: "已完成技术访谈", at: "2026-09-04" } }], tasks: [] };
const group: OfficeGroup = { id: "project:p", label: "星河机器人", kind: "project", projectId: "p", departmentId: null, stage: "dd", progress: { done: 1, total: 3 }, latestUpdate: null, seats: [{ memberId: "m", x: 0, y: 0 }] };
const props = { groups: [group], members: [member], paused: true, editing: false, onMember: vi.fn(), onMove: vi.fn() };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("offers keyboard-accessible zoom controls and restores automatic fit after resizing", () => {
  let width = 800;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
  const callbacks: ResizeObserverCallback[] = [];
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class { constructor(callback: ResizeObserverCallback) { callbacks.push(callback); } observe() {} disconnect = disconnect; });
  const { unmount } = render(<OfficeScene {...props} />);
  const zoom = screen.getByRole("slider", { name: "办公室缩放" });
  expect(zoom).toHaveValue("100");
  fireEvent.click(screen.getByRole("button", { name: "放大办公室" }));
  expect(zoom).toHaveValue("110");
  fireEvent.change(zoom, { target: { value: "150" } });
  expect(screen.getByRole("button", { name: "放大办公室" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "缩小办公室" }));
  expect(zoom).toHaveValue("140");
  width = 240;
  act(() => callbacks.forEach(callback => callback([], {} as ResizeObserver)));
  expect(zoom).toHaveValue("140"); // User zoom stays until they choose fit.
  fireEvent.click(screen.getByRole("button", { name: "适应屏幕" }));
  expect(Number((zoom as HTMLInputElement).value)).toBeLessThan(100);
  width = 1000;
  act(() => callbacks.forEach(callback => callback([], {} as ResizeObserver)));
  expect(zoom).toHaveValue("100");
  unmount();expect(disconnect).toHaveBeenCalled();
});
it("shows both the project name and latest progress on the desk", () => {
  render(<OfficeScene {...props} />);
  const desk = screen.getByRole("button", { name: "查看林川的工作 · 星河机器人" });
  expect(desk).toHaveTextContent("星河机器人");expect(desk).toHaveTextContent("已完成技术访谈");
});
it.each([50, 150])("converts a %s percent drop to the original desk grid coordinates", (percent) => {
  const onMove = vi.fn();
  render(<OfficeScene {...props} editing onMove={onMove} />);
  fireEvent.change(screen.getByRole("slider", { name: "办公室缩放" }), { target: { value: String(percent) } });
  const floor = screen.getByRole("button", { name: "查看林川的工作 · 星河机器人" }).parentElement!;
  vi.spyOn(floor, "getBoundingClientRect").mockReturnValue({ left: 40, top: 20 } as DOMRect);
  const event = createEvent.drop(floor, { dataTransfer: { getData: () => JSON.stringify({ groupId: group.id, memberId: "m" }) } });
  Object.defineProperties(event, { clientX: { value: 40 + (16 + 2 * CELL_WIDTH + 10) * percent / 100 }, clientY: { value: 20 + (16 + CELL_HEIGHT + 10) * percent / 100 } });
  fireEvent(floor, event);
  expect(onMove).toHaveBeenCalledWith(group.id, "m", 2, 1);
});
