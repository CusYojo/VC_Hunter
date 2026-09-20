// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceActivityBoard } from "@/components/workspace-activity-board";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock("@/components/activity-discussion", () => ({ ActivityDiscussion: ({ members }: { members: { id: string; name: string }[] }) => <section aria-label="事项讨论"><p>{members.map(member => member.name).join("、")}</p><button>讨论操作</button><a href="#discussion">讨论项目</a></section> }));
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, "", "/"); });
const props = { initial: [], members: [{ id: "alice", name: "王经理" }], projectOptions: [], currentUserId: "alice" };
it("shows a real empty inbox without fabricated tasks", () => {
  render(<WorkspaceActivityBoard {...props} />);
  expect(screen.getAllByText("暂无相关事项")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "新建事项" })).toBeTruthy();
});
it("reports unsuccessful server writes instead of optimistic success", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: { message: "权限不足" } }) }));
  render(<WorkspaceActivityBoard {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "新建事项" }));
  fireEvent.change(screen.getByLabelText("事项标题"), { target: { value: "核对项目" } });
  fireEvent.change(screen.getByLabelText("截止或开始时间"), { target: { value: "2026-09-05T10:00" } });
  fireEvent.click(screen.getByLabelText("王经理"));
  fireEvent.click(screen.getByRole("button", { name: "保存到工作空间" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("权限不足"));
});

const activity = { id: "approval", kind: "approval" as const, title: "技术尽调审批", description: "请核验最新技术访谈记录", dueAt: "2026-09-05T02:00:00Z", location: "会议室", projectId: "project", createdBy: "alice", createdAt: "2026-09-04T02:00:00Z", version: 1, responses: [{ memberId: "bob", action: "pending", note: "", respondedAt: null }, { memberId: "alice", action: "pending", note: "", respondedAt: null }], audit: [], documents: [] };
const cardProps = { ...props, initial: [activity], members: [{ id: "alice", name: "王经理" }, { id: "bob", name: "刘经理" }, { id: "outsider", name: "无关人员" }], projectOptions: [{ id: "project", name: "星河项目" }] };

it("starts collapsed with the requested summary fields and no detailed controls", () => {
  render(<WorkspaceActivityBoard {...cardProps} />);
  const summary = screen.getByRole("button", { name: "事项概览：技术尽调审批" });
  expect(summary).toHaveAttribute("aria-expanded", "false");
  for (const text of ["资料审批", "技术尽调审批", "请核验最新技术访谈记录", "发起人：王经理"]) expect(within(summary).getByText(text)).toBeVisible();
  expect(summary).toHaveTextContent("10:00");
  expect(screen.queryByRole("button", { name: "编辑事项" })).toBeNull();
  expect(screen.queryByRole("region", { name: "审批资料" })).toBeNull();
  expect(screen.queryByRole("region", { name: "事项讨论" })).toBeNull();
  expect(screen.queryByLabelText("处理意见（调整 / 退回时必填）")).toBeNull();
});

it("opens the complete workflow and restricts mention choices to current participants", () => {
  render(<WorkspaceActivityBoard {...cardProps} />);
  const summary = screen.getByRole("button", { name: "事项概览：技术尽调审批" });
  fireEvent.click(summary);
  expect(summary).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("button", { name: "编辑事项" })).toBeVisible();
  expect(screen.getByRole("region", { name: "审批资料" })).toBeVisible();
  expect(screen.getByLabelText("处理意见（调整 / 退回时必填）")).toBeVisible();
  const discussion = screen.getByRole("region", { name: "事项讨论" });
  expect(discussion).toHaveTextContent("王经理、刘经理");
  expect(discussion).not.toHaveTextContent("无关人员");
  fireEvent.click(screen.getByRole("button", { name: "讨论操作" }));
  fireEvent.click(screen.getByRole("link", { name: "讨论项目" }));
  expect(summary).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(summary);
  expect(screen.queryByRole("region", { name: "事项讨论" })).toBeNull();
});

it("opens only the deep-linked card and permits collapsing it or navigating to another", () => {
  window.history.replaceState({}, "", "/approvals?activity=approval");
  const initial = [activity, { ...activity, id: "other", title: "另一项审批" }];
  const { rerender } = render(<WorkspaceActivityBoard {...cardProps} initial={initial} />);
  const summary = screen.getByRole("button", { name: "事项概览：技术尽调审批" });
  expect(summary).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("button", { name: "事项概览：另一项审批" })).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(summary);
  expect(summary).toHaveAttribute("aria-expanded", "false");
  window.history.replaceState({}, "", "/approvals?activity=other");
  rerender(<WorkspaceActivityBoard {...cardProps} initial={initial} />);
  expect(screen.getByRole("button", { name: "事项概览：另一项审批" })).toHaveAttribute("aria-expanded", "true");
});

it("uses a native keyboard-focusable summary button controlling its detail region", () => {
  render(<WorkspaceActivityBoard {...cardProps} />);
  const summary = screen.getByRole("button", { name: "事项概览：技术尽调审批" });
  expect(summary.tagName).toBe("BUTTON");
  expect(summary).toHaveAttribute("type", "button");
  summary.focus(); expect(summary).toHaveFocus();
  fireEvent.click(summary);
  expect(document.getElementById(summary.getAttribute("aria-controls")!)).toBeVisible();
});

it("keeps a deep-linked item reachable beyond the compact four-card limit", () => {
  const initial = Array.from({ length: 5 }, (_, index) => ({ ...activity, id: `item-${index}`, title: `事项${index}` }));
  window.history.replaceState({}, "", "/?activity=item-4");
  render(<WorkspaceActivityBoard {...cardProps} initial={initial} compact />);
  expect(screen.getAllByRole("button", { name: /^事项概览：/ })).toHaveLength(5);
  expect(screen.getByRole("button", { name: "事项概览：事项4" })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("link", { name: "查看全部事项" })).toHaveAttribute("href", "/work");
});

it("preserves response actions, project links and audit history after expanding a task", async () => {
  const item = { ...activity, kind: "task" as const, responses: [{ memberId: "bob", action: "pending", note: "", respondedAt: null }, { memberId: "alice", action: "accepted", note: "资料齐全", respondedAt: null }], audit: [{ actorId: "alice", action: "created", note: "发起复核", createdAt: activity.createdAt }, { actorId: "alice", action: "edited", note: "", createdAt: activity.createdAt }] };
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { ...item, version: 2, responses: [{ ...item.responses[0], action: "change_requested", note: "补充财务资料" }, item.responses[1]] } }) });
  vi.stubGlobal("fetch", fetcher);
  render(<WorkspaceActivityBoard {...cardProps} currentUserId="bob" initial={[item]} />);
  fireEvent.click(screen.getByRole("button", { name: "事项概览：技术尽调审批" }));
  expect(screen.queryByRole("button", { name: "编辑事项" })).toBeNull();
  expect(screen.getByRole("link", { name: "星河项目" })).toHaveAttribute("href", "/projects/project");
  expect(screen.getByText("王经理 · 已接受：资料齐全")).toBeVisible();
  expect(screen.getByText("处理记录（2）")).toBeVisible();
  expect(screen.getByRole("button", { name: "建议调整" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("处理意见（调整 / 退回时必填）"), { target: { value: "补充财务资料" } });
  fireEvent.click(screen.getByRole("button", { name: "建议调整" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/v1/activity/approval", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ action: "change_requested", note: "补充财务资料", expectedVersion: 1 }) })));
  expect(screen.getByRole("button", { name: "事项概览：技术尽调审批" })).toHaveAttribute("aria-expanded", "true");
});

it("retains the opened card when a refresh fails and allows another refresh", async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error("刷新连接失败")).mockResolvedValueOnce({ ok: true, json: async () => ({ data: [activity] }) });
  vi.stubGlobal("fetch", fetcher);
  render(<WorkspaceActivityBoard {...cardProps} />);
  fireEvent.click(screen.getByRole("button", { name: "事项概览：技术尽调审批" }));
  fireEvent.click(screen.getByRole("button", { name: "刷新事项" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("刷新连接失败");
  expect(screen.getByRole("button", { name: "事项概览：技术尽调审批" })).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(screen.getByRole("button", { name: "刷新事项" }));
  expect(await screen.findByRole("status")).toHaveTextContent("已刷新事项及审批资料");
});
