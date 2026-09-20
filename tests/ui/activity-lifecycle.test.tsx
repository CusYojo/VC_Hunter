// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceActivityBoard } from "@/components/workspace-activity-board";
import type { WorkspaceActivity } from "@/workbench/activity-contracts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock("@/components/activity-discussion", () => ({ ActivityDiscussion: () => <section aria-label="事项讨论"><label>批注草稿<textarea /></label><button>发表评论</button></section> }));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); window.history.replaceState({}, "", "/"); });
const base: WorkspaceActivity = { id: "approval", kind: "approval", title: "差旅费用报销", description: "客户拜访交通费", dueAt: "2026-09-05T02:00:00Z", location: "", projectId: null, createdBy: "alice", createdAt: "2026-09-04T02:00:00Z", version: 1, responses: [{ memberId: "bob", action: "pending", note: "", respondedAt: null }], audit: [], documents: [{ id: "d", originalName: "票据.txt", kind: "text", byteLength: 20, createdAt: "2026-09-04T02:00:00Z" }] };
const props = { initial: [base], members: [{ id: "alice", name: "发起人" }, { id: "bob", name: "审核人" }, { id: "carol", name: "复核人" }], projectOptions: [], currentUserId: "alice", onlyKind: "approval" as const };
const open = (title = base.title) => fireEvent.click(screen.getByRole("button", { name: `事项概览：${title}` }));

it("creates a reimbursement through the approval subtype without changing the activity kind", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { ...base, approvalType: "reimbursement" } }) });
  vi.stubGlobal("fetch", fetcher);
  render(<WorkspaceActivityBoard {...props} initial={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "新建事项" }));
  expect(screen.getByLabelText("审批类型")).toHaveValue("general");
  fireEvent.change(screen.getByLabelText("审批类型"), { target: { value: "reimbursement" } });
  fireEvent.change(screen.getByLabelText("事项标题"), { target: { value: base.title } });
  fireEvent.click(screen.getByRole("checkbox", { name: "审核人" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "复核人" }));
  fireEvent.click(screen.getByRole("button", { name: "保存到工作空间" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ kind: "approval", approvalType: "reimbursement", participantIds: ["bob", "carol"] });
  expect(await screen.findByText("报销")).toBeVisible();
});

it("requires inline confirmation before withdrawing and keeps failures retryable", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: false, json: async () => ({ error: { message: "版本已更新" } }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ data: { ...base, status: "withdrawn", version: 2 } }) });
  vi.stubGlobal("fetch", fetcher);
  render(<WorkspaceActivityBoard {...props} />); open();
  fireEvent.click(screen.getByRole("button", { name: "撤回申请" }));
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "取消撤回" }));
  expect(screen.queryByRole("button", { name: "确认撤回" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "撤回申请" }));
  fireEvent.click(screen.getByRole("button", { name: "确认撤回" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("版本已更新");
  expect(fetcher).toHaveBeenCalledWith("/api/v1/activity/approval/lifecycle", expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "withdraw", expectedVersion: 1 }) }));
  fireEvent.click(screen.getByRole("button", { name: "确认撤回" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: `事项概览：${base.title}` })).toBeNull());
});

it("offers creator completion only after every approver agrees and moves the result below active work", async () => {
  const approved = { ...base, responses: [{ ...base.responses[0], action: "approved" }] };
  const completed = { ...approved, status: "completed", archiveAt: "2026-09-05T16:00:00Z", completedAt: "2026-09-05T02:00:00Z", version: 2 };
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: completed }) }); vi.stubGlobal("fetch", fetcher);
  render(<WorkspaceActivityBoard {...props} initial={[approved, { ...base, id: "later", title: "另一项申请", dueAt: "2026-09-10T00:00:00Z" }]} />); open();
  expect(screen.queryByRole("button", { name: "撤回申请" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "任务已完成" }));
  await waitFor(() => expect(screen.getAllByRole("article").map(item => item.getAttribute("data-activity-id"))).toEqual(["later", "approval"]));
  expect(fetcher).toHaveBeenCalledWith("/api/v1/activity/approval/lifecycle", expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "complete", expectedVersion: 1 }) }));
  expect(screen.getByText(/次日自动归档/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "编辑事项" })).toBeNull();
});

it.each(["withdrawn", "completed", "archived"] as const)("keeps %s originals and discussion readable but disables edits, responses and attachment uploads", status => {
  window.history.replaceState({}, "", "/approvals?activity=approval");
  render(<WorkspaceActivityBoard {...props} initial={[{ ...base, status }]} />);
  const detail = screen.getByRole("region", { name: `${base.title}详细内容` });
  expect(within(detail).getByRole("link", { name: "下载 票据.txt" })).toBeVisible();
  expect(within(detail).getByRole("region", { name: "事项讨论" })).toBeVisible();
  expect(within(detail).queryByRole("button", { name: "编辑事项" })).toBeNull();
  expect(within(detail).queryByLabelText("上传审批资料")).toBeNull();
  expect(within(detail).queryByLabelText("处理意见（调整 / 退回时必填）")).toBeNull();
});

it("loads each history scope without crowding current work, and fetches missing historical deep links", async () => {
  const archived = { ...base, id: "history", title: "历史审批", status: "archived" };
  const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => ({ data: url.includes("archived") || url.includes("activity=history") ? [archived] : [{ ...archived, status: "withdrawn" }] }) }));
  vi.stubGlobal("fetch", fetcher);
  const { unmount } = render(<WorkspaceActivityBoard {...props} initial={[base, archived as WorkspaceActivity]} />);
  expect(screen.queryByRole("button", { name: "事项概览：历史审批" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "已归档" }));
  expect(await screen.findByRole("button", { name: "事项概览：历史审批" })).toBeVisible();
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/v1/activity?status=archived", expect.anything()));
  fireEvent.click(screen.getByRole("button", { name: "已撤回" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/v1/activity?status=withdrawn", expect.anything()));
  unmount(); window.history.replaceState({}, "", "/approvals?activity=history");
  render(<WorkspaceActivityBoard {...props} />);
  expect(await screen.findByRole("button", { name: "事项概览：历史审批" })).toHaveAttribute("aria-expanded", "true");
  expect(fetcher).toHaveBeenCalledWith("/api/v1/activity?activity=history", expect.anything());
});

it("does not let another participant withdraw or finish an approval, nor complete an empty approval", () => {
  const { unmount } = render(<WorkspaceActivityBoard {...props} currentUserId="bob" />); open();
  expect(screen.queryByRole("button", { name: "撤回申请" })).toBeNull();
  expect(screen.queryByRole("button", { name: "任务已完成" })).toBeNull();
  unmount();render(<WorkspaceActivityBoard {...props} initial={[{ ...base, responses: [] }]} />);open();
  expect(screen.getByRole("button", { name: "撤回申请" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "任务已完成" })).toBeNull();
});

it("refreshes from the server at the next day while pausing around forms and unsent discussion", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-05T15:59:45Z"));
  const completed = { ...base, status: "completed" as const, archiveAt: "2026-09-05T16:00:00Z" };
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })); vi.stubGlobal("fetch", fetcher);
  render(<WorkspaceActivityBoard {...props} initial={[completed]} />);
  fireEvent.click(screen.getByRole("button", { name: "新建事项" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));open();
  fireEvent.change(screen.getByLabelText("批注草稿"), { target: { value: "尚未发送" } });
  await act(async () => { window.dispatchEvent(new Event("focus"));await vi.advanceTimersByTimeAsync(30_000); });
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("批注草稿"), { target: { value: "" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(fetcher).toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: `事项概览：${base.title}` })).toBeNull();
});

it("rechecks a linked completed item after midnight instead of keeping its stale current status", async () => {
  vi.useFakeTimers(); window.history.replaceState({}, "", "/approvals?activity=approval");
  const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => ({ data: url.includes("activity=") ? [{ ...base, status: "archived" }] : [] }) }));
  vi.stubGlobal("fetch", fetcher);
  render(<WorkspaceActivityBoard {...props} initial={[{ ...base, status: "completed", archiveAt: "2026-09-05T16:00:00Z" }]} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(fetcher).toHaveBeenCalledWith("/api/v1/activity?activity=approval", expect.anything());
  expect(screen.queryByText(/次日自动归档/)).toBeNull();
  expect(within(screen.getByRole("button", { name: `事项概览：${base.title}` })).getByText("已归档")).toBeVisible();
});

it("lets a history selection supersede an in-flight automatic refresh", async () => {
  vi.useFakeTimers();
  let release!: (value: unknown) => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue({ ok: true, json: async () => ({ data: [{ ...base, title: "已归档历史", status: "archived" }] }) });
  vi.stubGlobal("fetch", fetcher);
  render(<WorkspaceActivityBoard {...props} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  fireEvent.click(screen.getByRole("button", { name: "已归档" }));
  await act(async () => { release({ ok: true, json: async () => ({ data: [base] }) }); });
  expect(fetcher).toHaveBeenCalledWith("/api/v1/activity?status=archived", expect.anything());
  expect(screen.getByRole("button", { name: "事项概览：已归档历史" })).toBeVisible();
});

it("allows the creator to withdraw a partially approved request and renders lifecycle audit text", () => {
  render(<WorkspaceActivityBoard {...props} initial={[{ ...base, responses: [{ ...base.responses[0], action: "approved" }, { ...base.responses[0], memberId: "third" }], audit: [{ actorId: "alice", action: "approval_completed", note: '{"version":2}', createdAt: base.createdAt }, { actorId: "system", action: "approval_archived", note: '{"version":3}', createdAt: base.createdAt }] }]} />);open();
  expect(screen.getByRole("button", { name: "撤回申请" })).toBeVisible();
  expect(screen.getByText(/系统 · 自动归档/)).toBeInTheDocument();
  expect(screen.queryByText(/\{"version":/)).toBeNull();
});

it("does not let a slow initial deep link response overwrite a newer completed record", async () => {
  window.history.replaceState({}, "", "/approvals?activity=approval");
  let release!: (value: unknown) => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue({ ok: true, json: async () => ({ data: [{ ...base, status: "completed", version: 2 }] }) });vi.stubGlobal("fetch", fetcher);
  render(<WorkspaceActivityBoard {...props} initial={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "刷新事项" }));
  await screen.findByText(/次日自动归档/);
  await act(async () => { release({ ok: true, json: async () => ({ data: [base] }) }); });
  expect(screen.getByText(/次日自动归档/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "撤回申请" })).toBeNull();
});
it("lets the applicant choose immediate archive when completing an approved request", async () => {
  const approved = { ...base, responses: [{ ...base.responses[0], action: "approved" }] };
  const archived = { ...approved, status: "archived", archivedAt: "2026-09-05T03:00:00Z", completedAt: "2026-09-05T03:00:00Z", archiveAt: "2026-09-05T03:00:00Z", version: 2 };
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: archived }) }); vi.stubGlobal("fetch", fetcher);
  render(<WorkspaceActivityBoard {...props} initial={[approved]} />); open();
  fireEvent.click(screen.getByRole("checkbox", { name: "完成后立即归档" }));
  fireEvent.click(screen.getByRole("button", { name: "任务已完成" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/v1/activity/approval/lifecycle", expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "complete", expectedVersion: 1, archiveNow: true }) })));
  await waitFor(() => expect(screen.queryByRole("button", { name: `事项概览：${base.title}` })).toBeNull());
});
it("uses Shanghai dates plus text and icons to distinguish today's unseen, pending and archived approvals", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-06T02:00:00Z"));
  const today = { ...base, id: "today", title: "今日审批", createdAt: "2026-09-05T16:00:00Z" };
  const older = { ...base, id: "older", title: "早前审批", createdAt: "2026-09-05T15:59:59Z" };
  const viewedToday = { ...base, id: "viewed", title: "已看待处理", createdAt: "2026-09-05T16:00:00Z", responses: [{ ...base.responses[0], viewedAt: "2026-09-06T01:00:00Z" }] };
  render(<WorkspaceActivityBoard {...props} currentUserId="bob" initial={[today, older, viewedToday]} />);
  const status = (title: string) => within(screen.getByRole("button", { name: `事项概览：${title}` })).getByTestId("approval-visual-status");
  expect(status("今日审批")).toHaveTextContent("当日未查看"); expect(status("今日审批").querySelector("svg")).not.toBeNull();
  expect(status("早前审批")).toHaveTextContent("未处理"); expect(status("早前审批").querySelector("svg")).not.toBeNull();
  expect(status("已看待处理")).toHaveTextContent("未处理");
});
it("shows completed recipient decisions and the applicant's active progress instead of calling them unprocessed", () => {
  const approved = { ...base, id: "approved", title: "已批准审批", responses: [{ ...base.responses[0], action: "approved" as const }] };
  const returned = { ...base, id: "returned", title: "已退回审批", responses: [{ ...base.responses[0], action: "returned" as const }] };
  const waiting = { ...base, id: "waiting", title: "等待审批" };
  const ready = { ...base, id: "ready", title: "等待完成", responses: [{ ...base.responses[0], action: "approved" as const }] };
  const { unmount } = render(<WorkspaceActivityBoard {...props} currentUserId="bob" initial={[approved, returned]} />);
  const recipientStatus = (title: string) => within(screen.getByRole("button", { name: `事项概览：${title}` })).getByTestId("approval-visual-status");
  expect(recipientStatus("已批准审批")).toHaveTextContent("已批准"); expect(recipientStatus("已批准审批").querySelector("svg")).not.toBeNull();
  expect(recipientStatus("已退回审批")).toHaveTextContent("已退回"); expect(recipientStatus("已退回审批").querySelector("svg")).not.toBeNull();
  unmount(); render(<WorkspaceActivityBoard {...props} initial={[waiting, ready]} />);
  const applicantStatus = (title: string) => within(screen.getByRole("button", { name: `事项概览：${title}` })).getByTestId("approval-visual-status");
  expect(applicantStatus("等待审批")).toHaveTextContent("处理中");
  expect(applicantStatus("等待完成")).toHaveTextContent("待完成");
});
it("labels archived approvals with both an archive icon and text", () => {
  window.history.replaceState({}, "", "/approvals?activity=archived");
  render(<WorkspaceActivityBoard {...props} currentUserId="bob" initial={[{ ...base, id: "archived", title: "归档审批", status: "archived" }]} />);
  const status = within(screen.getByRole("button", { name: "事项概览：归档审批" })).getByTestId("approval-visual-status");
  expect(status).toHaveTextContent("已归档"); expect(status.querySelector("svg")).not.toBeNull();
});
it("marks only the opened approval as viewed and changes its explicit status to pending", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-06T02:00:00Z"));
  const assigned = { ...base, createdAt: "2026-09-05T16:00:00Z", responses: [{ ...base.responses[0], assignedAt: "2026-09-05T16:00:00Z", viewedAt: null }] };
  const viewed = { ...assigned, responses: [{ ...assigned.responses[0], viewedAt: "2026-09-06T02:00:00Z" }] };
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: viewed }) }); vi.stubGlobal("fetch", fetcher);
  render(<WorkspaceActivityBoard {...props} currentUserId="bob" initial={[assigned]} />);
  const card = screen.getByRole("button", { name: `事项概览：${base.title}` });
  expect(within(card).getByTestId("approval-visual-status")).toHaveTextContent("当日未查看");
  fireEvent.click(card);
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/v1/activity/approval/view", { method: "POST" }));
  expect(within(screen.getByRole("button", { name: `事项概览：${base.title}` })).getByTestId("approval-visual-status")).toHaveTextContent("未处理");
});
