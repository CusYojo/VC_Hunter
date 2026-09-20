// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CommentDeleteButton } from "@/components/comment-delete-button";
afterEach(() => vi.unstubAllGlobals());
it("requires a local confirmation, deletes once and passes the tombstone back", async () => {
  const onDeleted = vi.fn();
  const tombstone = { id: "c", deletedAt: "2026-09-04", body: "", canDelete: false };
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ data: tombstone }) }));vi.stubGlobal("fetch", fetcher);
  render(<CommentDeleteButton url="/api/v1/activity/a/comments/c" onDeleted={onDeleted} />);
  fireEvent.click(screen.getByRole("button", { name: "删除评论" }));expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "取消删除" }));expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "删除评论" }));fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(tombstone));
  expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/v1/activity/a/comments/c", { method: "DELETE" });
});
it("keeps failed comments intact and permits retry", async () => {
  const onDeleted = vi.fn(), onBusy = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: { message: "删除失败，请重试。" } }) })));
  render(<CommentDeleteButton url="/api/c" onDeleted={onDeleted} onBusy={onBusy} />);
  fireEvent.click(screen.getByRole("button", { name: "删除评论" }));fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("删除失败");expect(onDeleted).not.toHaveBeenCalled();expect(onBusy).toHaveBeenLastCalledWith(false);
  expect(screen.getByRole("button", { name: "确认删除" })).toBeEnabled();
});
