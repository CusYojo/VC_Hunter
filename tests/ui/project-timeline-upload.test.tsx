// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectTimeline, type MilestoneView } from "@/components/project-timeline";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const milestone: MilestoneView = {
  id: "milestone-upload", projectId: "project-upload", stage: "dd", stageLabel: "尽调", title: "文件上传验收", kind: "document", status: "in_progress",
  plannedAt: null, occurredAt: null, ownerId: "user-demo", ownerName: "示例经理", conclusion: "", sortOrder: 1, version: 1,
  createdBy: "user-demo", createdAt: "2026-09-07T00:00:00.000Z", updatedAt: "2026-09-07T00:00:00.000Z", attachments: [], comments: [],
};

afterEach(() => { vi.unstubAllGlobals(); refresh.mockClear(); });

it("uploads a local file into the project library and attaches its protected download to the milestone", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe("/api/v1/projects/project-upload/milestones/milestone-upload/attachments");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    const form = init?.body as FormData;
    expect(form.get("expectedVersion")).toBe("7");
    expect(form.get("title")).toBe("节点会议纪要.txt");
    expect((form.get("file") as File).name).toBe("节点会议纪要.txt");
    return new Response(JSON.stringify({ data: {
      id: "attachment-new", milestoneId: milestone.id, title: "节点会议纪要.txt", uri: null, documentId: "document-new", note: "",
      createdBy: "user-demo", createdAt: "2026-09-07T01:00:00.000Z", projectVersion: 8,
    } }), { status: 201 });
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<ProjectTimeline projectId="project-upload" projectVersion={7} projectStatus="dd" projectStage="dd" stages={[{ id: "dd", label: "尽调", suggestedMilestones: [] }]} team={[{ id: "user-demo", name: "示例经理" }]} initialMilestones={[milestone]} />);

  const card = screen.getByRole("heading", { name: milestone.title }).closest("article")!;
  fireEvent.click(within(card).getByRole("button", { name: "更新节点" }));
  fireEvent.click(within(card).getByRole("button", { name: "添加资料" }));
  const file = new File(["节点内部资料"], "节点会议纪要.txt", { type: "text/plain" });
  fireEvent.change(within(card).getByLabelText("上传本地文件"), { target: { files: [file] } });
  fireEvent.click(within(card).getByRole("button", { name: "上传并附加" }));

  const download = await within(card).findByRole("link", { name: "下载推进节点资料：节点会议纪要.txt" });
  expect(download.getAttribute("href")).toBe("/api/v1/projects/project-upload/documents/document-new/content?download=1");
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(refresh).toHaveBeenCalledTimes(1);
});

