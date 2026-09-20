// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AvatarPanel } from "@/components/organization/office/avatar-panel";

const own = "/api/v1/organization/office/avatar";
const admin = "/api/v1/admin/organization/office/avatars";
const submission = { id: "avatar-1", memberId: "lin", memberName: "林川", status: "pending", version: 1, avatarUrl: `${own}/avatar-1/image`, reviewNote: "", createdAt: "2026-09-04T00:00:00.000Z", reviewedAt: null };
const png = () => new File(["image"], "我的头像.png", { type: "image/png" });
const updated = vi.fn();
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  updated.mockReset();
  fetchMock = vi.fn(async (url: string) => Response.json({ data: url === admin ? { items: [] } : { item: null } }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn(() => "blob:avatar-preview"); static revokeObjectURL = vi.fn(); });
});
afterEach(() => vi.unstubAllGlobals());

function mount(canManage = false) { return render(<AvatarPanel canManage={canManage} onUpdated={updated} />); }
async function select(file = png()) { fireEvent.change(await screen.findByLabelText("选择头像 PNG"), { target: { files: [file] } }); }

describe("office avatar upload and moderation", () => {
  it("offers the editable template and hides moderation from ordinary members", async () => {
    mount();
    expect(await screen.findByText("尚未上传自定义头像")).toBeVisible();
    expect(screen.getByRole("link", { name: "下载头像模板" })).toHaveAttribute("href", "/api/v1/organization/office/avatar-template");
    expect(screen.getByText(/32 × 48/)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "头像审核" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith(admin, expect.anything());
  });
  it("previews a selected image and uploads it without exposing an unreviewed avatar to the office", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => Response.json({ data: init?.method === "POST" ? submission : { item: null } }));
    mount(); await select();
    expect(screen.getByAltText("待提交头像预览")).toHaveAttribute("src", "blob:avatar-preview");
    fireEvent.click(screen.getByRole("button", { name: "提交头像审核" }));
    expect(await screen.findByText("已提交，审核通过后会显示在办公室。")).toBeVisible();
    expect(screen.getByText("待审核")).toBeVisible();
    const request = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")![1];
    expect(request.body.get("file")).toBeInstanceOf(File);
    expect(new Headers(request.headers).get("idempotency-key")).toBeTruthy();
    expect(updated).toHaveBeenCalledTimes(1);
  });
  it("keeps the selected file and retry key after a failed submission", async () => {
    let attempts = 0;
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") { attempts++; return attempts === 1 ? Response.json({ error: { message: "上传暂时失败" } }, { status: 503 }) : Response.json({ data: submission }); }
      return Response.json({ data: { item: null } });
    });
    mount(); await select(); fireEvent.click(screen.getByRole("button", { name: "提交头像审核" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("上传暂时失败");
    expect(screen.getByAltText("待提交头像预览")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "提交头像审核" }));
    await screen.findByText("已提交，审核通过后会显示在办公室。");
    const requests = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(requests[0][1].headers["Idempotency-Key"]).toBe(requests[1][1].headers["Idempotency-Key"]);
  });
  it("rejects oversized or non-PNG selections before sending them", async () => {
    mount(); await select(new File(["jpeg"], "头像.jpg", { type: "image/jpeg" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("PNG");
    await select(new File([new Uint8Array(256 * 1024 + 1)], "huge.png", { type: "image/png" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("256 KB");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });
  it("shows a rejected image and review note so the member can submit a replacement", async () => {
    fetchMock.mockResolvedValue(Response.json({ data: { item: { ...submission, status: "rejected", reviewNote: "请保留透明背景" } } }));
    mount(); expect(await screen.findByText("已退回")).toBeVisible();
    expect(screen.getByText("请保留透明背景")).toBeVisible();
    expect(screen.getByAltText("我提交的头像")).toHaveAttribute("src", submission.avatarUrl);
    await select(); expect(screen.getByRole("button", { name: "提交头像审核" })).toBeEnabled();
  });
  it("filters the administrator queue to pending and requires a note for rejection", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => Response.json({ data: init?.method === "PATCH" ? { ...submission, status: "rejected", version: 2, reviewNote: "请重新绘制" } : url === admin ? { items: [submission, { ...submission, id: "approved", memberName: "陈青", status: "approved" }] } : { item: null } }));
    mount(true);
    const queue = await screen.findByRole("region", { name: "头像审核" });
    expect(await within(queue).findByText("林川")).toBeVisible();
    expect(within(queue).queryByText("陈青")).toBeNull();
    fireEvent.click(within(queue).getByRole("button", { name: "退回林川的头像" }));
    expect(await within(queue).findByRole("alert")).toHaveTextContent("填写退回原因");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);
    fireEvent.change(within(queue).getByLabelText("审核意见 · 林川"), { target: { value: "请重新绘制" } });
    fireEvent.click(within(queue).getByRole("button", { name: "退回林川的头像" }));
    await waitFor(() => expect(updated).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(`${admin}/avatar-1`, expect.objectContaining({ method: "PATCH", body: JSON.stringify({ expectedVersion: 1, decision: "reject", note: "请重新绘制" }) }));
    fireEvent.click(within(queue).getByRole("button", { name: "全部申请" }));
    expect(await within(queue).findByText("陈青")).toBeVisible();
  });
  it("approves a pending avatar and reports a failed decision with retry controls", async () => {
    let patches = 0;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") { patches++; return patches === 1 ? Response.json({ error: { message: "审核保存失败" } }, { status: 503 }) : Response.json({ data: { ...submission, status: "approved", version: 2 } }); }
      return Response.json({ data: url === admin ? { items: [submission] } : { item: null } });
    });
    mount(true); const approve = await screen.findByRole("button", { name: "批准林川的头像" });
    fireEvent.click(approve); expect(await screen.findByRole("alert")).toHaveTextContent("审核保存失败");
    fireEvent.click(approve); await waitFor(() => expect(updated).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("没有待审核的头像")).toBeVisible();
  });
  it("lets the member retry loading after a network failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(Response.json({ data: { item: null } }));
    mount(); expect(await screen.findByRole("alert")).toHaveTextContent("网络连接失败");
    fireEvent.click(screen.getByRole("button", { name: "重新加载头像" }));
    expect(await screen.findByText("尚未上传自定义头像")).toBeVisible();
  });
});
