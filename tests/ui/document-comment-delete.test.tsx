// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DocumentAnnotations } from "@/components/document-annotations";
import type { DocumentAnnotation, DocumentAnnotationsResponse } from "@/workbench/project-document-contracts";

const url = "/api/v1/projects/project/documents/doc/annotations";
const comment = { id: "comment", documentId: "doc", parentId: null, authorId: "alice", authorName: "王经理", content: "待删除的旧正文", action: "comment", createdAt: "2026-09-04T08:00:00Z", canDelete: true } as DocumentAnnotation;
const reply = { ...comment, id: "reply", parentId: "comment", authorId: "bob", authorName: "李同事", content: "回复应当保留", canDelete: false } as DocumentAnnotation;
const discussion = (items: DocumentAnnotation[]): DocumentAnnotationsResponse => ({ items, permissions: { canComment: true, canReview: true }, reviewStatus: "approved" });
const response = (data: DocumentAnnotationsResponse) => ({ ok: true, json: async () => ({ data }) });
const deleted = { ...comment, deletedAt: "2026-09-04T09:00:00Z", canDelete: false } as DocumentAnnotation;
function setup(items: DocumentAnnotation[], after = discussion([deleted, reply])) {
  const fetch = vi.fn(async (_url: string, options?: RequestInit) => response(options?.method === "DELETE" ? after : discussion(items)));
  vi.stubGlobal("fetch", fetch); const onStatus = vi.fn(), onBusy = vi.fn();
  render(<DocumentAnnotations url={url} onStatus={onStatus} onBusy={onBusy} />);
  return { fetch, onStatus, onBusy };
}
afterEach(() => vi.unstubAllGlobals());

it("offers delete for allowed comments and replies while keeping review decisions immutable", async () => {
  const approved = { ...comment, id: "approve", action: "approve", content: "正式通过意见" } as DocumentAnnotation;
  const changes = { ...comment, id: "changes", action: "request_changes", content: "正式修改意见" } as DocumentAnnotation;
  setup([comment, { ...reply, canDelete: true } as DocumentAnnotation, approved, changes]);
  await screen.findByText(comment.content);
  const thread = screen.getByRole("article", { name: `批注：${comment.content}` });
  expect(within(thread).getAllByRole("button", { name: "删除评论" })).toHaveLength(2);
  expect(within(screen.getByRole("article", { name: "批注：正式通过意见" })).queryByRole("button", { name: "删除评论" })).toBeNull();
  expect(within(screen.getByRole("article", { name: "批注：正式修改意见" })).queryByRole("button", { name: "删除评论" })).toBeNull();
  expect(screen.getByText(comment.content)).toHaveClass("text-[15px]");
});

it("never renders deleted content or its reply reference even if an old response retained the text", async () => {
  setup([deleted, reply]); await screen.findByText("该批注已删除");
  expect(screen.queryByText(comment.content)).toBeNull();
  expect(document.body.innerHTML).not.toContain(comment.content);
  expect(screen.getByText(reply.content)).toBeVisible();
  expect(screen.queryByRole("button", { name: /回复批注/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "删除评论" })).toBeNull();
});

it("deletes after confirmation, refreshes status and clears the deleted comment's reply draft", async () => {
  const { fetch, onStatus, onBusy } = setup([comment, reply]); await screen.findByText(comment.content);
  fireEvent.click(screen.getByRole("button", { name: `回复批注：${comment.content}` }));
  fireEvent.change(screen.getByLabelText("回复内容"), { target: { value: "未发送的回复" } });
  fireEvent.click(screen.getByRole("button", { name: "删除评论" }));
  expect(fetch.mock.calls.filter(([, options]) => options?.method === "DELETE")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await screen.findByText("该批注已删除");
  expect(fetch).toHaveBeenCalledWith(`${url}/comment`, expect.objectContaining({ method: "DELETE" }));
  expect(screen.queryByLabelText("回复内容")).toBeNull();
  expect(screen.getByText(reply.content)).toBeVisible();
  expect(onStatus).toHaveBeenLastCalledWith("approved");
  await waitFor(() => expect(onBusy).toHaveBeenLastCalledWith(false));
  expect(onBusy).toHaveBeenCalledWith(true);
});
