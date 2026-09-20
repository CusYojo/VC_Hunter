// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ActivityDiscussion } from "@/components/activity-discussion";
const first = { id: "c1", sequence: 1, activityId: "a1", parentId: null, authorId: "bob", body: "需要补充测试记录", createdAt: "2026-09-04T02:00:00.000Z", documents: [] };
const props = { activityId: "a1", memberName: (id: string) => id === "alice" ? "发起人" : "审核人", projectOptions: [{ id: "p1", name: "项目甲" }] };
afterEach(() => vi.unstubAllGlobals());
function setup(fail = false) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith("/api/v1/project-files")) return { ok: true, json: async () => ({ data: { items: [{ id: "d1", projectId: "p1", projectName: "项目甲", originalName: "测试记录.txt" }] } }) };
    if (init?.method === "POST") {
      const body = init.body instanceof FormData ? JSON.parse(String(init.body.get("payload"))) : JSON.parse(String(init.body));
      return { ok: !fail, json: async () => fail ? { error: { message: "保存失败，请重试。" } } : { data: { ...first, ...body, id: "c2", sequence: 2, authorId: "alice", documents: [] } } };
    }
    return { ok: true, json: async () => ({ data: { items: [first], hasMore: false, nextCursor: 1 } }) };
  });
  vi.stubGlobal("fetch", fetcher); render(<ActivityDiscussion {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "审核 / 批注" }));
  return fetcher;
}
it("opens prior discussions and lets the author reply repeatedly without formal approval requests", async () => {
  const fetcher = setup(); await screen.findByText(first.body);
  fireEvent.click(screen.getByRole("button", { name: "回复 审核人的批注" }));
  fireEvent.change(screen.getByLabelText("批注内容"), { target: { value: "我来补充记录" } });
  fireEvent.click(screen.getByRole("button", { name: "发表回复" }));
  await screen.findByText("我来补充记录");
  expect(screen.getByLabelText("批注内容")).toHaveValue("");
  expect(screen.getByRole("button", { name: "发表批注" })).toBeDisabled();
  const writes = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(writes).toHaveLength(1); expect(writes[0][0]).toBe("/api/v1/activity/a1/comments");
  expect(JSON.parse(writes[0][1]!.body as string)).toEqual({ body: "我来补充记录", parentId: "c1", projectDocumentIds: [] });
});
it("submits file-only replies with local files and structured @ references in one request", async () => {
  const fetcher = setup(); await screen.findByText(first.body);
  fireEvent.click(screen.getByRole("button", { name: "回复 审核人的批注" }));
  const file = new File(["补充记录"], "补充.txt", { type: "text/plain" });
  fireEvent.change(screen.getByLabelText("附上文件"), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: "@知识库" }));
  fireEvent.click(await screen.findByRole("button", { name: /测试记录.txt/ }));
  fireEvent.click(screen.getByRole("button", { name: "发表回复" }));
  await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1));
  const request = fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!;
  expect(request.body).toBeInstanceOf(FormData);
  expect((request.body as FormData).getAll("files")).toEqual([file]);
  expect(JSON.parse(String((request.body as FormData).get("payload")))).toEqual({ body: "", parentId: "c1", projectDocumentIds: ["d1"] });
});
it("preserves failed drafts/attachments and reuses the idempotency key on retry", async () => {
  const fetcher = setup(true); await screen.findByText(first.body);
  fireEvent.change(screen.getByLabelText("批注内容"), { target: { value: "待补充意见" } });
  fireEvent.click(screen.getByRole("button", { name: "发表批注" }));
  await screen.findByRole("alert"); expect(screen.getByLabelText("批注内容")).toHaveValue("待补充意见");
  fireEvent.click(screen.getByRole("button", { name: "发表批注" }));
  await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2));
  const writes = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(writes[0][1]!.headers).toEqual(writes[1][1]!.headers);
});
it("renders reply context and protected attachment preview/downloads", async () => {
  const attachment = { id: "doc", originalName: "记录.txt", kind: "text", byteLength: 20, createdAt: first.createdAt, source: "upload" };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => ({ data: String(url).includes("/documents/") ? { text: "完整记录正文" } : { items: [first, { ...first, id: "c2", sequence: 2, parentId: "c1", body: "补充原件", documents: [attachment] }], hasMore: false, nextCursor: 2 } }) })));
  render(<ActivityDiscussion {...props} />); fireEvent.click(screen.getByRole("button", { name: "审核 / 批注" }));
  await screen.findByText("补充原件");
  const reply = screen.getByText("补充原件").closest("li")!;
  expect(within(reply).getByText(/回复.*需要补充测试记录/)).toBeVisible();
  expect(screen.getByRole("link", { name: "下载 记录.txt" })).toHaveAttribute("href", "/api/v1/activity/a1/comments/c2/documents/doc?download=1");
  fireEvent.click(screen.getByRole("button", { name: "预览 记录.txt" }));
  expect(await screen.findByText("完整记录正文")).toBeVisible();
});
it("recovers a failed initial load with refresh and keeps draft text while loading more replies", async () => {
  let reads = 0;
  const fetcher = vi.fn(async (url: string) => {
    if (++reads === 1) return { ok: false, json: async () => ({ error: { message: "读取暂时失败" } }) };
    return { ok: true, json: async () => ({ data: String(url).includes("after=1") ? { items: [{ ...first, id: "c2", sequence: 2, body: "第二页批注" }], hasMore: false, nextCursor: 2 } : { items: [first], hasMore: true, nextCursor: 1 } }) };
  });
  vi.stubGlobal("fetch", fetcher); render(<ActivityDiscussion {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "审核 / 批注" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("读取暂时失败");
  fireEvent.click(screen.getByRole("button", { name: "刷新批注" })); await screen.findByText(first.body);
  fireEvent.change(screen.getByLabelText("批注内容"), { target: { value: "未提交草稿" } });
  fireEvent.click(screen.getByRole("button", { name: "加载更多批注" }));
  await screen.findByText("第二页批注"); expect(screen.getByText(first.body)).toBeVisible(); expect(screen.getByLabelText("批注内容")).toHaveValue("未提交草稿");
});
it("resolves @ names, supports cancelling a reply and removes unsent attachments", async () => {
  const fetcher = setup(); await screen.findByText(first.body);
  fireEvent.click(screen.getByRole("button", { name: "回复 审核人的批注" }));
  fireEvent.change(screen.getByLabelText("批注内容"), { target: { value: "请阅读 @测试" } });
  fireEvent.click(await screen.findByRole("button", { name: /测试记录.txt/ }));
  expect(screen.getByLabelText("批注内容")).toHaveValue("请阅读 @测试记录.txt ");
  fireEvent.change(screen.getByLabelText("批注内容"), { target: { value: "请阅读 @测试记录.txt 继续说明" } });
  expect(screen.queryByLabelText("搜索项目库文件")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "移除 测试记录.txt" }));
  fireEvent.click(screen.getByRole("button", { name: "取消回复" }));
  expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "发表批注" }));
  await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
  const write = fetcher.mock.calls.find(([, init]) => init?.method === "POST")!;
  expect(JSON.parse(write[1]!.body as string)).toMatchObject({ parentId: null, projectDocumentIds: [] });
});
it("blocks duplicate sends and refreshes while a comment submission is pending", async () => {
  let finish!: (value: unknown) => void;
  const fetcher = vi.fn((url: string, init?: RequestInit) => init?.method === "POST" ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ ok: true, json: async () => ({ data: { items: [], hasMore: false, nextCursor: null } }) }));
  vi.stubGlobal("fetch", fetcher); render(<ActivityDiscussion {...props} />); fireEvent.click(screen.getByRole("button", { name: "审核 / 批注" }));
  await screen.findByText("暂无批注，可以发表第一条意见。");
  fireEvent.change(screen.getByLabelText("批注内容"), { target: { value: "提交一次" } });
  const form = screen.getByLabelText("批注内容").closest("form")!;
  fireEvent.submit(form); fireEvent.submit(form);
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "刷新批注" })).toBeDisabled();
  finish({ ok: true, json: async () => ({ data: { ...first, body: "提交一次" } }) });
  await screen.findByText("提交一次"); expect(screen.getByLabelText("批注内容")).toHaveValue("");
});
it("changes retry keys when failed draft content changes and preserves network error text", async () => {
  const fetcher = setup(true); await screen.findByText(first.body);
  fireEvent.change(screen.getByLabelText("批注内容"), { target: { value: "原意见" } }); fireEvent.click(screen.getByRole("button", { name: "发表批注" })); await screen.findByRole("alert");
  fireEvent.change(screen.getByLabelText("批注内容"), { target: { value: "新意见" } }); fireEvent.click(screen.getByRole("button", { name: "发表批注" }));
  await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2));
  const writes = fetcher.mock.calls.filter(([, init]) => init?.method === "POST"); expect(writes[0][1]!.headers).not.toEqual(writes[1][1]!.headers);
});
