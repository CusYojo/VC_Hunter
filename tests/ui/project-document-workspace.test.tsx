// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Project360 } from "@/components/project-360";
import type { DocumentAnnotation } from "@/workbench/project-document-contracts";
import type { ProjectDetail } from "@/repositories/projects";

vi.mock("@/components/project-actions", () => ({ ProjectActions: () => null }));
vi.mock("@/components/project-timeline", () => ({ ProjectTimeline: () => null }));
afterEach(() => vi.unstubAllGlobals());
const project = { id: "project-1", name: "项目测试", legalName: "项目测试有限公司", track: "半导体", status: "researching", executiveSummary: "核对项目资料", whyNow: "资料核验", technologyStage: "pilot", openQuestions: [], assertions: [], version: 1, events: [], researchReports: [], agentTimeline: [], lastResearchedAt: "2026-09-04" } as unknown as ProjectDetail;
const document = { id: "doc-1", projectId: "project-1", mediaType: "text/plain", originalName: "公开联系方式.txt", kind: "text", byteLength: 343, externalPolicy: "local_only", parseStatus: "queued", analysisStatus: "queued", createdAt: "2026-09-04T02:00:00.000Z" };
const comment: DocumentAnnotation = { id: "note-1", documentId: "doc-1", parentId: null, authorId: "alice", authorName: "王经理", content: "请核对联系方式来源。", action: "comment", createdAt: "2026-09-04T03:00:00.000Z" };
const discussion = { items: [comment], reviewStatus: "pending", permissions: { canComment: true, canReview: true } };
function renderWorkspace() { render(<Project360 project={project} documents={[document]} />); fireEvent.click(screen.getByRole("tab", { name: "资料与审批" })); }
function setupFetch(postData = discussion) {
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => ({ ok: true, json: async () => ({ data: url.endsWith("/content") ? { text: "联系人：测试联系人 <script>alert(1)</script>" } : options?.method === "POST" ? postData : discussion }) }));
  vi.stubGlobal("fetch", fetchMock); return fetchMock;
}

it("adds open, download and annotation actions to each existing project document", async () => {
  setupFetch(); renderWorkspace();
  expect(screen.getByRole("link", { name: "下载 公开联系方式.txt" }).getAttribute("href")).toBe("/api/v1/projects/project-1/documents/doc-1/content?download=1");
  fireEvent.click(screen.getByRole("button", { name: "在线打开 公开联系方式.txt" }));
  expect(await screen.findByText("联系人：测试联系人 <script>alert(1)</script>")).toBeTruthy();
  expect(window.document.querySelectorAll("script")).toHaveLength(0);
  expect(screen.getByRole("dialog", { name: "公开联系方式.txt" })).toBeTruthy();
});

it("opens a discussion beside the document and saves a reply against the original comment", async () => {
  const reply = { ...comment, id: "reply-1", parentId: "note-1", content: "已核对官网，联系方式一致。", authorId: "bob", authorName: "林经理" };
  const fetchMock = setupFetch({ ...discussion, items: [comment, reply] }); renderWorkspace();
  fireEvent.click(screen.getByRole("button", { name: "审核 / 批注 公开联系方式.txt" }));
  expect(await screen.findByText(comment.content)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: `回复批注：${comment.content}` }));
  fireEvent.change(screen.getByLabelText("回复内容"), { target: { value: reply.content } });
  fireEvent.click(screen.getByRole("button", { name: "发送回复" }));
  expect(await screen.findByText(reply.content)).toBeTruthy();
  const [url, options] = fetchMock.mock.calls.find(([, options]) => options?.method === "POST")!;
  expect(url).toBe("/api/v1/projects/project-1/documents/doc-1/annotations");
  expect(JSON.parse(options!.body as string)).toEqual({ action: "comment", content: reply.content, parentId: "note-1" });
  expect((options!.headers as Record<string, string>)["idempotency-key"]).toBeTruthy();
  expect(within(screen.getByRole("article", { name: `批注：${comment.content}` })).getByText(reply.content)).toBeTruthy();
});

it("publishes a root annotation without forging its author", async () => {
  const added = { ...comment, id: "note-2", content: "请补充对方的职位。" };
  const fetchMock = setupFetch({ ...discussion, items: [comment, added] }); renderWorkspace();
  fireEvent.click(screen.getByRole("button", { name: "审核 / 批注 公开联系方式.txt" }));
  await screen.findByText(comment.content);
  fireEvent.change(screen.getByLabelText("批注 / 审核意见"), { target: { value: added.content } });
  fireEvent.click(screen.getByRole("button", { name: "发表批注" }));
  expect(await screen.findByText(added.content)).toBeTruthy();
  const body = JSON.parse(fetchMock.mock.calls.find(([, options]) => options?.method === "POST")![1]!.body as string);
  expect(body).toEqual({ action: "comment", content: added.content, parentId: null });
});

it("keeps failed submissions editable and does not display an unsaved review result", async () => {
  const fetchMock = setupFetch(); renderWorkspace();
  fireEvent.click(screen.getByRole("button", { name: "审核 / 批注 公开联系方式.txt" }));
  await screen.findByText(comment.content);
  fetchMock.mockImplementation(async () => ({ ok: false, json: async () => ({ error: { message: "保存失败，请重试。" } }) }) as never);
  fireEvent.change(screen.getByLabelText("批注 / 审核意见"), { target: { value: "需补充来源" } });
  fireEvent.click(screen.getByRole("button", { name: "要求修改" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "保存失败，请重试。");
  expect((screen.getByLabelText("批注 / 审核意见") as HTMLTextAreaElement).value).toBe("需补充来源");
  expect(screen.queryByText("审核：需修改")).toBeNull();
});

it("uses server permissions to keep read-only members from posting or reviewing", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => ({ data: url.endsWith("/content") ? { text: "正文" } : { ...discussion, permissions: { canComment: false, canReview: false } } }) })));
  renderWorkspace(); fireEvent.click(screen.getByRole("button", { name: "审核 / 批注 公开联系方式.txt" }));
  await screen.findByText(comment.content);
  expect(screen.queryByRole("button", { name: "发表批注" })).toBeNull();
  expect(screen.queryByRole("button", { name: "标记通过" })).toBeNull();
  expect(screen.queryByRole("button", { name: /回复批注：/ })).toBeNull();
});

it("records approval separately from parsing and keeps the approved status on the document row", async () => {
  setupFetch({ ...discussion, reviewStatus: "approved" }); renderWorkspace();
  fireEvent.click(screen.getByRole("button", { name: "审核 / 批注 公开联系方式.txt" }));
  await screen.findByText(comment.content);
  fireEvent.click(screen.getByRole("button", { name: "标记通过" }));
  await screen.findByText("审核：已通过");
  fireEvent.click(screen.getByRole("button", { name: "关闭资料面板" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByText("审核：已通过")).toBeTruthy();
  expect(screen.getByText("解析：排队中")).toBeTruthy();
});

it("keeps one submission in flight and reuses its idempotency key after an uncertain response", async () => {
  const fetchMock = setupFetch(); renderWorkspace();
  fireEvent.click(screen.getByRole("button", { name: "审核 / 批注 公开联系方式.txt" }));
  await screen.findByText(comment.content);
  let complete!: (value: unknown) => void;
  fetchMock.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }) as never);
  fireEvent.change(screen.getByLabelText("批注 / 审核意见"), { target: { value: "确认来源" } });
  const submit = screen.getByRole("button", { name: "发表批注" });
  fireEvent.click(submit); fireEvent.click(submit);
  expect(screen.getByRole("button", { name: "刷新批注" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "关闭资料面板" })).toBeDisabled();
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  complete({ ok: false, json: async () => ({ error: { message: "连接中断，请重试。" } }) });
  await screen.findByText("连接中断，请重试。");
  fireEvent.click(submit);
  await waitFor(() => expect(screen.queryByText("正在保存…")).toBeNull());
  const submissions = fetchMock.mock.calls.filter(([, options]) => options?.method === "POST");
  expect(submissions).toHaveLength(2);
  expect(submissions[0][1]!.headers).toEqual(submissions[1][1]!.headers);
  expect((screen.getByLabelText("批注 / 审核意见") as HTMLTextAreaElement).value).toBe("");
});

it("preserves unsent annotations and replies while discussion is collapsed", async () => {
  setupFetch(); renderWorkspace();
  fireEvent.click(screen.getByRole("button", { name: "审核 / 批注 公开联系方式.txt" }));
  await screen.findByText(comment.content);
  fireEvent.change(screen.getByLabelText("批注 / 审核意见"), { target: { value: "待完成的意见" } });
  fireEvent.click(screen.getByRole("button", { name: `回复批注：${comment.content}` }));
  fireEvent.change(screen.getByLabelText("回复内容"), { target: { value: "待完成的回复" } });
  fireEvent.click(screen.getByRole("button", { name: "收起审核 / 批注" }));
  fireEvent.click(screen.getByRole("button", { name: "展开审核 / 批注" }));
  await screen.findByText(comment.content);
  expect(screen.getByLabelText("批注 / 审核意见")).toHaveValue("待完成的意见");
  expect(screen.getByLabelText("回复内容")).toHaveValue("待完成的回复");
});

it("can recover from a discussion read failure without hiding the document", async () => {
  let failed = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/content")) return { ok: true, json: async () => ({ data: { text: "资料正文" } }) };
    if (!failed) { failed = true; return { ok: false, json: async () => ({ error: { message: "批注暂时不可用" } }) }; }
    return { ok: true, json: async () => ({ data: { ...discussion, items: [] } }) };
  }));
  renderWorkspace();
  fireEvent.click(screen.getByRole("button", { name: "审核 / 批注 公开联系方式.txt" }));
  expect(await screen.findByText("批注暂时不可用")).toBeTruthy();
  expect(screen.getByText("资料正文")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "刷新批注" }));
  expect(await screen.findByText("还没有批注，可以发表第一条意见。")).toBeTruthy();
  expect(screen.getByLabelText("批注 / 审核意见")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("puts file metadata and review controls in a collapsible side panel beside the full-height document", async () => {
  setupFetch(); renderWorkspace();
  fireEvent.click(screen.getByRole("button", { name: "在线打开 公开联系方式.txt" }));
  await screen.findByText("联系人：测试联系人 <script>alert(1)</script>");
  const sidebar = screen.getByRole("complementary", { name: "文件信息与审核" });
  expect(within(sidebar).getByRole("link", { name: "下载原文件" })).toBeVisible();
  expect(within(sidebar).getByRole("button", { name: "展开审核 / 批注" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "收起文件侧栏" }));
  expect(screen.queryByRole("link", { name: "下载原文件" })).toBeNull();
  expect(screen.getByText("联系人：测试联系人 <script>alert(1)</script>")).toBeVisible();
  expect(screen.getByRole("dialog", { name: "公开联系方式.txt" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "展开文件侧栏" }));
  expect(screen.getByRole("link", { name: "下载原文件" })).toBeVisible();
});

it("opens the file with a collapsed sidebar on mobile but preserves the explicit review entry point", async () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  setupFetch(); renderWorkspace();
  fireEvent.click(screen.getByRole("button", { name: "在线打开 公开联系方式.txt" }));
  await screen.findByText("联系人：测试联系人 <script>alert(1)</script>");
  expect(screen.getByRole("button", { name: "展开文件侧栏" })).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(screen.getByRole("button", { name: "关闭资料面板" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "审核 / 批注 公开联系方式.txt" }));
  expect(await screen.findByText(comment.content)).toBeVisible();
  expect(screen.getByRole("button", { name: "收起文件侧栏" })).toHaveAttribute("aria-expanded", "true");
});

it("retains the authenticated PDF original-file fallback in the only visible sidebar", async () => {
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:project-pdf"), revokeObjectURL: vi.fn() });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, blob: async () => new Blob(["pdf"]), json: async () => ({ data: url.endsWith("/content") ? { text: "正文" } : discussion }) })));
  render(<Project360 project={project} documents={[{ ...document, originalName: "项目原件.pdf", kind: "pdf" }]} />);
  fireEvent.click(screen.getByRole("tab", { name: "资料与审批" }));
  fireEvent.click(screen.getByRole("button", { name: "在线打开 项目原件.pdf" }));
  await screen.findByTitle("项目原件.pdf 预览");
  const original = within(screen.getByRole("complementary", { name: "文件信息与审核" })).getByRole("link", { name: "打开原文件" });
  expect(original).toHaveAttribute("href", "/api/v1/projects/project-1/documents/doc-1/content");
  expect(original).toHaveAttribute("target", "_blank");
  expect(original).toHaveAttribute("rel", "noopener noreferrer");
  expect(screen.queryByRole("complementary", { name: "文件预览工具" })).toBeNull();
});
