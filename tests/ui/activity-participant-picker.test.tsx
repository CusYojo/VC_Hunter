// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ActivityParticipantPicker, recordRecentActivityParticipants } from "@/components/activity-participant-picker";
const members = [
  { id: "a", name: "张明", departmentId: "investment", departmentName: "投资部" },
  { id: "b", name: "李敏", departmentId: "operations", departmentName: "运营部" },
  { id: "c", name: "王宁", departmentId: "investment", departmentName: "投资部" },
  { id: "d", name: "赵云" },
];
const base = { members, selected: [], onChange: vi.fn(), scopeKey: "account-a" };
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
it("groups real departments and leaves missing metadata ungrouped", () => {
  render(<ActivityParticipantPicker {...base} />);
  const department = screen.getByRole("group", { name: "投资部" });
  expect(within(department).getAllByRole("checkbox")).toHaveLength(2);
  expect(within(screen.getByRole("group", { name: "未分组" })).getByRole("checkbox", { name: "赵云" })).toBeVisible();
  expect(screen.queryByText("最近选择")).not.toBeInTheDocument();
});
it("uses native labeled checkboxes and controlled immutable selection", () => {
  const selected = ["a"];
  const onChange = vi.fn();
  render(<ActivityParticipantPicker {...base} selected={selected} onChange={onChange} />);
  const checkbox = screen.getByRole("checkbox", { name: "张明" });
  checkbox.focus(); expect(checkbox).toHaveFocus(); expect(checkbox).toBeChecked();
  fireEvent.click(checkbox); expect(onChange).toHaveBeenLastCalledWith([]);
  fireEvent.click(screen.getByRole("checkbox", { name: "李敏" })); expect(onChange).toHaveBeenLastCalledWith(["a", "b"]);
  expect(selected).toEqual(["a"]);
  expect(localStorage.length).toBe(0);
});
it("searches names and departments without losing hidden selections", () => {
  render(<ActivityParticipantPicker {...base} selected={["b"]} />);
  fireEvent.change(screen.getByRole("searchbox", { name: "搜索姓名或部门" }), { target: { value: "投资" } });
  expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  expect(screen.getByText("已选 1 人")).toBeVisible();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "不存在" } });
  expect(screen.getByText("没有匹配的人员")).toBeVisible();
});
it("puts successfully recorded contacts first once, scoped to the current account", () => {
  recordRecentActivityParticipants("account-a", ["b", "a"]);
  recordRecentActivityParticipants("account-a", ["c"]);
  const { rerender } = render(<ActivityParticipantPicker {...base} />);
  const recent = screen.getByRole("group", { name: "最近选择" });
  expect(within(recent).getAllByRole("checkbox").map(item => item.getAttribute("aria-label"))).toEqual(["王宁", "李敏", "张明"]);
  expect(screen.getAllByRole("checkbox")).toHaveLength(4);
  rerender(<ActivityParticipantPicker {...base} scopeKey="account-b" />);
  expect(screen.queryByRole("group", { name: "最近选择" })).not.toBeInTheDocument();
  expect(screen.getByRole("group", { name: "投资部" })).toBeVisible();
});
it("ignores stale contacts and malformed storage and does not persist display names", () => {
  recordRecentActivityParticipants("account-a", ["missing", "a", "a"]);
  expect(localStorage.getItem(localStorage.key(0)!)).not.toContain("张明");
  const { unmount } = render(<ActivityParticipantPicker {...base} />);
  expect(within(screen.getByRole("group", { name: "最近选择" })).getAllByRole("checkbox")).toHaveLength(1);
  unmount(); localStorage.setItem(localStorage.key(0)!, "{bad");
  render(<ActivityParticipantPicker {...base} />);
  expect(screen.queryByRole("group", { name: "最近选择" })).not.toBeInTheDocument();
});
it("works when storage is unavailable and disables interaction while saving", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw Error("denied"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("denied"); });
  expect(() => recordRecentActivityParticipants("account-a", ["a"])).not.toThrow();
  render(<ActivityParticipantPicker {...base} busy />);
  expect(screen.getByRole("searchbox")).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "张明" })).toBeDisabled();
});

it("selects every eligible person or an entire department without duplicates", () => {
  recordRecentActivityParticipants("account-a", ["a"]);
  const onChange = vi.fn();
  const { rerender } = render(<ActivityParticipantPicker {...base} selected={[]} onChange={onChange} />);

  fireEvent.click(screen.getByRole("button", { name: "选择投资部全员" }));
  expect(onChange).toHaveBeenLastCalledWith(["a", "c"]);

  rerender(<ActivityParticipantPicker {...base} selected={["a", "c"]} onChange={onChange} />);
  expect(screen.getByRole("button", { name: "取消选择投资部全员" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "取消选择投资部全员" }));
  expect(onChange).toHaveBeenLastCalledWith([]);

  rerender(<ActivityParticipantPicker {...base} selected={["a"]} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "选择全部人员" }));
  expect(onChange).toHaveBeenLastCalledWith(["a", "b", "c", "d"]);
});

it("keeps hidden selections during search and limits bulk actions to the authorized member list", () => {
  const onChange = vi.fn();
  render(<ActivityParticipantPicker {...base} selected={["b", "stale-member"]} onChange={onChange} />);
  fireEvent.change(screen.getByRole("searchbox", { name: "搜索姓名或部门" }), { target: { value: "张明" } });
  fireEvent.click(screen.getByRole("button", { name: "选择投资部全员" }));
  expect(onChange).toHaveBeenLastCalledWith(["b", "a", "c"]);
  expect(screen.getByText("已选 1 人")).toBeVisible();
});

it("lets a project-document approval select multiple people and a whole department", () => {
  const onChange = vi.fn();
  render(<ActivityParticipantPicker {...base} selected={["a"]} onChange={onChange} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "李敏" }));
  expect(onChange).toHaveBeenLastCalledWith(["a", "b"]);
  fireEvent.click(screen.getByRole("button", { name: "选择投资部全员" }));
  expect(onChange).toHaveBeenLastCalledWith(["a", "c"]);
});
