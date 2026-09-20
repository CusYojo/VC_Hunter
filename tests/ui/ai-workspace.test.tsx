// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AiCenter } from "@/components/operating/ai-center";
afterEach(() => vi.unstubAllGlobals());
const now = "2026-09-04T00:00:00.000Z";
const conversation = { id: "chat-1", title: "整理会议", createdAt: now, updatedAt: now };
const output = "决议：下周补充资料。";
function fixture({ failed = false, existing = false }: { failed?: boolean; existing?: boolean } = {}) {
  const turns: Record<string, unknown>[] = [];
  const mock = vi.fn(async (raw: string, options?: RequestInit) => {
    const url = String(raw);
    let data: unknown = [];
    let ok = true;
    if (url.includes("/settings/ai")) data = { activeProvider: "openai", providers: [{ provider: "openai", model: "test-model", configured: true }] };
    else if (url.includes("/projects")) data = { items: [{ id: "project-a", name: "项目甲" }, { id: "project-b", name: "项目乙" }], total: 2 };
    else if (url.endsWith("/messages")) {
      const body = JSON.parse(options!.body as string);
      data = { id: `turn-${turns.length + 1}`, conversationId: conversation.id, ...body, status: failed ? "failed" : "succeeded", output: failed ? "" : output, error: failed ? "调用失败，请检查额度。" : null, model: "test-model", provider: "openai", createdAt: now, updatedAt: now, sources: body.useKnowledge ? [{ id: "doc-1", type: "document", title: "项目甲资料.txt", href: "/source", reference: "S1", availability: "ready", parseStatus: "parsed" }] : [], warnings: [] };
      turns.push(data as Record<string, unknown>); ok = !failed;
    } else if (url.endsWith("/conversations")) data = options?.method === "POST" ? conversation : existing || turns.length ? [conversation] : [];
    else if (url.includes("/conversations/")) data = { conversation, turns: [...turns] };
    return { ok, status: ok ? 200 : 502, json: async () => ({ data, ...(ok ? {} : { error: { message: "调用失败，请检查额度。" } }) }) };
  });
  vi.stubGlobal("fetch", mock);
  return { mock, turns, messages: () => mock.mock.calls.filter(([url]) => String(url).endsWith("/messages")) };
}
function enterQuestion(text = "整理会议") { fireEvent.change(screen.getByLabelText("你的问题或任务"), { target: { value: text } }); }
function consent() { fireEvent.click(screen.getByRole("checkbox", { name: /同意将本次输入/ })); }
function send() { fireEvent.click(screen.getByRole("button", { name: "发送消息" })); }

it("sends explicit-consent messages without knowledge or project context by default", async () => {
  const state = fixture(); render(<AiCenter initialView="copilot" />);
  await screen.findByLabelText("你的问题或任务"); enterQuestion();
  expect(screen.getByRole("checkbox", { name: "查询知识库" })).not.toBeChecked();
  expect(screen.queryByRole("combobox", { name: "选择项目" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
  consent(); send(); send();
  await screen.findByText(output);
  expect(state.messages()).toHaveLength(1);
  const request = state.messages()[0][1]!;
  const body = JSON.parse(request.body as string);
  expect(body).toMatchObject({ prompt: "整理会议", consent: true, useKnowledge: false });
  expect(body).not.toHaveProperty("projectId");
  expect(request.headers).toHaveProperty("idempotency-key");
});

it("requires a selected project, resets consent on scope changes, and displays retrieved sources", async () => {
  const state = fixture(); render(<AiCenter initialView="copilot" />);
  await screen.findByLabelText("你的问题或任务"); enterQuestion(); consent();
  fireEvent.click(screen.getByRole("checkbox", { name: "查询知识库" }));
  expect(screen.getByRole("checkbox", { name: /同意将本次输入/ })).not.toBeChecked();
  consent(); expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
  const select = await screen.findByRole("combobox", { name: "选择项目" });
  await screen.findByRole("option", { name: "项目甲" });
  fireEvent.change(select, { target: { value: "project-a" } });
  expect(screen.getByRole("checkbox", { name: /同意将本次输入/ })).not.toBeChecked();
  consent(); send(); await screen.findByText(output);
  expect(JSON.parse(state.messages()[0][1]!.body as string)).toMatchObject({ useKnowledge: true, projectId: "project-a" });
  expect(await screen.findByRole("link", { name: /项目甲资料.txt/ })).toHaveAttribute("href", "/source");
  enterQuestion("继续总结");
  fireEvent.click(screen.getByRole("checkbox", { name: "查询知识库" })); consent(); send();
  await waitFor(() => expect(state.messages()).toHaveLength(2));
  expect(JSON.parse(state.messages()[1][1]!.body as string)).not.toHaveProperty("projectId");
});

it("reopens persisted conversations and keeps follow-up messages in that conversation", async () => {
  const state = fixture(); render(<AiCenter initialView="copilot" />);
  await screen.findByLabelText("你的问题或任务"); enterQuestion(); consent(); send();
  await screen.findByText(output);
  enterQuestion("继续列出负责人"); consent(); send();
  await waitFor(() => expect(state.turns).toHaveLength(2));
  fireEvent.click(screen.getByRole("button", { name: "新建对话" }));
  await waitFor(() => expect(screen.queryByText(output)).not.toBeInTheDocument());
  fireEvent.click(await screen.findByRole("button", { name: /整理会议/ }));
  await waitFor(() => expect(screen.getAllByText(output)).toHaveLength(2));
  expect(state.messages().every(([url]) => url.includes("/chat-1/messages"))).toBe(true);
});

it("keeps failed messages visible as errors and preserves the question for retry", async () => {
  fixture({ failed: true }); render(<AiCenter initialView="copilot" />);
  await screen.findByLabelText("你的问题或任务"); enterQuestion(); consent(); send();
  expect(await screen.findByRole("alert")).toHaveTextContent("调用失败，请检查额度。");
  expect(screen.queryByText(output)).not.toBeInTheDocument();
  expect(screen.getByLabelText("你的问题或任务")).toHaveValue("整理会议");
});

it("does not let a late conversation response overwrite a newly opened draft", async () => {
  const state = fixture({ existing: true });
  const original = state.mock.getMockImplementation()!;
  let resolveDetail!: (value: Awaited<ReturnType<typeof original>>) => void;
  state.mock.mockImplementation((url, options) => String(url).endsWith("/conversations/chat-1") ? new Promise(resolve => { resolveDetail = resolve; }) : original(url, options));
  render(<AiCenter initialView="copilot" />);
  fireEvent.click(await screen.findByRole("button", { name: /整理会议/ }));
  fireEvent.click(screen.getByRole("button", { name: "新建对话" }));
  enterQuestion("新的草稿");
  resolveDetail({ ok: true, status: 200, json: async () => ({ data: { conversation, turns: [{ id: "late-turn", prompt: "旧问题", output: "不应出现的旧回答", status: "succeeded", sources: [], warnings: [] }] } }) });
  await waitFor(() => expect(screen.getByLabelText("你的问题或任务")).toHaveValue("新的草稿"));
  expect(screen.queryByText("不应出现的旧回答")).not.toBeInTheDocument();
});

it("keeps original PDF preview and download available after extraction fails and clears old material", async () => {
  const state = fixture();
  const original = state.mock.getMockImplementation()!;
  state.mock.mockImplementation(async (url, options) => {
    if (!String(url).endsWith("/ai/extract")) return original(url, options);
    return { ok: false, status: 400, json: async () => ({ data: undefined, error: { message: "此 PDF 暂无可提取正文，请使用 OCR。" } }) };
  });
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn(() => "blob:http://localhost/original-pdf");
    static revokeObjectURL = vi.fn();
  });
  render(<AiCenter initialView="copilot" />);
  await screen.findByLabelText("你的问题或任务");
  fireEvent.click(screen.getByRole("button", { name: "粘贴正文" }));
  fireEvent.change(screen.getByLabelText("资料正文（可编辑）"), { target: { value: "不应发送的旧文件正文" } });
  consent();
  fireEvent.change(screen.getByLabelText("附加资料", { exact: true }), { target: { files: [new File(["%PDF-1.4"], "扫描件.pdf", { type: "application/pdf" })] } });
  expect(await screen.findByRole("alert")).toHaveTextContent("此 PDF 暂无可提取正文");
  expect(screen.getByLabelText("资料正文（可编辑）")).toHaveValue("");
  expect(screen.getByRole("checkbox", { name: /同意将本次输入/ })).not.toBeChecked();
  expect(screen.getByRole("link", { name: "下载原文件" })).toHaveAttribute("href", "blob:http://localhost/original-pdf");
  expect(screen.getByRole("link", { name: "下载原文件" })).toHaveAttribute("download", "扫描件.pdf");
  fireEvent.click(screen.getByRole("button", { name: "查看原文件" }));
  expect(await screen.findByTitle("原文件预览：扫描件.pdf")).toHaveAttribute("src", "blob:http://localhost/original-pdf#toolbar=1&navpanes=1&view=FitH");
  expect(state.messages()).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  enterQuestion("说明附件尚未提取成功，告诉我下一步处理方式"); consent(); send();
  await waitFor(() => expect(state.messages()).toHaveLength(1));
  expect(JSON.parse(state.messages()[0][1]!.body as string)).toMatchObject({ context: "", attachmentName: "扫描件.pdf" });
});

it("blocks new sends while a conversation refresh is still unresolved", async () => {
  const state = fixture(); render(<AiCenter initialView="copilot" />);
  await screen.findByLabelText("你的问题或任务"); enterQuestion(); consent(); send();
  await screen.findByText(output);
  enterQuestion("刷新后的新问题"); consent();
  const original = state.mock.getMockImplementation()!;
  let resolveRefresh!: (value: Awaited<ReturnType<typeof original>>) => void;
  state.mock.mockImplementation((url, options) => String(url).endsWith("/conversations/chat-1") ? new Promise(resolve => { resolveRefresh = resolve; }) : original(url, options));
  fireEvent.click(screen.getByRole("button", { name: "刷新对话" }));
  expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
  fireEvent.keyDown(screen.getByLabelText("你的问题或任务"), { key: "Enter" });
  expect(state.messages()).toHaveLength(1);
  resolveRefresh({ ok: true, status: 200, json: async () => ({ data: { conversation, turns: [...state.turns] } }) });
  await waitFor(() => expect(screen.getByRole("button", { name: "发送消息" })).toBeEnabled());
  expect(screen.getByLabelText("你的问题或任务")).toHaveValue("刷新后的新问题");
});
