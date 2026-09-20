// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceActivityBoard } from "@/components/workspace-activity-board";
import type { WorkspaceActivity } from "@/workbench/activity-contracts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
afterEach(() => vi.unstubAllGlobals());
const document = { id: "doc-1", originalName: "尽调说明.txt", kind: "text", byteLength: 30, createdAt: "2026-09-04T02:00:00.000Z" };
const item = { id: "approval-1", kind: "approval", title: "项目资料审核", description: "请核对附件", dueAt: "2026-09-05T02:00:00.000Z", location: "", projectId: null, createdBy: "alice", createdAt: "2026-09-04T02:00:00.000Z", version: 1, responses: [{ memberId: "bob", action: "pending", note: "", respondedAt: null }], audit: [], documents: [document] } as WorkspaceActivity;
const props = { initial: [item], members: [{ id: "alice", name: "发起人" }, { id: "bob", name: "审核人" }], projectOptions: [], currentUserId: "alice", onlyKind: "approval" as const };

it("uploads an approval attachment and displays the persisted result", async () => {
  const added = { ...document, id: "doc-2", originalName: "补充材料.txt" };
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { ...item, version: 2, documents: [document, added] } }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<WorkspaceActivityBoard {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "事项概览：项目资料审核" }));
  const file = new File(["已完成核验"], added.originalName, { type: "text/plain" });
  fireEvent.change(screen.getByLabelText("上传审批资料"), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: "上传资料" }));
  await waitFor(() => expect(screen.getByRole("button", { name: `预览 ${added.originalName}` })).toBeTruthy());
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe("/api/v1/activity/approval-1/documents");
  expect(options.body.get("file")).toBe(file);
  expect(options.body.get("expectedVersion")).toBe("1");
  expect(options.headers["idempotency-key"]).toBeTruthy();
});

it("lets the reviewer read escaped document text then return to the approval card", async () => {
  const viewed = { ...item, responses: [{ ...item.responses[0], viewedAt: "2026-09-05T01:00:00.000Z" }] };
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/view")) return { ok: true, json: async () => ({ data: viewed }) };
    if (url.endsWith("/documents/doc-1")) return { ok: true, json: async () => ({ data: { text: "已核验 <script>alert(1)</script>" } }) };
    if (url === "/api/v1/activity/approval-1" && options?.method === "PATCH") return { ok: true, json: async () => ({ data: { ...viewed, version: 2, responses: [{ ...viewed.responses[0], action: "approved" }] } }) };
    throw new Error(`Unexpected request: ${options?.method ?? "GET"} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<WorkspaceActivityBoard {...props} currentUserId="bob" />);
  fireEvent.click(screen.getByRole("button", { name: "事项概览：项目资料审核" }));
  expect(screen.queryByLabelText("上传审批资料")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "预览 尽调说明.txt" }));
  expect(await screen.findByText("已核验 <script>alert(1)</script>")).toBeTruthy();
  expect(documentElementScripts()).toBe(0);
  expect(screen.getByRole("link", { name: "下载 尽调说明.txt" }).getAttribute("href")).toBe("/api/v1/activity/approval-1/documents/doc-1?download=1");
  fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
  fireEvent.click(screen.getByRole("button", { name: "批准" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/activity/approval-1", expect.objectContaining({ method: "PATCH" })));
  expect(fetchMock).toHaveBeenCalledWith("/api/v1/activity/approval-1/view", { method: "POST" });
  expect(fetchMock).toHaveBeenCalledWith("/api/v1/activity/approval-1/documents/doc-1", expect.anything());
  const approvalCall = fetchMock.mock.calls.find(([url, options]) => url === "/api/v1/activity/approval-1" && options?.method === "PATCH")!;
  expect(JSON.parse(String(approvalCall[1]?.body))).toMatchObject({ action: "approved", expectedVersion: 1 });
});
function documentElementScripts() { return window.document.querySelectorAll("script").length; }

it("keeps failed uploads retryable without claiming success", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: { message: "内容已更新，请刷新后重试。" } }) }));
  render(<WorkspaceActivityBoard {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "事项概览：项目资料审核" }));
  fireEvent.change(screen.getByLabelText("上传审批资料"), { target: { files: [new File(["a"], "补充.txt", { type: "text/plain" })] } });
  fireEvent.click(screen.getByRole("button", { name: "上传资料" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "内容已更新，请刷新后重试。");
  expect(screen.getByRole("button", { name: "上传资料" }).hasAttribute("disabled")).toBe(false);
  expect(screen.queryByText("资料已上传，审核人可以在线预览。" )).toBeNull();
});

it("keeps completed attachments readable but prevents adding materials after a decision", () => {
  render(<WorkspaceActivityBoard {...props} initial={[{ ...item, responses: [{ ...item.responses[0], action: "approved" }] }]} />);
  fireEvent.click(screen.getByRole("button", { name: "事项概览：项目资料审核" }));
  expect(screen.queryByLabelText("上传审批资料")).toBeNull();
  expect(screen.getByRole("button", { name: "预览 尽调说明.txt" })).toBeTruthy();
});

it("reports preview errors with a download fallback", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: { message: "暂时无法预览，请下载原文件。" } }) }));
  render(<WorkspaceActivityBoard {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "事项概览：项目资料审核" }));
  fireEvent.click(screen.getByRole("button", { name: "预览 尽调说明.txt" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "暂时无法预览，请下载原文件。");
  expect(screen.getByRole("link", { name: "下载 尽调说明.txt" })).toBeTruthy();
});

it("refreshes updated materials before submitting the review with the latest version", async () => {
  const viewed = { ...item, responses: [{ ...item.responses[0], viewedAt: "2026-09-05T01:00:00.000Z" }] };
  const refreshed = { ...viewed, version: 3 };
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/view")) return { ok: true, json: async () => ({ data: viewed }) };
    if (url === "/api/v1/activity?status=current") return { ok: true, json: async () => ({ data: [refreshed] }) };
    if (url === "/api/v1/activity/approval-1" && options?.method === "PATCH") return { ok: true, json: async () => ({ data: { ...refreshed, version: 4, responses: [{ ...refreshed.responses[0], action: "approved" }] } }) };
    throw new Error(`Unexpected request: ${options?.method ?? "GET"} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<WorkspaceActivityBoard {...props} currentUserId="bob" />);
  fireEvent.click(screen.getByRole("button", { name: "事项概览：项目资料审核" }));
  fireEvent.click(screen.getByRole("button", { name: "刷新事项" }));
  await screen.findByText("已刷新事项及审批资料。");
  fireEvent.click(screen.getByRole("button", { name: "批准" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/activity/approval-1", expect.objectContaining({ method: "PATCH" })));
  expect(fetchMock).toHaveBeenCalledWith("/api/v1/activity/approval-1/view", { method: "POST" });
  expect(fetchMock).toHaveBeenCalledWith("/api/v1/activity?status=current", expect.anything());
  const approvalCall = fetchMock.mock.calls.find(([url, options]) => url === "/api/v1/activity/approval-1" && options?.method === "PATCH")!;
  expect(JSON.parse(String(approvalCall[1]?.body)).expectedVersion).toBe(3);
});

it.each([
  ["附件.exe", "a", "仅支持 PDF、DOCX、TXT 和 Markdown 文件。"],
  ["附件.txt", "", "文件不能为空。"],
])("rejects invalid upload %s before sending it", async (name, contents, message) => {
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  render(<WorkspaceActivityBoard {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "事项概览：项目资料审核" }));
  fireEvent.change(screen.getByLabelText("上传审批资料"), { target: { files: [new File([contents], name)] } });
  fireEvent.click(screen.getByRole("button", { name: "上传资料" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", message);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("retries the same uncertain upload without creating a duplicate request", async () => {
  const fetchMock = vi.fn().mockRejectedValueOnce(new Error("连接中断" )).mockResolvedValueOnce({ ok: true, json: async () => ({ data: { ...item, version: 2 } }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<WorkspaceActivityBoard {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "事项概览：项目资料审核" }));
  fireEvent.change(screen.getByLabelText("上传审批资料"), { target: { files: [new File(["a"], "资料.txt", { type: "text/plain" })] } });
  fireEvent.click(screen.getByRole("button", { name: "上传资料" }));
  await screen.findByText("连接中断");
  fireEvent.click(screen.getByRole("button", { name: "上传资料" }));
  await screen.findByText("资料已上传，审核人可以在线预览。");
  expect(fetchMock.mock.calls[0][1].headers["idempotency-key"]).toBe(fetchMock.mock.calls[1][1].headers["idempotency-key"]);
});

it("loads PDF bytes in a preview and releases them on close", async () => {
  const create = vi.fn(() => "blob:private-pdf"); const revoke = vi.fn();
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: revoke }));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["%PDF-1.7"], { type: "application/pdf" }) }));
  render(<WorkspaceActivityBoard {...props} initial={[{ ...item, documents: [{ ...document, originalName: "报告.pdf", kind: "pdf" }] } as WorkspaceActivity]} />);
  fireEvent.click(screen.getByRole("button", { name: "事项概览：项目资料审核" }));
  fireEvent.click(screen.getByRole("button", { name: "预览 报告.pdf" }));
  const frame = await screen.findByTitle("PDF 预览：报告.pdf");
  expect(frame.getAttribute("src")).toBe("blob:private-pdf");
  fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
  expect(revoke).toHaveBeenCalledWith("blob:private-pdf");
});

it("prevents a concurrent refresh from replacing a successful upload with stale materials", async () => {
  let complete!: (response: unknown) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { complete = resolve; })));
  render(<WorkspaceActivityBoard {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "事项概览：项目资料审核" }));
  fireEvent.change(screen.getByLabelText("上传审批资料"), { target: { files: [new File(["a"], "资料.txt", { type: "text/plain" })] } });
  fireEvent.click(screen.getByRole("button", { name: "上传资料" }));
  expect(screen.getByRole("button", { name: "刷新事项" }).hasAttribute("disabled")).toBe(true);
  complete({ ok: true, json: async () => ({ data: { ...item, version: 2 } }) });
  await screen.findByText("资料已上传，审核人可以在线预览。");
  expect(screen.getByRole("button", { name: "刷新事项" }).hasAttribute("disabled")).toBe(false);
});

it("clearly labels a truncated preview so approval is not based on an apparently complete document", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { text: "部分正文", truncated: true } }) }));
  render(<WorkspaceActivityBoard {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "事项概览：项目资料审核" }));
  fireEvent.click(screen.getByRole("button", { name: "预览 尽调说明.txt" }));
  expect(await screen.findByText("正文较长，当前仅显示部分内容。请下载原文件查看全文。")).toBeTruthy();
});

it("provides an honest empty-preview fallback without removing the original file", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { text: "" } }) }));
  render(<WorkspaceActivityBoard {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "事项概览：项目资料审核" }));
  fireEvent.click(screen.getByRole("button", { name: "预览 尽调说明.txt" }));
  expect(await screen.findByText("文件未提取到可读正文，请下载原文件查看。")).toBeTruthy();
  expect(screen.getByRole("link", { name: "下载 尽调说明.txt" })).toBeTruthy();
});

it("rejects oversize files without a network upload", async () => {
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  render(<WorkspaceActivityBoard {...props} initial={[{ ...item, documents: undefined }]} />);
  fireEvent.click(screen.getByRole("button", { name: "事项概览：项目资料审核" }));
  expect(screen.getByText("尚未上传审批资料。")).toBeTruthy();
  const large = new File([new Uint8Array(20 * 1024 * 1024 + 1)], "资料.pdf", { type: "application/pdf" });
  fireEvent.change(screen.getByLabelText("上传审批资料"), { target: { files: [large] } });
  fireEvent.click(screen.getByRole("button", { name: "上传资料" }));
  expect(await screen.findByText("单文件不能超过 20 MB。")).toBeTruthy();
  expect(fetchMock).not.toHaveBeenCalled();
});
