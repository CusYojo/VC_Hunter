// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceActivityBoard } from "@/components/workspace-activity-board";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
afterEach(() => vi.unstubAllGlobals());
const props = { initial: [], members: [{ id: "alice", name: "发起人" }], projectOptions: [], currentUserId: "alice" };
it("defaults time at form opening and allows saving only type and title", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { id: "new", kind: "task", title: "个人待办", dueAt: null, description: "", location: "", projectId: null, createdBy: "alice", createdAt: new Date().toISOString(), version: 1, responses: [], audit: [] } }) });
  vi.stubGlobal("fetch", fetcher);
  render(<WorkspaceActivityBoard {...props} />);
  const before = Date.now(); fireEvent.click(screen.getByRole("button", { name: "新建事项" }));
  const time = screen.getByLabelText("截止或开始时间") as HTMLInputElement;
  expect(Math.abs(new Date(time.value).getTime() - before)).toBeLessThan(60000);
  expect(time).not.toBeRequired();
  expect(screen.getByLabelText("事项类型")).toBeRequired();
  expect(screen.getByLabelText("事项标题")).toBeRequired();
  fireEvent.change(time, { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("事项标题"), { target: { value: "个人待办" } });
  fireEvent.click(screen.getByRole("button", { name: "保存到工作空间" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ kind: "task", title: "个人待办", dueAt: null, participantIds: [] });
  await screen.findByText("未设置时间");
});
it("allows the creator to edit an activity and displays its latest edit time", async () => {
  const activity = { id: "edit-me", kind: "meeting" as const, title: "原会议", description: "原说明", dueAt: "2026-09-04T02:00:00Z", location: "", projectId: null, createdBy: "alice", createdAt: "2026-09-04T00:00:00Z", version: 1, responses: [], audit: [] };
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { ...activity, title: "调整后的会议", updatedAt: "2026-09-04T05:00:00Z", version: 2 } }) });
  vi.stubGlobal("fetch", fetcher);
  render(<WorkspaceActivityBoard {...props} initial={[activity]} />);
  fireEvent.click(screen.getByRole("button", { name: "事项概览：原会议" }));
  fireEvent.click(screen.getByRole("button", { name: "编辑事项" }));
  expect(screen.getByLabelText("事项标题")).toHaveValue("原会议");
  fireEvent.change(screen.getByLabelText("事项标题"), { target: { value: "调整后的会议" } });
  fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/v1/activity/edit-me/edit", expect.objectContaining({ method: "PATCH" })));
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ expectedVersion: 1, title: "调整后的会议" });
  await screen.findByText(/最后编辑/);
});
it("shows the real weekly calendar and sends a multi-hour end time", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok:true, json:async()=>({ data:{ id:"span",kind:"meeting",title:"跨时段会议",description:"",dueAt:"2026-09-06T01:30:00.000Z",endAt:"2026-09-06T04:00:00.000Z",location:"",projectId:null,createdBy:"alice",createdAt:new Date().toISOString(),version:1,responses:[],audit:[] } }) });
  vi.stubGlobal("fetch",fetcher); render(<WorkspaceActivityBoard {...props} />);
  expect(screen.getByRole("heading",{name:"日程"})).toBeVisible();
  fireEvent.click(screen.getByRole("button",{name:"新建事项"}));
  fireEvent.change(screen.getByLabelText("事项类型"),{target:{value:"meeting"}});
  fireEvent.change(screen.getByLabelText("事项标题"),{target:{value:"跨时段会议"}});
  fireEvent.change(screen.getByLabelText("截止或开始时间"),{target:{value:"2026-09-06T09:30"}});
  fireEvent.change(screen.getByLabelText("结束时间"),{target:{value:"2026-09-06T12:00"}});
  fireEvent.click(screen.getByRole("button",{name:"保存到工作空间"}));
  await waitFor(()=>expect(fetcher).toHaveBeenCalled());
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({dueAt:"2026-09-06T01:30:00.000Z",endAt:"2026-09-06T04:00:00.000Z"});
});

it("separates the task list from the calendar module", () => {
  const task = { id: "task", kind: "task" as const, title: "独立待办", description: "", dueAt: "2026-09-06T01:30:00.000Z", location: "", projectId: null, createdBy: "alice", createdAt: new Date().toISOString(), version: 1, responses: [], audit: [] };
  const { rerender } = render(<WorkspaceActivityBoard {...props} initial={[task]} mode="tasks" />);
  expect(screen.queryByRole("heading", { name: "日程" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /^我的待办与审批/ })).toBeVisible();

  rerender(<WorkspaceActivityBoard {...props} initial={[task]} mode="calendar" />);
  expect(screen.getByRole("heading", { name: "日程" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: /^我的待办与审批/ })).not.toBeInTheDocument();
});

it("offers 15-minute picker steps but accepts manually entered special minutes", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { id: "special", kind: "meeting", title: "特殊时间会议", description: "", dueAt: "2026-09-06T01:07:00.000Z", endAt: "2026-09-06T01:38:00.000Z", location: "", projectId: null, createdBy: "alice", createdAt: new Date().toISOString(), version: 1, responses: [], audit: [] } }) });
  vi.stubGlobal("fetch", fetcher);
  render(<WorkspaceActivityBoard {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "新建事项" }));
  const start = screen.getByLabelText("截止或开始时间") as HTMLInputElement;
  const end = screen.getByLabelText("结束时间") as HTMLInputElement;
  expect(start).toHaveAttribute("step", "900");
  expect(end).toHaveAttribute("step", "900");
  expect(screen.getByText("时间选择器按 15 分钟滚动；也可以直接输入任意分钟。" )).toBeVisible();
  fireEvent.change(screen.getByLabelText("事项类型"), { target: { value: "meeting" } });
  fireEvent.change(screen.getByLabelText("事项标题"), { target: { value: "特殊时间会议" } });
  fireEvent.change(start, { target: { value: "2026-09-06T09:07" } });
  fireEvent.change(end, { target: { value: "2026-09-06T09:38" } });
  expect(start).toHaveAttribute("step", "any");
  expect(end).toHaveAttribute("step", "any");
  fireEvent.click(screen.getByRole("button", { name: "保存到工作空间" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ dueAt: "2026-09-06T01:07:00.000Z", endAt: "2026-09-06T01:38:00.000Z" });
});

it("keeps every valid non-self reviewer when a multi-person item becomes a project-document approval", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { id: "approval", kind: "approval", title: "资料审批", description: "", dueAt: null, endAt: null, location: "", projectId: null, createdBy: "alice", createdAt: new Date().toISOString(), version: 1, responses: [{ memberId: "bob", action: "pending", note: "", respondedAt: null }], audit: [] } }) });
  vi.stubGlobal("fetch", fetcher);
  render(<WorkspaceActivityBoard {...props} members={[{ id: "alice", name: "发起人" }, { id: "bob", name: "审核人" }, { id: "carol", name: "协作人" }]} />);
  fireEvent.click(screen.getByRole("button", { name: "新建事项" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "发起人" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "审核人" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "协作人" }));
  fireEvent.change(screen.getByLabelText("事项类型"), { target: { value: "approval" } });
  expect(screen.queryByRole("checkbox", { name: "发起人" })).not.toBeInTheDocument();
  expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(2);
  fireEvent.change(screen.getByLabelText("事项标题"), { target: { value: "资料审批" } });
  fireEvent.click(screen.getByRole("button", { name: "保存到工作空间" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  expect(JSON.parse(fetcher.mock.calls[0][1].body).participantIds).toEqual(["bob", "carol"]);
});

it("drops inactive legacy participants before editing an activity", async () => {
  const activity = { id: "legacy", kind: "task" as const, title: "历史事项", description: "", dueAt: null, endAt: null, location: "", projectId: null, createdBy: "alice", createdAt: "2026-09-04T00:00:00Z", version: 1, responses: [{ memberId: "bob", action: "pending", note: "", respondedAt: null }, { memberId: "inactive", action: "pending", note: "", respondedAt: null }], audit: [] };
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { ...activity, version: 2, responses: [{ memberId: "bob", action: "pending", note: "", respondedAt: null }] } }) });
  vi.stubGlobal("fetch", fetcher);
  render(<WorkspaceActivityBoard {...props} initial={[activity]} members={[{ id: "alice", name: "发起人" }, { id: "bob", name: "有效成员" }]} />);
  fireEvent.click(screen.getByRole("button", { name: "事项概览：历史事项" }));
  fireEvent.click(screen.getByRole("button", { name: "编辑事项" }));
  fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  expect(JSON.parse(fetcher.mock.calls[0][1].body).participantIds).toEqual(["bob"]);
});
