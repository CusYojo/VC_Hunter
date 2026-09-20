// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceActivityBoard } from "@/components/workspace-activity-board";
import type { WorkspaceActivity } from "@/workbench/activity-contracts";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/activity-discussion", () => ({ ActivityDiscussion: () => null }));

const task: WorkspaceActivity = {
  id: "task-direct-actions", kind: "task", title: "整理项目访谈纪要", description: "", dueAt: null, location: "", projectId: null,
  createdBy: "alice", createdAt: "2026-09-07T00:00:00.000Z", version: 1,
  responses: [{ memberId: "bob", action: "pending", note: "", respondedAt: null }], audit: [], documents: [],
};
const props = { initial: [task], members: [{ id: "alice", name: "发起人" }, { id: "bob", name: "接收人" }], projectOptions: [], currentUserId: "alice", mode: "tasks" as const };

afterEach(() => { vi.unstubAllGlobals(); refresh.mockClear(); });

it("archives an owned task directly from its card", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { ...task, status: "archived", archivedAt: "2026-09-07T01:00:00.000Z", version: 2 } }) });
  vi.stubGlobal("fetch", fetcher);
  render(<WorkspaceActivityBoard {...props} />);
  fireEvent.click(screen.getByRole("button", { name: `事项概览：${task.title}` }));
  fireEvent.click(screen.getByRole("button", { name: `归档待办：${task.title}` }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith(`/api/v1/activity/${task.id}/lifecycle`, expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "archive", expectedVersion: 1 }) })));
  await waitFor(() => expect(screen.queryByRole("button", { name: `事项概览：${task.title}` })).toBeNull());
});

it("requires confirmation before deleting an owned task and hides the tombstone", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { ...task, status: "archived", archivedAt: "2026-09-07T01:00:00.000Z", deletedAt: "2026-09-07T01:00:00.000Z", version: 2 } }) });
  vi.stubGlobal("fetch", fetcher);
  render(<WorkspaceActivityBoard {...props} />);
  fireEvent.click(screen.getByRole("button", { name: `事项概览：${task.title}` }));
  fireEvent.click(screen.getByRole("button", { name: `删除待办：${task.title}` }));
  expect(fetcher).not.toHaveBeenCalled();
  expect(screen.getByText("删除后将从所有待办列表隐藏，但审计记录仍会保留。")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "确认删除待办" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith(`/api/v1/activity/${task.id}/lifecycle`, expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "delete", expectedVersion: 1 }) })));
  await waitFor(() => expect(screen.queryByRole("button", { name: `事项概览：${task.title}` })).toBeNull());
});

it("does not expose shared destructive actions to a recipient", () => {
  render(<WorkspaceActivityBoard {...props} currentUserId="bob" />);
  fireEvent.click(screen.getByRole("button", { name: `事项概览：${task.title}` }));
  expect(screen.queryByRole("button", { name: `归档待办：${task.title}` })).toBeNull();
  expect(screen.queryByRole("button", { name: `删除待办：${task.title}` })).toBeNull();
});
