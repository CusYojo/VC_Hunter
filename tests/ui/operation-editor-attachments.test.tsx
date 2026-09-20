// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OperationEditor } from "@/components/operating/operation-editor";
import { OperationRecords } from "@/components/operating/operation-records";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const workspace = { records: [], canWrite: true, funds: [], projects: [{ id: "p1", name: "项目一" }, { id: "p2", name: "项目二" }], documents: [{ id: "d1", projectId: "p1", originalName: "第一份.txt" }] };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("preserves project references when changing the associated project and inserts files mentioned in notes", async () => {
  const onSave = vi.fn();
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ data: { items: [{ id: "d2", projectId: "p2", projectName: "项目二", originalName: "项目二资料.pdf" }], hasMore: false } }) }));
  vi.stubGlobal("fetch", fetcher);
  render(<OperationEditor kind="contact" record={{ id: "c1", kind: "contact", name: "联系人", status: "active", data: { contact: "公开渠道", projectId: "p1", documentIds: ["d1"] }, version: 1, archived: false, createdAt: "2026-09-04", updatedAt: "2026-09-04" }} workspace={workspace} busy={false} onSave={onSave} />);
  fireEvent.change(screen.getByLabelText("关联项目"), { target: { value: "p2" } });
  expect(screen.getByText("第一份.txt")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("备注 / 跟进记录"), { target: { value: "请参考 @项目二", selectionStart: 8 } });
  fireEvent.click(await screen.findByRole("button", { name: /项目二资料.pdf/ }));
  fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ projectId: "p2", documentIds: ["d1", "d2"], notes: expect.stringContaining("@项目二资料.pdf") }) }), []);
});

it("rotates the idempotency key when a failed upload is replaced with another same-name file", async () => {
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => ({ ok: !init?.method, json: async () => init?.method ? { error: { message: "保存失败，请重试" } } : { data: workspace } }));
  vi.stubGlobal("fetch", fetcher); render(<OperationRecords kind="contact" />);
  fireEvent.click(await screen.findByRole("button", { name: "新建联系人" }));
  fireEvent.change(screen.getByLabelText("名称"), { target: { value: "联系人" } });
  fireEvent.change(screen.getByLabelText("联系方式"), { target: { value: "公开渠道" } });
  fireEvent.change(screen.getByLabelText("附上文件"), { target: { files: [new File(["one"], "同名.txt", { type: "text/plain" })] } });
  fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "移除 同名.txt" }));
  fireEvent.change(screen.getByLabelText("附上文件"), { target: { files: [new File(["two"], "同名.txt", { type: "text/plain" })] } });
  fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
  await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method)).toHaveLength(2));
  const keys = fetcher.mock.calls.filter(([, init]) => init?.method).map(([, init]) => (init!.headers as Record<string, string>)["idempotency-key"]);
  expect(keys[0]).not.toBe(keys[1]);
});

it("opens saved local attachment content through the record's authorized endpoint", async () => {
  const item = { id: "c1", kind: "contact", name: "带附件联系人", status: "active", data: { contact: "公开渠道" }, documents: [{ id: "a1", source: "upload", originalName: "附件.txt", kind: "text", byteLength: 10, createdAt: "2026-09-04" }], version: 1, archived: false, createdAt: "2026-09-04", updatedAt: "2026-09-04" };
  const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith("/documents/a1") ? { data: { text: "已保存的附件正文" } } : { data: { ...workspace, records: [item] } } }));
  vi.stubGlobal("fetch", fetcher); render(<OperationRecords kind="contact" />);
  fireEvent.click(await screen.findByText("查看详情与关联资料"));
  fireEvent.click(screen.getByRole("button", { name: "查看 附件.txt" }));
  expect(await screen.findByText("已保存的附件正文")).toBeTruthy();
  expect(fetcher.mock.calls.some(([url]) => url === "/api/v1/operations/contact/c1/documents/a1")).toBe(true);
});
