// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfficeWorkspace } from "@/components/organization/office/office-workspace";
import type { OfficeWorkspace as Workspace } from "@/organization/office-contracts";

const project = { id: "p1", name: "星河机器人", stage: "dd", role: "负责人", progress: { done: 1, total: 3 }, latestUpdate: { title: "完成技术访谈", at: "2026-09-04T00:00:00.000Z" } };
const fixture: Workspace = {
  selfMemberId: "alice", canManage: false, layoutVersion: 1, groupingMode: "department",
  departments: [{ id: "invest", name: "投资部", groupingMode: "department" }, { id: "finance", name: "财务部", groupingMode: "department" }],
  members: [{ id: "alice", name: "林川", title: "投资经理", departmentId: "invest", departmentName: "投资部", groupIds: ["department:invest"], projects: [project, { ...project, id: "p2", name: "远山半导体" }], tasks: [], style: { version: 1, deskColor: "#956b48", deskShape: "classic", avatarUrl: null }, profile: { version: 1, groupingMode: "department", displayedProjectId: null, description: "", presenceStatus: "office", customStatus: "" } },
    { id: "bob", name: "陈青", title: "财务", departmentId: "finance", departmentName: "财务部", groupIds: ["department:finance"], projects: [project], tasks: [{ id: "task1", title: "核对预算", kind: "task", action: "pending", dueAt: null, projectId: "p1" }], style: { version: 1, deskColor: "#658370", deskShape: "round", avatarUrl: null }, profile: { version: 1, groupingMode: "department", displayedProjectId: null, description: "核对本周付款", presenceStatus: "away", customStatus: "" } }],
  groups: [{ id: "project:p1", label: "星河机器人", kind: "project", projectId: "p1", departmentId: null, stage: "dd", progress: { done: 1, total: 3 }, latestUpdate: project.latestUpdate, seats: [{ memberId: "alice", x: 0, y: 0 }] },
    { id: "project:p2", label: "远山半导体", kind: "project", projectId: "p2", departmentId: null, stage: "dd", progress: { done: 0, total: 0 }, latestUpdate: null, seats: [{ memberId: "alice", x: 0, y: 0 }] },
    { id: "department:finance", label: "财务部", kind: "department", projectId: null, departmentId: "finance", stage: null, progress: { done: 0, total: 0 }, latestUpdate: null, seats: [{ memberId: "bob", x: 0, y: 0 }] }],
};

function setup(data = fixture) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).endsWith("/avatar")) return Response.json({ data: null });
    if (init?.method === "PATCH") return Response.json({ data: { ...data.members[0].style, ...JSON.parse(String(init.body)), version: 2 } });
    return Response.json({ data });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
afterEach(() => vi.unstubAllGlobals());

describe("team office", () => {
  it("defaults to department grouping and persists the viewer's project grouping choice", async () => {
    const projectView = { ...fixture, groupingMode: "project" as const, members: fixture.members.map(member => member.id === "alice" ? { ...member, profile: { ...member.profile, version: 2, groupingMode: "project" as const } } : member) };
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => Response.json({ data: init?.method === "PATCH" && String(url).endsWith("/profile") ? projectView : fixture }));
    vi.stubGlobal("fetch", fetchMock); render(<OfficeWorkspace />);
    expect(await screen.findByRole("button", { name: "按部门" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "按项目" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/organization/office/profile", expect.objectContaining({ method: "PATCH", body: expect.stringContaining('"groupingMode":"project"') })));
  });
  it("shows real project groups, department work and supports the traditional view", async () => {
    setup(); render(<OfficeWorkspace />);
    expect(screen.getByRole("heading", { name: "团队办公室" })).toBeVisible();
    expect(await screen.findByText("外出")).toBeVisible();
    expect(await screen.findByRole("button", { name: "查看林川的工作 · 星河机器人" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "传统列表" }));
    expect(screen.getAllByText(/完成技术访谈/).length).toBeGreaterThan(0);
    expect(screen.getByText("核对预算")).toBeVisible();
    expect(screen.queryByRole("button", { name: "调整布局" })).toBeNull();
  });
  it("shows all projects for a member and saves only their own desk preference", async () => {
    const fetchMock = setup(); render(<OfficeWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "查看林川的工作 · 星河机器人" }));
    const detail = await screen.findByRole("dialog", { name: "林川的工作" });
    expect(detail).toHaveTextContent("远山半导体");
    fireEvent.click(screen.getByRole("button", { name: "自定义我的工位" }));
    fireEvent.change(screen.getByLabelText("工位颜色"), { target: { value: "#668877" } });
    fireEvent.change(screen.getByLabelText("工位形状"), { target: { value: "corner" } });
    fireEvent.click(screen.getByRole("button", { name: "保存工位" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/organization/office/me", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ expectedVersion: 1, deskColor: "#668877", deskShape: "corner" }) })));
    expect(await screen.findByText("工位外观已保存")).toBeVisible();
  });
  it("lets the signed-in member choose their displayed project, description and presence", async () => {
    const saved = { ...fixture, members: fixture.members.map(member => member.id === "alice" ? { ...member, profile: { version: 2, groupingMode: "department" as const, displayedProjectId: "p2", description: "拜访创始团队", presenceStatus: "custom" as const, customStatus: "客户现场" } } : member) };
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => Response.json({ data: init?.method === "PATCH" && String(url).endsWith("/profile") ? saved : fixture }));
    vi.stubGlobal("fetch", fetchMock); render(<OfficeWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "我的工位" }));
    fireEvent.click(screen.getByRole("button", { name: "自定义我的展示" }));
    fireEvent.change(screen.getByLabelText("办公室展示项目"), { target: { value: "p2" } });
    fireEvent.change(screen.getByLabelText("办公室个人描述"), { target: { value: "拜访创始团队" } });
    fireEvent.change(screen.getByLabelText("办公室状态"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("自定义办公室状态"), { target: { value: "客户现场" } });
    fireEvent.click(screen.getByRole("button", { name: "保存个人展示" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/organization/office/profile", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ expectedVersion: 1, groupingMode: "department", displayedProjectId: "p2", description: "拜访创始团队", presenceStatus: "custom", customStatus: "客户现场" }) })));
    expect(await screen.findByText("个人展示已保存")).toBeVisible();
  });
  it("provides administrator layout editing and a paused movement mode", async () => {
    setup({ ...fixture, canManage: true }); render(<OfficeWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "调整布局" }));
    expect(screen.getByText("保存布局")).toBeVisible();
    expect(screen.getByText("当前按部门显示；可在上方切换后分别保存工位位置。")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "暂停走动" }));
    expect(screen.getByRole("button", { name: "恢复走动" })).toBeVisible();
  });
  it("reports failed loading and retries without inventing placeholder employees", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(Response.json({ data: fixture }));
    vi.stubGlobal("fetch", fetchMock); render(<OfficeWorkspace />);
    expect(await screen.findByRole("alert")).toHaveTextContent("网络连接失败");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("button", { name: "查看林川的工作 · 星河机器人" })).toBeVisible();
  });
  it("filters members by project search and department without inventing group memberships", async () => {
    setup(); render(<OfficeWorkspace />);
    await screen.findByRole("button", { name: "查看陈青的工作 · 财务部" });
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索成员或项目" }), { target: { value: "远山" } });
    expect(screen.queryByRole("button", { name: "查看陈青的工作 · 财务部" })).toBeNull();
    expect(screen.getByRole("button", { name: "查看林川的工作 · 远山半导体" })).toBeVisible();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("办公室部门筛选"), { target: { value: "finance" } });
    expect(screen.queryByRole("button", { name: "查看林川的工作 · 星河机器人" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "传统列表" }));
    expect(screen.getByText("核对预算")).toBeVisible();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "无此成员" } });
    expect(screen.getByRole("heading", { name: "这里还没有匹配的工位" })).toBeVisible();
  });
  it("allows viewing a colleague but only exposes self customization", async () => {
    setup(); render(<OfficeWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "查看陈青的工作 · 财务部" }));
    const detail = await screen.findByRole("dialog", { name: "陈青的工作" });
    expect(detail).toHaveTextContent("核对预算");
    expect(within(detail).queryByRole("button", { name: "自定义我的工位" })).toBeNull();
    fireEvent.click(within(detail).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "我的工位" }));
    expect(await screen.findByRole("button", { name: "自定义我的工位" })).toBeVisible();
  });
  it("persists administrator coordinate edits and reloads the saved layout", async () => {
    let stored = { ...fixture, canManage: true, groupingMode: "project" as const, members: fixture.members.map(member => member.id === "alice" ? { ...member, profile: { ...member.profile, groupingMode: "project" as const } } : member) };
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        stored = { ...stored, layoutVersion: stored.layoutVersion + 1, groups: stored.groups.map(group => ({ ...group, seats: body.seats.filter((seat: { groupId: string }) => seat.groupId === group.id).map(({ memberId, x, y }: { memberId: string; x: number; y: number }) => ({ memberId, x, y })) })) };
      }
      return Response.json({ data: stored });
    });
    vi.stubGlobal("fetch", fetchMock); render(<OfficeWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "调整布局" }));
    fireEvent.change(screen.getByLabelText("林川工位列"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("林川工位行"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "保存布局" }));
    expect(await screen.findByText("办公室布局已保存")).toBeVisible();
    const request = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(JSON.parse(String(request[1]?.body))).toMatchObject({ expectedVersion: 1, seats: expect.arrayContaining([{ groupId: "project:p1", memberId: "alice", x: 3, y: 2 }]) });
    fireEvent.click(screen.getByRole("button", { name: "刷新办公室" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getByRole("button", { name: "调整布局" }));
    expect(screen.getByLabelText("林川工位列")).toHaveValue(3);
    expect(screen.getByLabelText("林川工位行")).toHaveValue(2);
    fireEvent.click(screen.getByRole("button", { name: "取消调整" }));
    expect(screen.queryByRole("region", { name: "工位布局编辑" })).toBeNull();
  });
  it("keeps unsaved coordinates after a version conflict and supports correcting them", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => init?.method === "PATCH"
      ? Response.json({ error: { message: "conflict" } }, { status: 409 }) : Response.json({ data: { ...fixture, canManage: true } }));
    vi.stubGlobal("fetch", fetchMock); render(<OfficeWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "调整布局" }));
    fireEvent.change(screen.getByLabelText("林川工位列"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "保存布局" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("资料已被更新");
    expect(screen.getByLabelText("林川工位列")).toHaveValue(2);
    fireEvent.change(screen.getByLabelText("林川工位列"), { target: { value: "-1" } });
    expect(screen.getByLabelText("林川工位列")).toHaveValue(2);
    fireEvent.change(screen.getByLabelText("林川工位列"), { target: { value: "4" } });
    expect(screen.getByLabelText("林川工位列")).toHaveValue(4);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(2));
    expect(screen.getByLabelText("林川工位列")).toHaveValue(4);
  });
  it("submits the active department layout without obsolete per-department grouping settings", async () => {
    const changed: Workspace = { ...fixture, canManage: true, layoutVersion: 2 };
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => Response.json({ data: init?.method === "PATCH" ? changed : { ...fixture, canManage: true } }));
    vi.stubGlobal("fetch", fetchMock); render(<OfficeWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "调整布局" }));
    fireEvent.change(screen.getByLabelText("调整小组"), { target: { value: "department:finance" } });
    fireEvent.change(screen.getByLabelText("陈青工位列"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "保存布局" }));
    expect(await screen.findByText("办公室布局已保存")).toBeVisible();
    const sent = JSON.parse(String(fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")?.[1]?.body));
    expect(sent.expectedVersion).toBe(1);
    expect(sent.departments).toEqual([]);
    expect(sent.seats).toContainEqual({ groupId: "department:finance", memberId: "bob", x: 2, y: 0 });
  });
  it("preserves a failed custom color and retries the same preference", async () => {
    let writes = 0;
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== "PATCH") return Response.json({ data: fixture });
      writes += 1;
      return writes === 1 ? Response.json({ error: { message: "暂时无法保存" } }, { status: 500 }) : Response.json({ data: { ...fixture.members[0].style, deskColor: "#aabbcc", version: 2 } });
    });
    vi.stubGlobal("fetch", fetchMock); render(<OfficeWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "我的工位" }));
    fireEvent.click(await screen.findByRole("button", { name: "自定义我的工位" }));
    fireEvent.change(screen.getByLabelText("工位颜色"), { target: { value: "#aabbcc" } });
    fireEvent.click(screen.getByRole("button", { name: "保存工位" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法保存");
    expect(screen.getByLabelText("工位颜色")).toHaveValue("#aabbcc");
    fireEvent.click(screen.getByRole("button", { name: "保存工位" }));
    expect(await screen.findByText("工位外观已保存")).toBeVisible();
    expect(writes).toBe(2);
  });
});
