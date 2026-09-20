// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ActivityDiscussion } from "@/components/activity-discussion";
import { ProjectTimeline, type MilestoneView } from "@/components/project-timeline";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(() => vi.unstubAllGlobals());
it("removes activity text and attachments while retaining replies and an empty parent reference", async () => {
  const parent = { id: "parent", sequence: 1, activityId: "a", authorId: "u", parentId: null, body: "待删原文", createdAt: "2026-09-04", documents: [], canDelete: true };
  const reply = { ...parent, id: "reply", sequence: 2, authorId: "v", parentId: "parent", body: "保留的回复", canDelete: false };
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => ({ data: init?.method === "DELETE" ? { ...parent, body: "", deletedAt: "2026-09-04", canDelete: false } : { items: [parent, reply], hasMore: false, nextCursor: 2 } }) })));
  render(<ActivityDiscussion activityId="a" memberName={id => id} projectOptions={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "审核 / 批注" }));await screen.findByText("保留的回复");
  expect(screen.getAllByRole("button", { name: "删除评论" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "删除评论" }));fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  expect(await screen.findByText("该评论已删除")).toBeVisible();expect(screen.queryByText(/待删原文/)).toBeNull();expect(screen.getByText("保留的回复")).toBeVisible();
  expect(screen.getByText(/回复 u：评论已删除/)).toBeVisible();expect(screen.queryByRole("button", { name: "回复 u的批注" })).toBeNull();
});
it("updates project milestone comments from the server deletion response", async () => {
  const comment = { id: "c", projectId: "p", milestoneId: "m", authorId: "u", authorName: "小林", body: "项目旧意见", mentions: [], createdAt: "2026-09-04", canDelete: true };
  const milestone: MilestoneView = { id: "m", projectId: "p", stage: "dd", stageLabel: "尽调", title: "访谈", kind: "note", status: "planned", plannedAt: null, occurredAt: null, ownerId: null, ownerName: null, conclusion: "", sortOrder: 1, version: 1, createdBy: "u", createdAt: "2026-09-04", updatedAt: "2026-09-04", attachments: [], comments: [comment] };
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ data: { ...comment, body: "", canDelete: false, deletedAt: "2026-09-04" } }) }));vi.stubGlobal("fetch", fetcher);
  render(<ProjectTimeline projectId="p" stages={[{ id: "dd", label: "尽调", suggestedMilestones: [] }]} team={[]} initialMilestones={[milestone]} />);
  fireEvent.click(screen.getByRole("button", { name: "删除评论" }));fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  expect(await screen.findByText("该评论已删除")).toBeVisible();expect(screen.queryByText("项目旧意见")).toBeNull();
  expect(fetcher).toHaveBeenCalledWith("/api/v1/projects/p/comments/c", { method: "DELETE" });
});
