// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectTimeline } from "@/components/project-timeline";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const stages = [
  { id: "contact", label: "接触", suggestedMilestones: ["首次沟通", "NDA 签署"] },
  { id: "initiation", label: "立项", suggestedMilestones: ["立项会"] },
  { id: "dd", label: "尽调", suggestedMilestones: ["技术尽调", "客户访谈"] },
  { id: "ic", label: "投决会", suggestedMilestones: ["投决材料", "投决会"] },
];

const milestones = [
  {
    id: "m1", projectId: "p1", stage: "contact", stageLabel: "接触", title: "NDA 签署", kind: "document", status: "done" as const,
    plannedAt: "2026-08-20", occurredAt: "2026-08-19", ownerId: "u1", ownerName: "示例经理", conclusion: "双方已完成签署。",
    sortOrder: 1, version: 1, createdBy: "u1", createdAt: "2026-08-18", updatedAt: "2026-08-19",
    attachments: [{ id: "a1", milestoneId: "m1", title: "NDA.pdf", uri: "https://example.com/nda", documentId: null, note: "", createdBy: "u1", createdAt: "2026-08-19" }],
    comments: [{ id: "c1", projectId: "p1", milestoneId: "m1", authorId: "u1", authorName: "示例经理", body: "法务已确认", mentions: [], createdAt: "2026-08-19" }],
  },
  {
    id: "m2", projectId: "p1", stage: "dd", stageLabel: "尽调", title: "技术尽调", kind: "meeting", status: "in_progress" as const,
    plannedAt: "2026-09-05", occurredAt: null, ownerId: "u1", ownerName: "示例经理", conclusion: "",
    sortOrder: 1, version: 1, createdBy: "u1", createdAt: "2026-09-01", updatedAt: "2026-09-03", attachments: [], comments: [],
  },
];

describe("ProjectTimeline", () => {
  afterEach(() => { vi.unstubAllGlobals(); refresh.mockClear(); });
  it("renders a horizontal VC process with completed, current and upcoming stage labels", () => {
    render(<ProjectTimeline projectId="p1" projectStatus="dd" stages={stages} team={[{ id: "u1", name: "示例经理" }]} initialMilestones={milestones} />);

    const flow = screen.getByRole("list", { name: "VC 项目流程" });
    expect(flow).toBeTruthy();
    expect(flow.querySelector('[aria-current="step"]')?.textContent).toContain("尽调");
    expect(screen.getAllByText("当前阶段").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/已完成/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("未开始").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "技术尽调" })).toBeTruthy();
  });

  it("derives the current stage from the furthest active node when the project status is stale", () => {
    render(<ProjectTimeline projectId="p1" projectStatus="contacting" stages={stages} team={[{ id: "u1", name: "示例经理" }]} initialMilestones={milestones} />);

    const flow = screen.getByRole("list", { name: "VC 项目流程" });
    expect(flow.querySelector('[aria-current="step"]')?.textContent).toContain("尽调");
  });

  it("respects an exact persisted manual stage even when historical later-stage nodes remain", () => {
    render(<ProjectTimeline projectId="p1" projectStatus="contacting" projectStage="contact" stages={stages} team={[{ id: "u1", name: "示例经理" }]} initialMilestones={milestones} />);

    const flow = screen.getByRole("list", { name: "VC 项目流程" });
    expect(flow.querySelector('[aria-current="step"]')?.textContent).toContain("接触");
  });

  it("places files and comments below their milestone", () => {
    render(<ProjectTimeline projectId="p1" projectStatus="dd" stages={stages} team={[{ id: "u1", name: "示例经理" }]} initialMilestones={milestones} />);

    expect(screen.getByText("NDA.pdf")).toBeTruthy();
    expect(screen.getByText("法务已确认")).toBeTruthy();
  });

  it("treats a passed project as terminated instead of a completed investment flow", () => {
    render(<ProjectTimeline projectId="p1" projectStatus="pass" stages={stages} team={[]} initialMilestones={[]} />);

    expect(screen.getByText("项目已结束跟进")).toBeTruthy();
    expect(screen.queryByRole("listitem", { current: "step" })).toBeNull();
    expect(screen.getAllByText("未开始").length).toBeGreaterThanOrEqual(stages.length * 2);
  });

  it("searches milestone owners by department without inventing membership", () => {
    render(<ProjectTimeline projectId="p1" projectStatus="dd" stages={stages} team={[{ id:"u1",name:"示例经理",departmentName:"投资部" },{ id:"u2",name:"陈会计",departmentName:"财务部" }]} initialMilestones={milestones} />);
    const card = screen.getByRole("heading", { name:"NDA 签署" }).closest("article")!;
    fireEvent.click(within(card).getByRole("button", { name:"更新节点" }));
    fireEvent.change(within(card).getByRole("searchbox", { name:"搜索节点负责人" }), { target:{ value:"财务" } });
    const owner = within(card).getByLabelText("负责人") as HTMLSelectElement;
    expect(Array.from(owner.options).map(option => option.text)).toContain("陈会计");
    expect(Array.from(owner.options).map(option => option.text)).not.toContain("示例经理");
  });

  it("refreshes the project snapshot after a node write so sibling actions receive the new version", async () => {
    const updated = { ...milestones[1], status: "done" as const, version: 2, projectProgress: { status: "dd", dealStage: "dd", dealStageLabel: "尽调", version: 3 } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: updated }), { status: 200 })));
    render(<ProjectTimeline projectId="p1" projectStatus="dd" projectStage="dd" stages={stages} team={[{ id: "u1", name: "示例经理" }]} initialMilestones={milestones} />);

    const card = screen.getByRole("heading", { name: "技术尽调" }).closest("article")!;
    fireEvent.click(within(card).getByRole("button", { name: "更新节点" }));
    fireEvent.change(within(card).getByLabelText("状态"), { target: { value: "done" } });

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});
