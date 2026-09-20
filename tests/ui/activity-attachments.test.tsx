// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceActivityBoard } from "@/components/workspace-activity-board";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
afterEach(() => vi.unstubAllGlobals());
const props = { initial: [], members: [{ id: "alice", name: "发起人" }, { id: "bob", name: "接收人" }], projectOptions: [{ id: "p1", name: "项目甲" }, { id: "p2", name: "项目乙" }], currentUserId: "alice" };
it("offers local and project-library attachments for a new task", () => {
  render(<WorkspaceActivityBoard {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "新建事项" }));
  expect(screen.getByLabelText("附上文件")).toHaveAttribute("multiple");
  expect(screen.getByRole("button", { name: "@ 项目库文件" })).toBeVisible();
});

const libraryFile = { id: "project-doc-1", projectId: "p1", projectName: "项目甲", originalName: "项目说明.txt", kind: "text", byteLength: 50, createdAt: "2026-09-04T02:00:00.000Z" };
function setup({ failSave = false, failSearch = false }: { failSave?: boolean; failSearch?: boolean } = {}) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith("/api/v1/project-files")) return { ok: !failSearch, json: async () => failSearch ? { error: { message: "文件列表读取失败，请重试。" } } : { data: { items: [libraryFile], total: 1, hasMore: false } } };
    const body = init?.body instanceof FormData ? JSON.parse(String(init.body.get("payload"))) : JSON.parse(String(init?.body ?? "{}"));
    return { ok: !failSave, json: async () => failSave ? { error: { message: "保存失败，附件未提交。" } } : { data: { id: "activity-new", ...body, createdBy: "alice", version: 1, createdAt: "2026-09-04T02:00:00.000Z", responses: [{ memberId: "bob", action: "pending", note: "", respondedAt: null }], audit: [], documents: [] } } };
  });
  vi.stubGlobal("fetch", fetcher); render(<WorkspaceActivityBoard {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "新建事项" }));
  fireEvent.change(screen.getByLabelText("事项标题"), { target: { value: "资料复核会议" } });
  fireEvent.change(screen.getByLabelText("截止或开始时间"), { target: { value: "2026-09-05T10:00" } });
  fireEvent.click(screen.getByLabelText("接收人", { exact: true }));
  return { fetcher, writes: () => fetcher.mock.calls.filter(([, init]) => init?.method === "POST") };
}
async function chooseLibraryFile() {
  fireEvent.click(screen.getByRole("button", { name: "@ 项目库文件" }));
  fireEvent.click(await screen.findByRole("button", { name: /项目说明.txt/ }));
}
function save() { fireEvent.click(screen.getByRole("button", { name: "保存到工作空间" })); }

it("submits project-library references as JSON without uploading duplicate bytes", async () => {
  const state = setup(); await chooseLibraryFile(); save();
  await screen.findByText("已保存到工作空间，相关人员可查看最新状态。");
  expect(state.writes()).toHaveLength(1);
  const [url, request] = state.writes()[0]; expect(url).toBe("/api/v1/activity");
  expect(JSON.parse(request!.body as string)).toMatchObject({ projectDocumentIds: [libraryFile.id], title: "资料复核会议" });
  expect(request!.headers).toMatchObject({ "content-type": "application/json" });
});

it("creates a meeting and all local attachments in one multipart request", async () => {
  const state = setup();
  fireEvent.change(screen.getByLabelText("事项类型"), { target: { value: "meeting" } });
  const files = [new File(["会议议程"], "议程.txt", { type: "text/plain" }), new File(["待确认事项"], "待确认.md", { type: "text/markdown" })];
  fireEvent.change(screen.getByLabelText("附上文件"), { target: { files } });
  await chooseLibraryFile(); save();
  await screen.findByText("已保存到工作空间，相关人员可查看最新状态。");
  expect(state.writes()).toHaveLength(1);
  const [url, request] = state.writes()[0]; expect(url).toBe("/api/v1/activity");
  expect(request!.body).toBeInstanceOf(FormData);
  const form = request!.body as FormData;
  expect(form.getAll("files")).toEqual(files);
  expect(JSON.parse(String(form.get("payload")))).toMatchObject({ kind: "meeting", projectDocumentIds: [libraryFile.id] });
  expect(request!.headers).not.toHaveProperty("content-type");
});

it("opens library search from @ in the description and persists a structured reference", async () => {
  const state = setup();
  fireEvent.change(screen.getByLabelText("内容与资料说明"), { target: { value: "请核对 @项目说明" } });
  expect(await screen.findByLabelText("搜索项目库文件")).toHaveValue("项目说明");
  fireEvent.click(await screen.findByRole("button", { name: /项目说明.txt/ }));
  expect((screen.getByLabelText("内容与资料说明") as HTMLTextAreaElement).value.trim()).toBe("请核对 @项目说明.txt");
  save(); await screen.findByText("已保存到工作空间，相关人员可查看最新状态。");
  const body = JSON.parse(state.writes()[0][1]!.body as string);
  expect(body.projectDocumentIds).toEqual([libraryFile.id]);
  expect(body.description.trim()).toBe("请核对 @项目说明.txt");
});

it("removes pending local and project attachments before submission", async () => {
  const state = setup();
  fireEvent.change(screen.getByLabelText("附上文件"), { target: { files: [new File(["正文"], "未提交.txt", { type: "text/plain" })] } });
  await chooseLibraryFile();
  fireEvent.click(screen.getByRole("button", { name: "移除 未提交.txt" }));
  fireEvent.click(screen.getByRole("button", { name: "移除 项目说明.txt" }));
  save(); await screen.findByText("已保存到工作空间，相关人员可查看最新状态。");
  expect(JSON.parse(state.writes()[0][1]!.body as string)).toMatchObject({ projectDocumentIds: [] });
});

it("retains failed multipart drafts and retries with the same idempotency key", async () => {
  const state = setup({ failSave: true });
  const file = new File(["会议议程"], "议程.txt", { type: "text/plain" });
  fireEvent.change(screen.getByLabelText("附上文件"), { target: { files: [file] } }); save();
  expect(await screen.findByRole("alert")).toHaveTextContent("保存失败，附件未提交。");
  expect(screen.getByLabelText("事项标题")).toHaveValue("资料复核会议");
  expect(screen.getByRole("button", { name: "移除 议程.txt" })).toBeVisible();
  save();
  await waitFor(() => expect(state.writes()).toHaveLength(2));
  expect((state.writes()[0][1]!.headers as Record<string, string>)["idempotency-key"]).toBe((state.writes()[1][1]!.headers as Record<string, string>)["idempotency-key"]);
  expect((state.writes()[1][1]!.body as FormData).getAll("files")).toEqual([file]);
});

it("reports project-file search failure without inventing an attachment", async () => {
  const state = setup({ failSearch: true });
  fireEvent.click(screen.getByRole("button", { name: "@ 项目库文件" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("文件列表读取失败，请重试。");
  expect(screen.queryByRole("button", { name: "移除 项目说明.txt" })).not.toBeInTheDocument();
  expect(state.writes()).toHaveLength(0);
});

it.each(["task", "meeting", "trip"] as const)("lets a %s recipient preview and download documents", async kind => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: { text: "已上传的事项资料" } }) })));
  const item = { id: "item-1", kind, title: "有附件的事项", description: "", dueAt: "2026-09-05T02:00:00.000Z", location: "", projectId: null, createdBy: "alice", createdAt: "2026-09-04T02:00:00.000Z", version: 1, responses: [{ memberId: "bob", action: "pending" as const, note: "", respondedAt: null }], audit: [], documents: [{ id: "doc-1", originalName: "事项资料.txt", kind: "text" as const, byteLength: 30, createdAt: "2026-09-04T02:00:00.000Z" }] };
  render(<WorkspaceActivityBoard {...props} currentUserId="bob" initial={[item]} />);
  fireEvent.click(screen.getByRole("button", { name: "事项概览：有附件的事项" }));
  expect(screen.getByText("事项附件")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "预览 事项资料.txt" }));
  expect(await screen.findByText("已上传的事项资料")).toBeVisible();
  expect(screen.getByRole("link", { name: "下载 事项资料.txt" })).toHaveAttribute("href", "/api/v1/activity/item-1/documents/doc-1?download=1");
});

it("keeps a completed @ file mention resolved while the author continues the description", async () => {
  setup();
  fireEvent.change(screen.getByLabelText("内容与资料说明"), { target: { value: "请核对 @项目说明" } });
  fireEvent.click(await screen.findByRole("button", { name: /项目说明.txt/ }));
  fireEvent.change(screen.getByLabelText("内容与资料说明"), { target: { value: "请核对 @项目说明.txt 并在会前补充意见" } });
  expect(screen.queryByLabelText("搜索项目库文件")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "移除 项目说明.txt" })).toBeVisible();
  fireEvent.change(screen.getByLabelText("内容与资料说明"), { target: { value: "请核对 @项目说明.txt 以及 @另一份" } });
  expect(screen.getByLabelText("搜索项目库文件")).toHaveValue("另一份");
});
