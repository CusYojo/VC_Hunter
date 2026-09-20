// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationWorkspace } from "@/components/organization/organization-workspace";
import { organizationFixture } from "../fixtures/organization";

const fetchMock = vi.fn();
const reply = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => status < 400 ? { data } : { error: { message: data } } });
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); fetchMock.mockResolvedValue(reply(organizationFixture)); });
afterEach(() => vi.unstubAllGlobals());

describe("organization workspace", () => {
  it("loads safe directory and shows department hierarchy, missing people and no private fields", async () => {
    render(<OrganizationWorkspace mode="public" />);
    await screen.findByRole("heading", { name: "投资部" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/organization");
    expect(screen.getByText(/上级部门：投资部/)).toBeTruthy();
    expect(screen.getByText(/预计 3 人/)).toBeTruthy();
    expect(screen.getByText(/仍有 2 人待补/)).toBeTruthy();
    expect(screen.getByText("占位 · 未开户")).toBeTruthy();
    expect(screen.queryByText("13800000000")).toBeNull();
    expect(screen.queryByRole("button", { name: /编辑/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("搜索姓名或职务"), { target: { value: "李研" } });
    expect(screen.getByText("李研")).toBeTruthy(); expect(screen.queryByText("张明")).toBeNull();
  });
  it("retries a failed read and handles empty search", async () => {
    fetchMock.mockResolvedValueOnce(reply("暂时不可用", 503));
    render(<OrganizationWorkspace mode="public" />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText("张明");
    fireEvent.change(screen.getByLabelText("搜索姓名或职务"), { target: { value: "不存在" } });
    expect(screen.getByText("没有匹配的成员")).toBeTruthy();
  });
  it("edits a member with version and shows persisted server result", async () => {
    render(<OrganizationWorkspace mode="admin" currentAccountId="a1" />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑李研" }));
    const editor = screen.getByRole("form", { name: "编辑成员" });
    fireEvent.change(within(editor).getByLabelText("职务"), { target: { value: "高级研究员" } });
    fireEvent.change(within(editor).getByLabelText("所属部门"), { target: { value: "d1" } });
    fireEvent.change(within(editor).getByLabelText("邮箱"), { target: { value: "li@example.com" } });
    fetchMock.mockResolvedValueOnce(reply({ ...organizationFixture.members[1], title: "高级研究员", departmentId: "d1", email: "li@example.com", version: 4 }));
    fireEvent.click(within(editor).getByRole("button", { name: "保存成员" }));
    await screen.findByText("成员信息已保存");
    expect(screen.getByText("高级研究员")).toBeTruthy();
    const request = fetchMock.mock.calls[1];
    expect(request[0]).toBe("/api/v1/admin/members/m2");
    expect(JSON.parse(request[1].body)).toMatchObject({ title: "高级研究员", departmentId: "d1", email: "li@example.com", expectedVersion: 3 });
    expect(request[1].headers["Idempotency-Key"]).toBeTruthy();
  });
  it("keeps edits after conflict and never retries an old version silently", async () => {
    render(<OrganizationWorkspace mode="admin" currentAccountId="a1" />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑李研" }));
    fireEvent.change(screen.getByLabelText("职务"), { target: { value: "我的修改" } });
    fetchMock.mockResolvedValueOnce(reply("版本冲突", 409));
    fireEvent.click(screen.getByRole("button", { name: "保存成员" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("已被更新"));
    expect(screen.getByLabelText("职务")).toHaveProperty("value", "我的修改");
    expect(screen.getByRole("button", { name: "保存成员" })).toHaveProperty("disabled", true);
  });
  it("protects current admin role and active flag; placeholders cannot receive account permissions", async () => {
    render(<OrganizationWorkspace mode="admin" currentAccountId="a1" />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑张明" }));
    expect(screen.getByLabelText("组织管理员")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("启用成员")).toHaveProperty("disabled", true);
    expect(screen.queryByLabelText(/密码/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "取消编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑人事主管" }));
    expect(screen.getByLabelText("组织管理员")).toHaveProperty("disabled", true);
  });
  it("filters members by department and adds a department with explicit parent", async () => {
    render(<OrganizationWorkspace mode="admin" currentAccountId="a1" />);
    await screen.findByText("李研");
    fireEvent.change(screen.getByLabelText("按部门筛选"), { target: { value: "d2" } });
    expect(screen.queryByText("张明")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "新增部门" }));
    fireEvent.change(screen.getByLabelText("部门名称"), { target: { value: "投后组" } });
    fireEvent.change(screen.getByLabelText("上级部门"), { target: { value: "d1" } });
    fetchMock.mockResolvedValueOnce(reply({ id: "d3", name: "投后组", parentId: "d1", expectedHeadcount: null, notes: "", sortOrder: 0, version: 1 }));
    fireEvent.click(screen.getByRole("button", { name: "保存部门" }));
    await screen.findByText("部门信息已保存");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/admin/departments");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ name: "投后组", parentId: "d1" });
  });
  it("shows network write errors without losing the form", async () => {
    render(<OrganizationWorkspace mode="admin" currentAccountId="a1" />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑李研" }));
    fetchMock.mockRejectedValueOnce(new Error("network"));
    fireEvent.click(screen.getByRole("button", { name: "保存成员" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("网络"));
    expect(screen.getByLabelText("姓名")).toHaveProperty("value", "李研");
  });
  it("saves placeholder names without sending unassigned account permissions", async () => {
    render(<OrganizationWorkspace mode="admin" currentAccountId="a1" />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑人事主管" }));
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "待招聘人事主管" } });
    fetchMock.mockResolvedValueOnce(reply({ ...organizationFixture.members[2], name: "待招聘人事主管", version: 2 }));
    fireEvent.click(screen.getByRole("button", { name: "保存成员" }));
    await screen.findByText("成员信息已保存");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ name: "待招聘人事主管", expectedVersion: 1 });
  });
  it("lets admin change another account's roles and activation, while requiring a role", async () => {
    render(<OrganizationWorkspace mode="admin" currentAccountId="a1" />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑李研" }));
    fireEvent.click(screen.getByLabelText("研究员"));
    fireEvent.click(screen.getByRole("button", { name: "保存成员" }));
    expect(screen.getByRole("alert").textContent).toContain("至少保留一种权限");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("只读成员"));
    fireEvent.click(screen.getByLabelText("启用成员"));
    fetchMock.mockResolvedValueOnce(reply({ ...organizationFixture.members[1], active: false, roles: ["viewer"], version: 4 }));
    fireEvent.click(screen.getByRole("button", { name: "保存成员" }));
    await screen.findByText("已停用");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ active: false, roles: ["viewer"], expectedVersion: 3 });
  });
  it("edits a department without permitting self or descendants as parent", async () => {
    render(<OrganizationWorkspace mode="admin" currentAccountId="a1" />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑投资部部门" }));
    expect(within(screen.getByLabelText("上级部门")).queryByRole("option", { name: "研究组" })).toBeNull();
    expect(within(screen.getByLabelText("上级部门")).queryByRole("option", { name: "投资部" })).toBeNull();
    fireEvent.change(screen.getByLabelText("部门名称"), { target: { value: "投资事业部" } });
    fireEvent.change(screen.getByLabelText("预计人数"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("显示顺序"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("部门备注"), { target: { value: "来源组织图" } });
    fetchMock.mockResolvedValueOnce(reply({ ...organizationFixture.departments[0], name: "投资事业部", expectedHeadcount: 8, notes: "来源组织图", sortOrder: 2, version: 2 }));
    fireEvent.click(screen.getByRole("button", { name: "保存部门" }));
    await screen.findByRole("heading", { name: "投资事业部" });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ expectedVersion: 1, expectedHeadcount: 8, sortOrder: 2, notes: "来源组织图" });
  });
  it("recovers department conflict only after explicit discard and reload", async () => {
    render(<OrganizationWorkspace mode="admin" currentAccountId="a1" />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑研究组部门" }));
    fetchMock.mockResolvedValueOnce(reply("版本冲突", 409));
    fireEvent.click(screen.getByRole("button", { name: "保存部门" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "保存部门" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "放弃修改并重新载入" }));
    await screen.findByText("李研");
    expect(screen.queryByRole("form", { name: "编辑部门" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("navigates department tree and clears a filter without inventing members", async () => {
    fetchMock.mockResolvedValueOnce(reply({ ...organizationFixture, departments: [...organizationFixture.departments, { id: "d3", name: "办事处", parentId: null, expectedHeadcount: 4, notes: "未展开单位", sortOrder: 5, version: 1 }] }));
    render(<OrganizationWorkspace mode="public" />);
    fireEvent.click(await screen.findByRole("button", { name: "办事处" }));
    expect(screen.getByText("成员名单待补充")).toBeTruthy();
    expect(screen.getByText(/仍有 4 人待补/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "未分组" }));
    expect(screen.getByText("人事主管")).toBeTruthy(); expect(screen.queryByText("张明")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "全部成员" }));
    expect(screen.getByText("张明")).toBeTruthy();
  });
  it("cancels department editing without a write", async () => {
    render(<OrganizationWorkspace mode="admin" currentAccountId="a1" />);
    fireEvent.click(await screen.findByRole("button", { name: "新增部门" }));
    fireEvent.click(screen.getByRole("button", { name: "取消编辑" }));
    expect(screen.queryByRole("form")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("focuses the editor and prevents switching records while a draft is open", async () => {
    render(<OrganizationWorkspace mode="admin" currentAccountId="a1" />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑李研" }));
    expect(document.activeElement).toBe(screen.getByLabelText("姓名"));
    expect(screen.getByRole("button", { name: "编辑张明" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "新增部门" })).toHaveProperty("disabled", true);
  });
});
