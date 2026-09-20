// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OperationRecords } from "@/components/operating/operation-records";
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const empty = { records: [], canWrite: true, funds: [], projects: [{ id: "p1", name: "测试项目" }], documents: [{ id: "d1", projectId: "p1", originalName: "证明.txt" }] };
afterEach(() => vi.unstubAllGlobals());
describe("real operations workspace", () => {
  it("creates a persistent expense with an existing project document", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => ({ ok: true, json: async () => url.startsWith("/api/v1/project-files") ? { data: { items: [{ id: "d1", projectId: "p1", projectName: "测试项目", originalName: "证明.txt", kind: "text", byteLength: 10, createdAt: "2026-09-04" }], total: 1, hasMore: false } } : init?.method ? { data: { id: "e1", kind: "expense", ...JSON.parse(String(init.body)), version: 1, archived: false, updatedAt: "2026-09-04" } } : { data: empty } }));
    vi.stubGlobal("fetch", fetcher); render(<OperationRecords kind="expense" />);
    fireEvent.click(await screen.findByRole("button", { name: "新建费用" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "真实差旅" } });
    fireEvent.change(screen.getByLabelText("费用金额（元）"), { target: { value: "120.50" } });
    fireEvent.change(screen.getByLabelText("发生日期"), { target: { value: "2026-09-04" } });
    fireEvent.change(screen.getByLabelText("关联项目"), { target: { value: "p1" } });
    fireEvent.click(screen.getByRole("button", { name: "@ 项目库文件" }));
    fireEvent.click(await screen.findByRole("button", { name: /证明.txt/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    const request = fetcher.mock.calls.find(([, init]) => init?.method === "POST")?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({ name: "真实差旅", data: { amountCny: 120.5, projectId: "p1", documentIds: ["d1"] } });
    expect(await screen.findByText("真实差旅")).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });
  it("does not offer mutation to a viewer and reports loading failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: { ...empty, canWrite: false } }) })));
    render(<OperationRecords kind="fund" />);
    expect(await screen.findByText("暂无基金记录")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "新建基金" })).toBeNull();
  });
  it("retains a draft after save failure and never reports a real bank transfer", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => ({ ok: !init?.method, json: async () => init?.method ? { error: { message: "版本冲突，请刷新" } } : { data: empty } })));
    render(<OperationRecords kind="payment" />);
    fireEvent.click(await screen.findByRole("button", { name: "新建付款记录" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "待处理付款" } });
    fireEvent.change(screen.getByLabelText("付款金额（元）"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("收款方"), { target: { value: "测试公司" } });
    fireEvent.change(screen.getByLabelText("计划付款日"), { target: { value: "2026-09-04" } });
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
    expect((await screen.findByRole("alert")).textContent).toContain("版本冲突");
    expect((screen.getByLabelText("名称") as HTMLInputElement).value).toBe("待处理付款");
    expect(screen.getByText(/付款记录用于登记/)).toBeTruthy();
  });
  it("edits with a version and archives/restores while retaining original document links", async () => {
    let item = { id: "e1", kind: "expense", name: "原费用", status: "recorded", data: { amountCny: 10, occurredOn: "2026-09-04", projectId: "p1", documentIds: ["d1"] }, version: 1, archived: false, updatedAt: "2026-09-04" };
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method) { const patch = JSON.parse(String(init.body)); expect(patch.version).toBe(item.version); item = { ...item, ...patch, version: item.version + 1 }; return { ok: true, json: async () => ({ data: item }) }; }
      return { ok: true, json: async () => ({ data: { ...empty, records: [item] } }) };
    });
    vi.stubGlobal("fetch", fetcher); render(<OperationRecords kind="expense" />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑 原费用" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "已核对费用" } });
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
    fireEvent.click(await screen.findByRole("button", { name: "归档 已核对费用" }));
    expect(await screen.findByText("暂无费用记录")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("包含已归档"));
    fireEvent.click(await screen.findByRole("button", { name: "恢复 已核对费用" }));
    expect(await screen.findByRole("button", { name: "归档 已核对费用" })).toBeTruthy();
    fireEvent.click(screen.getByText("查看详情与关联资料"));
    expect(screen.getByRole("link", { name: "证明.txt · 下载" }).getAttribute("href")).toBe("/api/v1/projects/p1/documents/d1/content?download=1");
  });
  it("retries loading and retries a failed save using the same idempotency key", async () => {
    let reads = 0, writes = 0;
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method) { writes += 1; return { ok: writes > 1, json: async () => writes === 1 ? { error: { message: "网络暂不可用" } } : { data: { id: "c1", kind: "contact", ...JSON.parse(String(init.body)), version: 1, archived: false, updatedAt: "2026-09-04" } } }; }
      reads += 1; return { ok: reads > 1, json: async () => reads === 1 ? { error: { message: "加载失败" } } : { data: empty } };
    });
    vi.stubGlobal("fetch", fetcher); render(<OperationRecords kind="contact" />);
    expect((await screen.findByRole("alert")).textContent).toBe("加载失败");
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    fireEvent.click(await screen.findByRole("button", { name: "新建联系人" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "实际联系人" } });
    fireEvent.change(screen.getByLabelText("联系方式"), { target: { value: "public@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
    expect((await screen.findByRole("alert")).textContent).toBe("网络暂不可用");
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
    expect(await screen.findByRole("heading", { name: "实际联系人" })).toBeTruthy();
    const requests = fetcher.mock.calls.filter(([, init]) => init?.method).map(([, init]) => init!);
    expect((requests[0].headers as Record<string, string>)["idempotency-key"]).toBe((requests[1].headers as Record<string, string>)["idempotency-key"]);
  });

  it("saves local files as multipart and keeps their identity on retry", async () => {
    let writes = 0;
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method) {
        writes += 1;
        const form = init.body as FormData;
        const value = JSON.parse(String(form.get("payload")));
        return { ok: writes > 1, json: async () => writes === 1 ? { error: { message: "暂时未确认，请重试" } } : { data: { id: "c-file", kind: "contact", ...value, documents: [{ id: "doc-local", originalName: "联系方式.txt", kind: "text", byteLength: 4, source: "upload", createdAt: "2026-09-04" }], version: 1, archived: false, updatedAt: "2026-09-04" } } };
      }
      return { ok: true, json: async () => ({ data: empty }) };
    });
    vi.stubGlobal("fetch", fetcher); render(<OperationRecords kind="contact" />);
    fireEvent.click(await screen.findByRole("button", { name: "新建联系人" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "附件联系人" } });
    fireEvent.change(screen.getByLabelText("联系方式"), { target: { value: "office@example.test" } });
    fireEvent.change(screen.getByLabelText("附上文件"), { target: { files: [new File(["text"], "联系方式.txt", { type: "text/plain" })] } });
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
    expect((await screen.findByRole("alert")).textContent).toContain("暂时未确认");
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
    await screen.findByRole("heading", { name: "附件联系人" });
    const requests = fetcher.mock.calls.filter(([, init]) => init?.method).map(([, init]) => init!);
    expect((requests[0].body as FormData).getAll("files")).toHaveLength(1);
    expect((requests[0].headers as Record<string, string>)["content-type"]).toBeUndefined();
    expect((requests[0].headers as Record<string, string>)["idempotency-key"]).toBe((requests[1].headers as Record<string, string>)["idempotency-key"]);
    fireEvent.click(screen.getByText("查看详情与关联资料"));
    expect(screen.getByRole("link", { name: "联系方式.txt · 下载" }).getAttribute("href")).toBe("/api/v1/operations/contact/c-file/documents/doc-local?download=1");
  });

});
